import pool from "../db/pool.js";
import { QUOTE_COLUMNS, QUOTE_JOINS } from "./assets.js";

// Rule-based assistant: it recognises a few intents and answers only from the user's own data
// and the platform's market data, so it cannot invent facts. generateReply() is the single
// entry point, so it can later be swapped for an ML or LLM-backed implementation.

const DISCLAIMER = "This is informational only, not financial advice.";

const HELP =
  "I can help with:\n" +
  "- your portfolio (\"How is my portfolio doing?\")\n" +
  "- a specific asset (\"What about TCS?\" or \"BTC price\")\n" +
  "- your watchlist and SIP plans\n" +
  "- today's top signals (\"What should I buy?\")";

const money = (value, currency) =>
  value === null || value === undefined ? "n/a" : `${currency} ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const findMentionedAsset = async (text) => {
  const { rows } = await pool.query("SELECT id, symbol, name, asset_type, currency FROM assets WHERE is_active");
  const upper = text.toUpperCase();
  return (
    rows.find((asset) => new RegExp(`(^|[^A-Z0-9])${asset.symbol}([^A-Z0-9]|$)`).test(upper)) ||
    rows.find((asset) => upper.includes(asset.name.toUpperCase().replace(/ LTD$/, "")))
  );
};

const describeAsset = async (asset) => {
  const { rows: [quote] } = await pool.query(`SELECT ${QUOTE_COLUMNS} FROM assets a ${QUOTE_JOINS} WHERE a.id = $1`, [
    asset.id,
  ]);
  const { rows: [advisory] } = await pool.query(
    "SELECT * FROM advisories WHERE asset_id = $1 ORDER BY advisory_date DESC LIMIT 1",
    [asset.id]
  );
  const lines = [`${asset.name} (${asset.symbol}, ${asset.asset_type})`];
  if (quote.latest_price === null) {
    lines.push("No price data is available yet.");
  } else {
    const change = quote.change_pct === null ? "" : ` (${quote.change_pct >= 0 ? "+" : ""}${quote.change_pct}% vs previous close)`;
    lines.push(`Last close on ${quote.price_date}: ${money(quote.latest_price, asset.currency)}${change}.`);
  }
  if (advisory) {
    // The range forecast leads: unlike the direction signal, it has measurable out-of-sample skill.
    if (advisory.price_low !== null) {
      lines.push(
        `Forecast range: ${Math.round(advisory.range_level * 100)}% likely to close between ` +
          `${money(advisory.price_low, asset.currency)} and ${money(advisory.price_high, asset.currency)} ` +
          `in ${advisory.horizon_days} trading days.`
      );
    }
    lines.push(
      `Latest signal (${advisory.advisory_date}): ${advisory.signal.toUpperCase()} with confidence ` +
        `${Math.round(advisory.confidence * 100)}% and risk score ${advisory.risk_score}.`
    );
    if (advisory.rationale) lines.push(`Why: ${advisory.rationale}`);
    lines.push(DISCLAIMER);
  }
  return lines.join("\n");
};

const describePortfolio = async (userId) => {
  const { rows } = await pool.query(
    `SELECT a.currency,
            COUNT(*) AS positions,
            SUM(h.quantity * h.avg_buy_price) AS cost,
            SUM(h.quantity * lp.close) AS value
     FROM holdings h
     JOIN assets a ON a.id = h.asset_id
     ${QUOTE_JOINS}
     WHERE h.user_id = $1
     GROUP BY a.currency`,
    [userId]
  );
  if (!rows.length) return "You don't hold any assets yet. Record a buy transaction or start a SIP to build your portfolio.";
  const lines = rows.map((row) => {
    const pnl = row.value === null ? null : row.value - row.cost;
    const pct = pnl === null || !row.cost ? "" : ` (${pnl >= 0 ? "+" : ""}${((pnl / row.cost) * 100).toFixed(2)}%)`;
    return `${row.currency}: ${row.positions} position(s), invested ${money(row.cost, row.currency)}, ` +
      `now worth ${money(row.value, row.currency)}, unrealised P&L ${money(pnl, row.currency)}${pct}.`;
  });
  return ["Your portfolio:", ...lines].join("\n");
};

const describeWatchlist = async (userId) => {
  const { rows } = await pool.query(
    `SELECT a.symbol, a.currency, ${QUOTE_COLUMNS}
     FROM watchlist w JOIN assets a ON a.id = w.asset_id ${QUOTE_JOINS}
     WHERE w.user_id = $1 ORDER BY a.symbol`,
    [userId]
  );
  if (!rows.length) return "Your watchlist is empty.";
  return ["Your watchlist:", ...rows.map((r) => `- ${r.symbol}: ${money(r.latest_price, r.currency)}${r.change_pct === null ? "" : ` (${r.change_pct}%)`}`)].join("\n");
};

const describeSips = async (userId) => {
  const { rows } = await pool.query(
    `SELECT s.amount, s.frequency, s.next_run_date, a.symbol, a.currency
     FROM sip_plans s JOIN assets a ON a.id = s.asset_id
     WHERE s.user_id = $1 AND s.status = 'active' ORDER BY s.next_run_date`,
    [userId]
  );
  if (!rows.length) return "You have no active SIP plans.";
  return ["Your active SIPs:", ...rows.map((r) => `- ${money(r.amount, r.currency)} ${r.frequency} into ${r.symbol}, next on ${r.next_run_date}`)].join("\n");
};

const describeTopSignals = async () => {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (ad.asset_id) ad.signal, ad.confidence, ad.advisory_date, a.symbol
       FROM advisories ad JOIN assets a ON a.id = ad.asset_id
       WHERE a.is_active ORDER BY ad.asset_id, ad.advisory_date DESC
     ) latest
     WHERE signal = 'buy' ORDER BY confidence DESC LIMIT 5`
  );
  if (!rows.length) return `There are no BUY signals at the moment. ${DISCLAIMER}`;
  return [
    "Current BUY signals by confidence:",
    ...rows.map((r) => `- ${r.symbol}: ${Math.round(r.confidence * 100)}% (${r.advisory_date})`),
    DISCLAIMER,
  ].join("\n");
};

export const generateReply = async (userId, message) => {
  const text = message.toLowerCase();
  if (/\b(help|what can you do)\b/.test(text)) return HELP;
  if (/\b(portfolio|holdings?|p&l|pnl|profit|loss|invested)\b/.test(text)) return describePortfolio(userId);
  if (/\bwatch ?list\b/.test(text)) return describeWatchlist(userId);
  if (/\bsips?\b/.test(text)) return describeSips(userId);

  const asset = await findMentionedAsset(message);
  if (asset) return describeAsset(asset);

  if (/\b(buy|sell|recommend|should i|signals?|advice)\b/.test(text)) return describeTopSignals();
  return `I'm not sure how to help with that yet.\n${HELP}`;
};
