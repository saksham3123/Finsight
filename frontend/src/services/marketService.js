import { api } from "./api";
import { rangeStart } from "../utils/ranges";

/** GET /assets?type= → quotes with latestPrice, previousClose, changePct, priceDate and currency. */
export const getAssets = (type) => api.get("/assets", { params: type ? { type } : {} }).then((r) => r.assets);

/** GET /assets/:id → { asset, latestAdvisory, sentiment7d } */
export const getAssetDetail = (id) => api.get(`/assets/${id}`);

/** Daily closes for a range key from RANGES, oldest first, as [{ date, price }] for the charts. */
export const getHistory = (id, range = "6M") =>
  api
    .get(`/assets/${id}/prices`, { params: { from: rangeStart(range) } })
    .then((r) => r.prices.map((p) => ({ date: p.date, price: p.close })));

/** GET /advisories → the latest advisory per asset, highest confidence first. */
export const getAdvisories = (params = {}) => api.get("/advisories", { params }).then((r) => r.advisories);
