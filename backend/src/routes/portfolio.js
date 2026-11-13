import { Router } from "express";
import pool from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { QUOTE_JOINS } from "../services/assets.js";
import { camelizeAll } from "../utils/serialize.js";

const router = Router();
router.use(requireAuth);

// Valuation uses the latest close of each asset. Totals are grouped by currency because
// adding INR stock values to USD crypto values would be meaningless without FX rates.
router.get("/", async (req, res) => {
  const { rows: holdings } = await pool.query(
    `SELECT h.asset_id, a.symbol, a.name, a.asset_type, a.currency,
            h.quantity, h.avg_buy_price,
            lp.close AS latest_price, lp.date AS price_date,
            h.quantity * h.avg_buy_price AS cost_basis,
            h.quantity * lp.close AS market_value,
            h.quantity * (lp.close - h.avg_buy_price) AS unrealized_pnl,
            ROUND((lp.close - h.avg_buy_price) / NULLIF(h.avg_buy_price, 0) * 100, 2) AS unrealized_pnl_pct,
            ROUND(h.quantity * lp.close / NULLIF(SUM(h.quantity * lp.close) OVER (PARTITION BY a.currency), 0) * 100, 2)
              AS allocation_pct
     FROM holdings h JOIN assets a ON a.id = h.asset_id ${QUOTE_JOINS}
     WHERE h.user_id = $1
     ORDER BY a.currency, market_value DESC NULLS LAST`,
    [req.user.id]
  );

  const { rows: totals } = await pool.query(
    `SELECT a.currency,
            COUNT(*) AS positions,
            SUM(h.quantity * h.avg_buy_price) AS cost_basis,
            SUM(h.quantity * lp.close) AS market_value,
            SUM(h.quantity * (lp.close - h.avg_buy_price)) AS unrealized_pnl,
            ROUND(SUM(h.quantity * (lp.close - h.avg_buy_price)) / NULLIF(SUM(h.quantity * h.avg_buy_price), 0) * 100, 2)
              AS unrealized_pnl_pct
     FROM holdings h JOIN assets a ON a.id = h.asset_id ${QUOTE_JOINS}
     WHERE h.user_id = $1
     GROUP BY a.currency
     ORDER BY a.currency`,
    [req.user.id]
  );

  res.json({ holdings: camelizeAll(holdings), totals: camelizeAll(totals) });
});

export default router;
