import { Router } from "express";
import pool from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ASSET_COLUMNS, QUOTE_COLUMNS, QUOTE_JOINS, getActiveAsset } from "../services/assets.js";
import { notFound } from "../utils/httpError.js";
import { camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.id AS watchlist_id, w.created_at AS added_at, ${ASSET_COLUMNS}, ${QUOTE_COLUMNS}
     FROM watchlist w JOIN assets a ON a.id = w.asset_id ${QUOTE_JOINS}
     WHERE w.user_id = $1
     ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json({ items: camelizeAll(rows) });
});

// Idempotent: adding an asset that is already watched returns 200 instead of an error.
router.post("/", async (req, res) => {
  const assetId = v.uuid(req.body?.assetId, "assetId");
  await getActiveAsset(pool, assetId);
  const { rowCount } = await pool.query(
    "INSERT INTO watchlist (user_id, asset_id) VALUES ($1, $2) ON CONFLICT (user_id, asset_id) DO NOTHING",
    [req.user.id, assetId]
  );
  res.status(rowCount ? 201 : 200).json({ assetId, added: rowCount === 1 });
});

router.delete("/:assetId", async (req, res) => {
  const assetId = v.uuid(req.params.assetId, "assetId");
  const { rowCount } = await pool.query("DELETE FROM watchlist WHERE user_id = $1 AND asset_id = $2", [req.user.id, assetId]);
  if (!rowCount) throw notFound("Watchlist item");
  res.status(204).end();
});

export default router;
