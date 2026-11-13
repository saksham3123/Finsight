import { HttpError } from "../utils/httpError.js";
import { getActiveAsset, latestClose } from "./assets.js";

// Records a buy or sell and updates the matching holding. Must run inside a transaction
// (`client` from withTransaction) so the ledger and holdings never disagree.
// All arithmetic happens in SQL on NUMERIC values, so no floating-point rounding is involved.
export const executeTrade = async (
  client,
  { userId, assetId, type, quantity, price, fees = "0", executedAt = null, sipPlanId = null }
) => {
  await getActiveAsset(client, assetId);

  let tradePrice = price;
  if (tradePrice === undefined) {
    tradePrice = await latestClose(client, assetId);
    if (tradePrice === null) throw new HttpError(400, "No market price available for this asset; provide price");
    tradePrice = String(tradePrice);
  }

  let realizedPnl = null;
  if (type === "buy") {
    // Weighted average cost: (old qty * old avg + new qty * price) / (old qty + new qty). Fees are not capitalised.
    await client.query(
      `INSERT INTO holdings (user_id, asset_id, quantity, avg_buy_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, asset_id) DO UPDATE SET
         avg_buy_price = (holdings.quantity * holdings.avg_buy_price + EXCLUDED.quantity * EXCLUDED.avg_buy_price)
                         / (holdings.quantity + EXCLUDED.quantity),
         quantity = holdings.quantity + EXCLUDED.quantity,
         updated_at = NOW()`,
      [userId, assetId, quantity, tradePrice]
    );
  } else {
    // The WHERE clause makes the check and the decrement one atomic step, so two concurrent
    // sells cannot both spend the same units.
    const { rows } = await client.query(
      `UPDATE holdings SET quantity = quantity - $3, updated_at = NOW()
       WHERE user_id = $1 AND asset_id = $2 AND quantity >= $3
       RETURNING quantity, avg_buy_price, ($4::numeric - avg_buy_price) * $3::numeric - $5::numeric AS realized_pnl`,
      [userId, assetId, quantity, tradePrice, fees]
    );
    if (!rows[0]) throw new HttpError(400, "Insufficient holdings to sell this quantity");
    realizedPnl = rows[0].realized_pnl;
    if (rows[0].quantity === 0) {
      await client.query("DELETE FROM holdings WHERE user_id = $1 AND asset_id = $2", [userId, assetId]);
    }
  }

  const { rows } = await client.query(
    `INSERT INTO transactions (user_id, asset_id, sip_plan_id, txn_type, quantity, price, fees, executed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
     RETURNING *`,
    [userId, assetId, sipPlanId, type, quantity, tradePrice, fees, executedAt]
  );
  return { transaction: rows[0], realizedPnl };
};
