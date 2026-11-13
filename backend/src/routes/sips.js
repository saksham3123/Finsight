import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { getActiveAsset } from "../services/assets.js";
import { logAudit } from "../services/audit.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { camelize, camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

const SIP_COLUMNS = `s.id, s.asset_id, a.symbol, a.name, a.asset_type, a.currency, s.amount, s.frequency,
  s.start_date, s.end_date, s.next_run_date, s.status, s.created_at, s.updated_at,
  (SELECT COUNT(*) FROM transactions t WHERE t.sip_plan_id = s.id) AS executions`;

const findSip = async (db, userId, id) => {
  const { rows } = await db.query(
    `SELECT ${SIP_COLUMNS} FROM sip_plans s JOIN assets a ON a.id = s.asset_id WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId]
  );
  if (!rows[0]) throw notFound("SIP plan");
  return rows[0];
};

router.get("/", async (req, res) => {
  const status = v.oneOf(req.query.status, "status", ["active", "paused", "cancelled", "completed"], { required: false });
  const { rows } = await pool.query(
    `SELECT ${SIP_COLUMNS} FROM sip_plans s JOIN assets a ON a.id = s.asset_id
     WHERE s.user_id = $1 AND ($2::text IS NULL OR s.status = $2)
     ORDER BY s.created_at DESC`,
    [req.user.id, status ?? null]
  );
  res.json({ sips: camelizeAll(rows) });
});

router.get("/:id", async (req, res) => {
  res.json({ sip: camelize(await findSip(pool, req.user.id, v.uuid(req.params.id, "id"))) });
});

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const assetId = v.uuid(body.assetId, "assetId");
  const amount = v.decimal(body.amount, "amount", { scale: 2 });
  const frequency = v.oneOf(body.frequency, "frequency", ["daily", "weekly", "monthly"]);
  const startDate = v.date(body.startDate, "startDate", { required: false });
  const endDate = v.date(body.endDate, "endDate", { required: false });
  await getActiveAsset(pool, assetId);

  // Dates are compared in SQL so "today" follows the database clock, the same one the scheduler uses.
  const { rows: [check] } = await pool.query(
    "SELECT COALESCE($1::date, CURRENT_DATE) < CURRENT_DATE AS in_past, COALESCE($1::date, CURRENT_DATE) AS start_date",
    [startDate ?? null]
  );
  if (check.in_past) throw new HttpError(400, "startDate cannot be in the past");
  if (endDate && endDate < check.start_date) throw new HttpError(400, "endDate must be on or after startDate");

  const sip = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO sip_plans (user_id, asset_id, amount, frequency, start_date, end_date, next_run_date)
       VALUES ($1, $2, $3, $4, $5, $6, $5) RETURNING id`,
      [req.user.id, assetId, amount, frequency, check.start_date, endDate ?? null]
    );
    await logAudit(client, { userId: req.user.id, action: "sip.create", entityType: "sip_plan", entityId: rows[0].id, details: { assetId, amount, frequency }, ip: req.ip });
    return findSip(client, req.user.id, rows[0].id);
  });
  res.status(201).json({ sip: camelize(sip) });
});

// Users can change the amount or end date, pause, resume or cancel. Cancelled and completed plans are final.
router.patch("/:id", async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const body = req.body ?? {};
  const amount = v.decimal(body.amount, "amount", { required: false, scale: 2 });
  const status = v.oneOf(body.status, "status", ["active", "paused", "cancelled"], { required: false });
  const endDate = v.date(body.endDate, "endDate", { required: false });
  if (amount === undefined && status === undefined && endDate === undefined) {
    throw new HttpError(400, "Provide at least one of amount, status, endDate");
  }

  const sip = await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT * FROM sip_plans WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, req.user.id]);
    const current = rows[0];
    if (!current) throw notFound("SIP plan");
    if (["cancelled", "completed"].includes(current.status)) throw new HttpError(409, `SIP plan is already ${current.status}`);
    if (endDate && endDate < current.start_date) throw new HttpError(400, "endDate must be on or after startDate");

    // Resuming does not back-fill: a plan paused past its run date restarts from today.
    await client.query(
      `UPDATE sip_plans SET
         amount = COALESCE($2, amount),
         status = COALESCE($3, status),
         end_date = COALESCE($4, end_date),
         next_run_date = CASE WHEN $3 = 'active' AND status = 'paused' AND next_run_date < CURRENT_DATE
                              THEN CURRENT_DATE ELSE next_run_date END,
         updated_at = NOW()
       WHERE id = $1`,
      [id, amount ?? null, status ?? null, endDate ?? null]
    );
    await logAudit(client, { userId: req.user.id, action: "sip.update", entityType: "sip_plan", entityId: id, details: { amount, status, endDate }, ip: req.ip });
    return findSip(client, req.user.id, id);
  });
  res.json({ sip: camelize(sip) });
});

export default router;
