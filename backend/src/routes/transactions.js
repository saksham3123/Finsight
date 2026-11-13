import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { executeTrade } from "../services/trading.js";
import { HttpError } from "../utils/httpError.js";
import { camelize, camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const assetId = v.uuid(req.query.assetId, "assetId", { required: false });
  const sipPlanId = v.uuid(req.query.sipPlanId, "sipPlanId", { required: false });
  const type = v.oneOf(req.query.type, "type", ["buy", "sell"], { required: false });
  const { rows } = await pool.query(
    `SELECT t.id, t.asset_id, a.symbol, a.name, a.asset_type, a.currency, t.sip_plan_id, t.txn_type,
            t.quantity, t.price, t.fees, t.quantity * t.price AS gross_amount, t.executed_at, t.created_at
     FROM transactions t JOIN assets a ON a.id = t.asset_id
     WHERE t.user_id = $1
       AND ($2::uuid IS NULL OR t.asset_id = $2)
       AND ($3::uuid IS NULL OR t.sip_plan_id = $3)
       AND ($4::text IS NULL OR t.txn_type = $4)
     ORDER BY t.executed_at DESC, t.created_at DESC
     LIMIT $5 OFFSET $6`,
    [req.user.id, assetId ?? null, sipPlanId ?? null, type ?? null, limit, offset]
  );
  res.json({ transactions: camelizeAll(rows), limit, offset });
});

// Transactions are an immutable ledger: there is no update or delete. A mistake is corrected
// with an opposite transaction, which keeps the history auditable.
router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const assetId = v.uuid(body.assetId, "assetId");
  const type = v.oneOf(body.type, "type", ["buy", "sell"]);
  const quantity = v.decimal(body.quantity, "quantity");
  const price = v.decimal(body.price, "price", { required: false, allowZero: true });
  const fees = v.decimal(body.fees, "fees", { required: false, scale: 2, allowZero: true }) ?? "0";
  const executedAt = v.timestamp(body.executedAt, "executedAt", { required: false });
  if (executedAt && new Date(executedAt) > new Date()) throw new HttpError(400, "executedAt cannot be in the future");

  const result = await withTransaction(async (client) => {
    const trade = await executeTrade(client, { userId: req.user.id, assetId, type, quantity, price, fees, executedAt });
    await logAudit(client, {
      userId: req.user.id,
      action: "transaction.create",
      entityType: "transaction",
      entityId: trade.transaction.id,
      details: { type, assetId, quantity, price: trade.transaction.price },
      ip: req.ip,
    });
    return trade;
  });
  res.status(201).json({ transaction: camelize(result.transaction), realizedPnl: result.realizedPnl });
});

export default router;
