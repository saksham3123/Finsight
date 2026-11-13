import { IPOS } from "../data/ipos";

/**
 * IPO calendar: open, upcoming and recently listed issues. The backend has no IPO endpoint
 * (it has no IPO data source), so this page stays on illustrative data in src/data/ipos.js.
 */
export function getIpos() {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(IPOS)), 250));
}
