import { api } from "./api";

/** GET /sips → plans with symbol, amount, frequency, nextRunDate, status and executions count. */
export const getSips = () => api.get("/sips").then((r) => r.sips);

/** POST /sips. startDate defaults to today on the server. */
export const createSip = ({ assetId, amount, frequency, startDate, endDate }) =>
  api
    .post("/sips", { assetId, amount: String(amount), frequency, startDate: startDate || undefined, endDate: endDate || undefined })
    .then((r) => r.sip);

/** PATCH /sips/:id, e.g. { status: "paused" }. Cancelled and completed plans return 409. */
export const updateSip = (id, changes) => api.patch(`/sips/${id}`, changes).then((r) => r.sip);
