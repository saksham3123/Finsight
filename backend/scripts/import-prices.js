// Imports daily OHLCV candles from a CSV file into price_history.
// Usage: npm run import:prices -- <file.csv> <SYMBOL> <stock|crypto>
// Expected header (Yahoo Finance export format; extra columns such as "Adj Close" are ignored):
//   Date,Open,High,Low,Close,Volume
import fs from "fs/promises";
import "../src/config/env.js";
import pool from "../src/db/pool.js";
import { upsertCandles, validateCandle } from "../src/services/assets.js";

const [file, symbolArg, assetType] = process.argv.slice(2);
if (!file || !symbolArg || !["stock", "crypto"].includes(assetType)) {
  console.error("Usage: npm run import:prices -- <file.csv> <SYMBOL> <stock|crypto>");
  process.exit(1);
}

const toDecimal = (text) => {
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number.toFixed(8) : null;
};

try {
  const symbol = symbolArg.toUpperCase();
  const { rows } = await pool.query("SELECT id FROM assets WHERE symbol = $1 AND asset_type = $2", [symbol, assetType]);
  if (!rows[0]) throw new Error(`No ${assetType} with symbol ${symbol}. Create it first (POST /api/assets or npm run seed).`);

  const [header, ...lines] = (await fs.readFile(file, "utf8")).trim().split(/\r?\n/);
  const columns = header.split(",").map((name) => name.trim().toLowerCase());
  const index = (name) => {
    const i = columns.indexOf(name);
    if (i === -1) throw new Error(`CSV is missing the "${name}" column`);
    return i;
  };
  const at = { date: index("date"), open: index("open"), high: index("high"), low: index("low"), close: index("close") };
  const volumeAt = columns.indexOf("volume");

  const candles = [];
  const skipped = [];
  for (const [lineNo, line] of lines.entries()) {
    const cells = line.split(",").map((cell) => cell.trim());
    const raw = {
      date: cells[at.date]?.slice(0, 10),
      open: toDecimal(cells[at.open]),
      high: toDecimal(cells[at.high]),
      low: toDecimal(cells[at.low]),
      close: toDecimal(cells[at.close]),
      volume: volumeAt === -1 ? "0" : toDecimal(cells[volumeAt]) ?? "0",
    };
    try {
      candles.push(validateCandle(raw, `line ${lineNo + 2}`));
    } catch (error) {
      skipped.push(error.message);
    }
  }

  let upserted = 0;
  for (let i = 0; i < candles.length; i += 5000) {
    upserted += await upsertCandles(pool, rows[0].id, candles.slice(i, i + 5000));
  }
  console.log(`Imported ${upserted} candles for ${symbol}. Skipped ${skipped.length} invalid rows.`);
  skipped.slice(0, 10).forEach((message) => console.log(`  - ${message}`));
} catch (error) {
  console.error("Import failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
