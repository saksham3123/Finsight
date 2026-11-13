// Chart time ranges, in calendar days. The backend stores up to ~20 years of real daily prices.
export const RANGES = { "1M": 30, "6M": 182, "1Y": 365, "5Y": 1826 };

/** YYYY-MM-DD for the first day of a range key, for the prices endpoint's `from` parameter. */
export function rangeStart(range) {
  const d = new Date();
  d.setDate(d.getDate() - RANGES[range]);
  return d.toISOString().slice(0, 10);
}

export const describeRange = (range) => ({ "1M": "the last month", "6M": "the last 6 months", "1Y": "the last year", "5Y": "the last 5 years" })[range];
