// Deterministic mock price history: the same symbol always produces the same series,
// so charts don't jump around between reloads.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small seeded PRNG (mulberry32).
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Daily closes for the last `days` days ending today, finishing exactly at `endPrice`.
 * `volatility` is the daily standard deviation as a fraction (0.015 = 1.5%).
 */
export function generateSeries(key, endPrice, { days = 365, volatility = 0.015, drift = 0.0004 } = {}) {
  const rand = rng(hash(key));
  const steps = [];
  for (let i = 0; i < days; i++) {
    // Sum of uniforms approximates a normal distribution.
    const z = (rand() + rand() + rand() - 1.5) * 2;
    steps.push(drift + z * volatility);
  }
  // Walk backwards from today's price so the series ends where the quote says it does.
  const prices = new Array(days);
  prices[days - 1] = endPrice;
  for (let i = days - 2; i >= 0; i--) prices[i] = prices[i + 1] / (1 + steps[i + 1]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prices.map((price, i) => ({
    date: new Date(today.getTime() - (days - 1 - i) * DAY).toISOString().slice(0, 10),
    price: Math.round(price * 100) / 100,
  }));
}

export const RANGES = { "1W": 7, "1M": 30, "6M": 182, "1Y": 365 };
