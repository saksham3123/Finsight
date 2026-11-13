import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "../utils/validate.js";

export const STOCKS = [
  ["RELIANCE", "Reliance Industries Ltd"],
  ["TCS", "Tata Consultancy Services Ltd"],
  ["HDFCBANK", "HDFC Bank Ltd"],
  ["INFY", "Infosys Ltd"],
  ["ICICIBANK", "ICICI Bank Ltd"],
  ["HINDUNILVR", "Hindustan Unilever Ltd"],
  ["ITC", "ITC Ltd"],
  ["SBIN", "State Bank of India"],
  ["BHARTIARTL", "Bharti Airtel Ltd"],
  ["LT", "Larsen & Toubro Ltd"],
].map(([symbol, name]) => ({ symbol, name, assetType: "stock", exchange: "NSE", currency: "INR" }));

export const CRYPTOS = [
  ["BTC", "Bitcoin"],
  ["ETH", "Ethereum"],
  ["SOL", "Solana"],
  ["BNB", "BNB"],
  ["XRP", "XRP"],
].map(([symbol, name]) => ({ symbol, name, assetType: "crypto", exchange: null, currency: "USD" }));

export const seedAssets = async (client) => {
  for (const asset of [...STOCKS, ...CRYPTOS]) {
    await client.query(
      `INSERT INTO assets (symbol, name, asset_type, exchange, currency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol, asset_type)
       DO UPDATE SET name = EXCLUDED.name, exchange = EXCLUDED.exchange,
                     currency = EXCLUDED.currency, updated_at = NOW()`,
      [asset.symbol, asset.name, asset.assetType, asset.exchange, asset.currency]
    );
  }
};

// Re-running resets the admin password to the given value, so .env stays the source of truth.
export const seedAdmin = async (client, email, password) => {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('FinSight Admin', $1, $2, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', updated_at = NOW()
     RETURNING id`,
    [email, passwordHash]
  );
  await client.query("INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [
    rows[0].id,
  ]);
  return rows[0].id;
};
