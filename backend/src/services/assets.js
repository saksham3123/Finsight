import { HttpError, notFound } from "../utils/httpError.js";
import * as v from "../utils/validate.js";

// SQL columns and joins that add the latest quote to a query over `assets a`.
export const QUOTE_COLUMNS = `
  lp.close AS latest_price,
  lp.date AS price_date,
  pp.close AS previous_close,
  ROUND((lp.close - pp.close) / NULLIF(pp.close, 0) * 100, 2) AS change_pct`;

export const QUOTE_JOINS = `
  LEFT JOIN LATERAL (
    SELECT close, date FROM price_history WHERE asset_id = a.id ORDER BY date DESC LIMIT 1
  ) lp ON TRUE
  LEFT JOIN LATERAL (
    SELECT close FROM price_history WHERE asset_id = a.id ORDER BY date DESC OFFSET 1 LIMIT 1
  ) pp ON TRUE`;

export const ASSET_COLUMNS = "a.id, a.symbol, a.name, a.asset_type, a.exchange, a.currency, a.is_active";

export const getActiveAsset = async (db, assetId) => {
  const { rows } = await db.query("SELECT * FROM assets WHERE id = $1", [assetId]);
  if (!rows[0]) throw notFound("Asset");
  if (!rows[0].is_active) throw new HttpError(400, "Asset is not active");
  return rows[0];
};

export const latestClose = async (db, assetId) => {
  const { rows } = await db.query(
    "SELECT close FROM price_history WHERE asset_id = $1 ORDER BY date DESC LIMIT 1",
    [assetId]
  );
  return rows[0]?.close ?? null;
};

// Ingestion payloads may identify an asset by id or by symbol + assetType (what the ML service knows).
export const resolveAssetId = async (db, item, field) => {
  if (item.assetId !== undefined) {
    const id = v.uuid(item.assetId, `${field}.assetId`);
    const { rows } = await db.query("SELECT id FROM assets WHERE id = $1", [id]);
    if (!rows[0]) throw new HttpError(400, `${field}.assetId does not match an asset`);
    return id;
  }
  const symbol = v.string(item.symbol, `${field}.symbol`, { max: 20 }).toUpperCase();
  const assetType = v.oneOf(item.assetType, `${field}.assetType`, ["stock", "crypto"]);
  const { rows } = await db.query("SELECT id FROM assets WHERE symbol = $1 AND asset_type = $2", [symbol, assetType]);
  if (!rows[0]) throw new HttpError(400, `${field}: no ${assetType} with symbol ${symbol}`);
  return rows[0].id;
};

export const validateCandle = (candle, field) => {
  const row = {
    date: v.date(candle?.date, `${field}.date`),
    open: v.decimal(candle.open, `${field}.open`, { allowZero: true }),
    high: v.decimal(candle.high, `${field}.high`, { allowZero: true }),
    low: v.decimal(candle.low, `${field}.low`, { allowZero: true }),
    close: v.decimal(candle.close, `${field}.close`, { allowZero: true }),
    volume: v.decimal(candle.volume ?? "0", `${field}.volume`, { allowZero: true }),
  };
  if (Number(row.high) < Number(row.low)) throw new HttpError(400, `${field}.high must be >= low`);
  return row;
};

// Bulk upsert in one statement: unnest() turns parallel arrays into rows.
export const upsertCandles = async (db, assetId, candles) => {
  const column = (key) => candles.map((candle) => candle[key]);
  const { rowCount } = await db.query(
    `INSERT INTO price_history (asset_id, date, open, high, low, close, volume)
     SELECT $1, * FROM unnest($2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
     ON CONFLICT (asset_id, date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume`,
    [assetId, column("date"), column("open"), column("high"), column("low"), column("close"), column("volume")]
  );
  return rowCount;
};
