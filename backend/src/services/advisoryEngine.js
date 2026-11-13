import pool from "../db/pool.js";

// Baseline advisory generator built on simple technical indicators. It gives the platform
// working advisories before the ML service exists; ML output posted to /api/advisories
// replaces it for the same asset and day (one advisory per asset per day).
export const MODEL_VERSION = "baseline-sma-v1";
const MIN_CANDLES = 50;

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round4 = (value) => Math.round(value * 10_000) / 10_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Pure function so the rules can be unit-tested without a database.
// closes: oldest-to-newest closing prices. sentiment: average news score in -1..1, or null.
export const computeAdvisory = (closes, sentiment = null) => {
  if (closes.length < MIN_CANDLES) return null;

  const last = closes.at(-1);
  const sma20 = mean(closes.slice(-20));
  const sma50 = mean(closes.slice(-50));
  const recent = closes.slice(-31);
  const returns = recent.slice(1).map((close, i) => Math.log(close / recent[i]));
  const avgReturn = mean(returns);
  const dailyVol = Math.sqrt(mean(returns.map((r) => (r - avgReturn) ** 2)));
  // Crypto trades every day, but 252 keeps scores comparable with stocks.
  const annualVol = dailyVol * Math.sqrt(252);
  const trendGap = (sma20 - sma50) / sma50;

  const riskScore = clamp(annualVol, 0, 1);
  let signal;
  if (riskScore >= 0.85) signal = "high_risk";
  else if (trendGap > 0.02 && last > sma20) signal = "buy";
  else if (trendGap < -0.02 && last < sma20) signal = "sell";
  else if (Math.abs(trendGap) <= 0.01) signal = "hold";
  else signal = "watch";

  if (signal === "buy" && sentiment !== null && sentiment < -0.5) signal = "watch";
  if (signal === "sell" && sentiment !== null && sentiment > 0.5) signal = "watch";

  const confidence = clamp(0.5 + Math.abs(trendGap) * 5, 0.5, 0.95);
  const rationale =
    `20-day SMA ${sma20.toFixed(2)} vs 50-day SMA ${sma50.toFixed(2)} (gap ${(trendGap * 100).toFixed(2)}%), ` +
    `last close ${last.toFixed(2)}, annualised volatility ${(annualVol * 100).toFixed(1)}%` +
    (sentiment === null ? "." : `, 7-day news sentiment ${sentiment.toFixed(2)}.`);

  return {
    signal,
    riskScore: round4(riskScore),
    confidence: round4(confidence),
    sentimentScore: sentiment === null ? null : round4(sentiment),
    rationale,
  };
};

// Generates today's baseline advisory for every active asset with enough price history.
// Existing advisories from other models are left untouched.
export const generateAdvisories = async () => {
  const { rows: assets } = await pool.query("SELECT id, symbol FROM assets WHERE is_active ORDER BY symbol");
  const summary = { generated: 0, skipped: [] };

  for (const asset of assets) {
    const { rows: candles } = await pool.query(
      "SELECT close FROM (SELECT date, close FROM price_history WHERE asset_id = $1 ORDER BY date DESC LIMIT 60) t ORDER BY date",
      [asset.id]
    );
    const { rows: [news] } = await pool.query(
      "SELECT AVG(sentiment_score) AS avg FROM news_sentiment WHERE asset_id = $1 AND published_at > NOW() - INTERVAL '7 days'",
      [asset.id]
    );
    const advisory = computeAdvisory(candles.map((c) => c.close), news.avg);
    if (!advisory) {
      summary.skipped.push(asset.symbol);
      continue;
    }

    const { rowCount } = await pool.query(
      `INSERT INTO advisories (asset_id, advisory_date, signal, sentiment_score, risk_score, confidence, rationale, model_version)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (asset_id, advisory_date) DO UPDATE SET
         signal = EXCLUDED.signal, sentiment_score = EXCLUDED.sentiment_score, risk_score = EXCLUDED.risk_score,
         confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model_version = EXCLUDED.model_version
       WHERE advisories.model_version = $7`,
      [asset.id, advisory.signal, advisory.sentimentScore, advisory.riskScore, advisory.confidence, advisory.rationale, MODEL_VERSION]
    );
    if (rowCount) summary.generated += 1;
    else summary.skipped.push(`${asset.symbol} (has advisory from another model)`);
  }
  return summary;
};
