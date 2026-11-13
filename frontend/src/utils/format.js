// Stocks are priced in INR and crypto in USD (Binance USDT pairs), so money is always
// formatted with the asset's own currency. Formatters are cached per currency and style.
const cache = new Map();
function moneyFormatter(currency, style) {
  const key = `${currency}:${style}`;
  if (!cache.has(key)) {
    const locale = currency === "INR" ? "en-IN" : "en-US";
    const options = { style: "currency", currency };
    if (style === "whole") options.maximumFractionDigits = 0;
    // Three significant digits, so close axis ticks stay distinct (₹1.35K vs ₹1.4K).
    else if (style === "compact") Object.assign(options, { notation: "compact", maximumSignificantDigits: 3 });
    else options.maximumFractionDigits = 2;
    cache.set(key, new Intl.NumberFormat(locale, options));
  }
  return cache.get(key);
}

/** ₹1,23,456.78 or $1,234.56. `whole` drops the decimals for large totals. */
export const formatMoney = (n, currency = "INR", { whole = false } = {}) =>
  moneyFormatter(currency, whole ? "whole" : "plain").format(n);

/** ₹1.2L / $3.4K style, for chart axes where space is tight. */
export const formatMoneyCompact = (n, currency = "INR") => moneyFormatter(currency, "compact").format(n);

/** +₹1,234 / -$1,234 */
export const formatSignedMoney = (n, currency = "INR", opts) =>
  `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatMoney(Math.abs(n), currency, opts)}`;

/** +1.24% / -0.62% */
export const formatPct = (n, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

/** Up to 8 decimals (crypto quantities), without trailing zeros. */
export const formatQuantity = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 8 }).format(n);

const dateShort = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const dateLong = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const formatDate = (iso, long = false) => (long ? dateLong : dateShort).format(new Date(iso));

// INR shorthands, kept for the SIP calculator and IPO pages which are rupee-only.
export const formatINR = (n, opts) => formatMoney(n, "INR", opts);
export const formatINRCompact = (n) => formatMoneyCompact(n, "INR");
