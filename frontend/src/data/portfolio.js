// Mock portfolio for the signed-in demo user. Current prices come from markets.js.

export const HOLDINGS = [
  { symbol: "RELIANCE", type: "stock", quantity: 40, avgPrice: 2610.0 },
  { symbol: "TCS", type: "stock", quantity: 15, avgPrice: 3860.5 },
  { symbol: "HDFCBANK", type: "stock", quantity: 60, avgPrice: 1592.0 },
  { symbol: "INFY", type: "stock", quantity: 35, avgPrice: 1924.8 },
  { symbol: "ITC", type: "stock", quantity: 200, avgPrice: 431.25 },
  { symbol: "BTC", type: "crypto", quantity: 0.04, avgPrice: 4920000 },
  { symbol: "ETH", type: "crypto", quantity: 0.6, avgPrice: 301500 },
];

export const ADVISORY = [
  {
    symbol: "RELIANCE",
    action: "Buy",
    confidence: 78,
    target: 3250,
    reason: "Retail and telecom earnings are improving and the stock is holding above its 50-day average.",
  },
  {
    symbol: "INFY",
    action: "Hold",
    confidence: 64,
    target: 1950,
    reason: "Deal wins are steady but margin guidance is flat; wait for the next quarterly update.",
  },
  {
    symbol: "ITC",
    action: "Hold",
    confidence: 59,
    target: 495,
    reason: "Defensive FMCG exposure with a stable dividend; limited upside in the near term.",
  },
  {
    symbol: "ETH",
    action: "Sell",
    confidence: 55,
    target: 262000,
    reason: "Position is below its average cost and momentum is weakening; consider trimming to cut risk.",
  },
];
