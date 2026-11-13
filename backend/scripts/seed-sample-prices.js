// Generates SYNTHETIC daily prices so charts, portfolio valuation, SIPs and advisories can be
// demonstrated without a market-data provider. These are NOT real market prices; replace them
// with real data via `npm run import:prices` or PUT /api/assets/:id/prices.
// Usage: npm run seed:sample-prices [-- <days>]   (default 400 days)
import "../src/config/env.js";
import pool from "../src/db/pool.js";
import { upsertCandles } from "../src/services/assets.js";

// Rough starting levels so the numbers look plausible in the UI.
const START_PRICE = {
  RELIANCE: 1300, TCS: 3500, HDFCBANK: 1700, INFY: 1600, ICICIBANK: 1250,
  HINDUNILVR: 2400, ITC: 420, SBIN: 800, BHARTIARTL: 1600, LT: 3500,
  BTC: 60000, ETH: 3000, SOL: 150, BNB: 550, XRP: 0.6,
};

const days = Number(process.argv[2]) || 400;

// Deterministic pseudo-random generator so every run produces the same series.
const seededRandom = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

try {
  const { rows: assets } = await pool.query("SELECT id, symbol, asset_type FROM assets WHERE is_active ORDER BY symbol");
  for (const [n, asset] of assets.entries()) {
    const random = seededRandom(n + 1);
    const dailyVol = asset.asset_type === "crypto" ? 0.035 : 0.015;
    const drift = (random() - 0.4) * 0.002;
    let close = START_PRICE[asset.symbol] ?? 100;
    const candles = [];

    for (let d = days - 1; d >= 0; d -= 1) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      const open = close;
      close = Math.max(open * Math.exp(drift + dailyVol * (random() * 2 - 1) * 1.7), 0.0001);
      const high = Math.max(open, close) * (1 + random() * dailyVol * 0.5);
      const low = Math.min(open, close) * (1 - random() * dailyVol * 0.5);
      const volume = Math.round((asset.asset_type === "crypto" ? 20_000 : 2_000_000) * (0.5 + random()));
      candles.push({ date, open: open.toFixed(8), high: high.toFixed(8), low: low.toFixed(8), close: close.toFixed(8), volume: String(volume) });
    }
    await upsertCandles(pool, asset.id, candles);
    console.log(`${asset.symbol.padEnd(10)} ${candles.length} synthetic candles, last close ${close.toFixed(2)}`);
  }
  console.log("Done. Remember: these prices are synthetic demo data.");
} catch (error) {
  console.error("Sample price generation failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
