import { api } from "./api";
import { getHistory } from "./marketService";

/** GET /portfolio → { holdings, totals }. Totals have one row per currency (INR stocks, USD crypto). */
export const getPortfolio = () => api.get("/portfolio");

/** POST /transactions. `price` is omitted so the backend uses the latest close. */
export const trade = (assetId, type, quantity) =>
  api.post("/transactions", { assetId, type, quantity: String(quantity) });

/** GET /transactions, newest first. */
export const getTransactions = (params = { limit: 10 }) => api.get("/transactions", { params }).then((r) => r.transactions);

/** Watchlist: GET returns items with latest quotes; POST is idempotent. */
export const getWatchlist = () => api.get("/watchlist").then((r) => r.items);
export const addToWatchlist = (assetId) => api.post("/watchlist", { assetId });
export const removeFromWatchlist = (assetId) => api.delete(`/watchlist/${assetId}`);

/**
 * Daily value of the given holdings over a range, at today's quantities. The backend has no
 * portfolio-history endpoint, so each asset's closes are fetched and summed here. A date where
 * an asset has no candle (exchange holiday) carries its previous close forward.
 */
export async function getPerformance(holdings, range) {
  const histories = await Promise.all(holdings.map((h) => getHistory(h.assetId, range)));
  const dates = [...new Set(histories.flat().map((p) => p.date))].sort();
  const cursors = histories.map(() => 0);
  const last = histories.map(() => null);
  return dates
    .map((date) => {
      let value = 0;
      histories.forEach((series, i) => {
        while (cursors[i] < series.length && series[cursors[i]].date <= date) last[i] = series[cursors[i]++].price;
        if (last[i] !== null) value += last[i] * holdings[i].quantity;
      });
      // Skip leading dates before every holding has a price, so the line doesn't jump up.
      return last.every((p) => p !== null) ? { date, price: Math.round(value * 100) / 100 } : null;
    })
    .filter(Boolean);
}
