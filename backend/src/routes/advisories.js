import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAdminOrService } from "../middleware/auth.js";
import { resolveAssetId } from "../services/assets.js";
import { HttpError } from "../utils/httpError.js";
import { camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();

const SIGNALS = ["buy", "hold", "sell", "watch", "high_risk"];

// Latest advisory per asset, optionally filtered by that latest signal.
router.get("/", async (req, res) => {
  const signal = v.oneOf(req.query.signal, "signal", SIGNALS, { required: false });
  const type = v.oneOf(req.query.type, "type", ["stock", "crypto"], { required: false });
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (ad.asset_id)
              ad.id, ad.asset_id, a.symbol, a.name, a.asset_type, ad.advisory_date, ad.signal,
              ad.sentiment_score, ad.risk_score, ad.confidence, ad.rationale, ad.model_version, ad.created_at,
              ad.price_low, ad.price_high, ad.range_level, ad.horizon_days, ad.range_model_version, a.currency
       FROM advisories ad JOIN assets a ON a.id = ad.asset_id
       WHERE a.is_active AND ($2::text IS NULL OR a.asset_type = $2)
       ORDER BY ad.asset_id, ad.advisory_date DESC
     ) latest
     WHERE $1::text IS NULL OR signal = $1
     ORDER BY confidence DESC NULLS LAST, symbol`,
    [signal ?? null, type ?? null]
  );
  res.json({ advisories: camelizeAll(rows) });
});

// Optional range forecast: all four fields together, or none (baseline advisories have no range).
const RANGE_FIELDS = ["priceLow", "priceHigh", "rangeLevel", "horizonDays"];
const parseRange = (item, field) => {
  const present = RANGE_FIELDS.filter((key) => item[key] !== undefined && item[key] !== null);
  if (present.length === 0) return { low: null, high: null, level: null, horizon: null, version: null };
  if (present.length < RANGE_FIELDS.length) {
    throw new HttpError(400, `${field}: priceLow, priceHigh, rangeLevel and horizonDays must be sent together`);
  }
  const low = v.decimal(item.priceLow, `${field}.priceLow`);
  const high = v.decimal(item.priceHigh, `${field}.priceHigh`);
  if (Number(high) < Number(low)) throw new HttpError(400, `${field}.priceHigh must be >= priceLow`);
  const level = v.score(item.rangeLevel, `${field}.rangeLevel`, 0, 1);
  if (level <= 0 || level >= 1) throw new HttpError(400, `${field}.rangeLevel must be between 0 and 1 (exclusive)`);
  const horizon = Number(item.horizonDays);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) {
    throw new HttpError(400, `${field}.horizonDays must be a whole number from 1 to 60`);
  }
  const version = v.string(item.rangeModelVersion, `${field}.rangeModelVersion`, { required: false, max: 50 }) ?? null;
  return { low, high, level, horizon, version };
};

// Ingestion endpoint for the ML service: upserts one advisory per asset per day.
router.post("/", requireAdminOrService, async (req, res) => {
  const items = v.array(req.body?.advisories, "advisories", { max: 1000 });
  const upserted = await withTransaction(async (client) => {
    let count = 0;
    for (const [i, item] of items.entries()) {
      const field = `advisories[${i}]`;
      const assetId = await resolveAssetId(client, item ?? {}, field);
      const range = parseRange(item, field);
      await client.query(
        `INSERT INTO advisories (asset_id, advisory_date, signal, sentiment_score, risk_score, confidence, rationale, model_version,
                                 price_low, price_high, range_level, horizon_days, range_model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (asset_id, advisory_date) DO UPDATE SET
           signal = EXCLUDED.signal, sentiment_score = EXCLUDED.sentiment_score, risk_score = EXCLUDED.risk_score,
           confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model_version = EXCLUDED.model_version,
           price_low = EXCLUDED.price_low, price_high = EXCLUDED.price_high, range_level = EXCLUDED.range_level,
           horizon_days = EXCLUDED.horizon_days, range_model_version = EXCLUDED.range_model_version`,
        [
          assetId,
          v.date(item.date, `${field}.date`),
          v.oneOf(item.signal, `${field}.signal`, SIGNALS),
          v.score(item.sentimentScore, `${field}.sentimentScore`, -1, 1, { required: false }) ?? null,
          v.score(item.riskScore, `${field}.riskScore`, 0, 1, { required: false }) ?? null,
          v.score(item.confidence, `${field}.confidence`, 0, 1, { required: false }) ?? null,
          v.string(item.rationale, `${field}.rationale`, { required: false, max: 5000 }) ?? null,
          v.string(item.modelVersion, `${field}.modelVersion`, { required: false, max: 50 }) ?? null,
          range.low,
          range.high,
          range.level,
          range.horizon,
          range.version,
        ]
      );
      count += 1;
    }
    return count;
  });
  res.json({ upserted });
});

export default router;
