import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAdmin, requireAdminOrService, requireAuth } from "../middleware/auth.js";
import { ASSET_COLUMNS, QUOTE_COLUMNS, QUOTE_JOINS, upsertCandles, validateCandle } from "../services/assets.js";
import { logAudit } from "../services/audit.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { camelize, camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();

// Market data is public so the landing pages can show prices without logging in.

router.get("/", async (req, res) => {
  const { limit, offset } = v.pagination(req.query, { defaultLimit: 100 });
  const type = v.oneOf(req.query.type, "type", ["stock", "crypto"], { required: false });
  const q = v.string(req.query.q, "q", { required: false, max: 100 });
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS}, ${QUOTE_COLUMNS}
     FROM assets a ${QUOTE_JOINS}
     WHERE a.is_active
       AND ($1::text IS NULL OR a.asset_type = $1)
       AND ($2::text IS NULL OR a.symbol ILIKE $2 OR a.name ILIKE $2)
     ORDER BY a.asset_type DESC, a.symbol
     LIMIT $3 OFFSET $4`,
    [type ?? null, q ? v.likePattern(q) : null, limit, offset]
  );
  res.json({ assets: camelizeAll(rows), limit, offset });
});

const findAsset = async (id) => {
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS}, ${QUOTE_COLUMNS} FROM assets a ${QUOTE_JOINS} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw notFound("Asset");
  return rows[0];
};

router.get("/:id", async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const asset = await findAsset(id);
  const { rows: [advisory] } = await pool.query(
    "SELECT * FROM advisories WHERE asset_id = $1 ORDER BY advisory_date DESC LIMIT 1",
    [id]
  );
  const { rows: [sentiment] } = await pool.query(
    `SELECT ROUND(AVG(sentiment_score), 4) AS average, COUNT(*) AS articles
     FROM news_sentiment WHERE asset_id = $1 AND published_at > NOW() - INTERVAL '7 days'`,
    [id]
  );
  res.json({ asset: camelize(asset), latestAdvisory: camelize(advisory) ?? null, sentiment7d: camelize(sentiment) });
});

router.get("/:id/prices", async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const from = v.date(req.query.from, "from", { required: false });
  const to = v.date(req.query.to, "to", { required: false });
  await findAsset(id);
  // Without a range, return the most recent year.
  const { rows } = await pool.query(
    `SELECT date, open, high, low, close, volume FROM price_history
     WHERE asset_id = $1
       AND date >= COALESCE($2::date, CURRENT_DATE - INTERVAL '365 days')
       AND date <= COALESCE($3::date, CURRENT_DATE)
     ORDER BY date`,
    [id, from ?? null, to ?? null]
  );
  res.json({ assetId: id, prices: rows });
});

router.get("/:id/advisories", async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const { limit, offset } = v.pagination(req.query, { defaultLimit: 30 });
  await findAsset(id);
  const { rows } = await pool.query(
    "SELECT * FROM advisories WHERE asset_id = $1 ORDER BY advisory_date DESC LIMIT $2 OFFSET $3",
    [id, limit, offset]
  );
  res.json({ advisories: camelizeAll(rows), limit, offset });
});

const assetFields = (body, { partial }) => {
  const required = !partial;
  return {
    symbol: v.string(body.symbol, "symbol", { required, max: 20 })?.toUpperCase(),
    name: v.string(body.name, "name", { required, max: 150 }),
    assetType: v.oneOf(body.assetType, "assetType", ["stock", "crypto"], { required }),
    exchange: v.string(body.exchange, "exchange", { required: false, max: 30 }),
    currency: v.string(body.currency, "currency", { required: false, max: 3 })?.toUpperCase(),
    isActive: v.boolean(body.isActive, "isActive", { required: false }),
  };
};

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const fields = assetFields(req.body ?? {}, { partial: false });
  if (fields.currency && fields.currency.length !== 3) throw new HttpError(400, "currency must be a 3-letter code");
  try {
    const asset = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO assets (symbol, name, asset_type, exchange, currency)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'INR')) RETURNING *`,
        [fields.symbol, fields.name, fields.assetType, fields.exchange ?? null, fields.currency ?? null]
      );
      await logAudit(client, { userId: req.user.id, action: "asset.create", entityType: "asset", entityId: rows[0].id, ip: req.ip });
      return rows[0];
    });
    res.status(201).json({ asset: camelize(asset) });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, `${fields.symbol} already exists as a ${fields.assetType}`);
    throw error;
  }
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const { name, exchange, currency, isActive } = assetFields(req.body ?? {}, { partial: true });
  if (currency && currency.length !== 3) throw new HttpError(400, "currency must be a 3-letter code");
  const asset = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE assets SET
         name = COALESCE($2, name), exchange = COALESCE($3, exchange),
         currency = COALESCE($4, currency), is_active = COALESCE($5, is_active), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, name ?? null, exchange ?? null, currency ?? null, isActive ?? null]
    );
    if (!rows[0]) throw notFound("Asset");
    await logAudit(client, { userId: req.user.id, action: "asset.update", entityType: "asset", entityId: id, details: req.body, ip: req.ip });
    return rows[0];
  });
  res.json({ asset: camelize(asset) });
});

// Bulk price ingestion for the ML/data service or an admin. Existing dates are overwritten.
// replace: true first deletes every stored candle for the asset (e.g. synthetic demo prices),
// in the same transaction, so readers never see a half-replaced history.
router.put("/:id/prices", requireAdminOrService, async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const candles = v.array(req.body?.candles, "candles", { max: 5000 }).map((candle, i) => validateCandle(candle, `candles[${i}]`));
  const replace = v.boolean(req.body.replace, "replace", { required: false }) ?? false;
  await findAsset(id);
  const result = await withTransaction(async (client) => {
    const deleted = replace ? (await client.query("DELETE FROM price_history WHERE asset_id = $1", [id])).rowCount : 0;
    return { deleted, upserted: await upsertCandles(client, id, candles) };
  });
  res.json({ assetId: id, ...result });
});

export default router;
