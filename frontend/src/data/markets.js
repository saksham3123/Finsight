// Mock market quotes (INR). Illustrative numbers only, not live prices.

export const STOCKS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", price: 2948.6, change: 1.24 },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", price: 4102.35, change: -0.62 },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking", price: 1689.1, change: 0.48 },
  { symbol: "INFY", name: "Infosys", sector: "IT", price: 1876.4, change: -1.15 },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Banking", price: 1284.75, change: 0.92 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", price: 1612.2, change: 2.05 },
  { symbol: "ITC", name: "ITC", sector: "FMCG", price: 468.9, change: -0.21 },
  { symbol: "SBIN", name: "State Bank of India", sector: "Banking", price: 812.45, change: 0.37 },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Infrastructure", price: 3721.0, change: -0.84 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG", price: 2389.55, change: 0.11 },
];

export const CRYPTO = [
  { symbol: "BTC", name: "Bitcoin", sector: "Layer 1", price: 5684200, change: 2.31 },
  { symbol: "ETH", name: "Ethereum", sector: "Layer 1", price: 284350, change: 1.42 },
  { symbol: "SOL", name: "Solana", sector: "Layer 1", price: 14820, change: -3.18 },
  { symbol: "BNB", name: "BNB", sector: "Exchange", price: 51230, change: 0.56 },
  { symbol: "XRP", name: "XRP", sector: "Payments", price: 52.4, change: -1.92 },
  { symbol: "ADA", name: "Cardano", sector: "Layer 1", price: 38.75, change: 0.84 },
  { symbol: "DOGE", name: "Dogecoin", sector: "Meme", price: 13.62, change: 5.47 },
  { symbol: "MATIC", name: "Polygon", sector: "Layer 2", price: 47.1, change: -0.73 },
];

// Price history settings per asset class: crypto swings harder than large-cap stocks.
export const SERIES_SETTINGS = {
  stock: { volatility: 0.014, drift: 0.0005 },
  crypto: { volatility: 0.035, drift: 0.001 },
};
