import { requireEnv } from "../src/config/env.js";
import pool, { withTransaction } from "../src/db/pool.js";
import { CRYPTOS, STOCKS, seedAdmin, seedAssets } from "../src/db/seed.js";

const adminEmail = requireEnv("ADMIN_EMAIL").trim().toLowerCase();
const adminPassword = requireEnv("ADMIN_PASSWORD");
if (adminPassword.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

try {
  await withTransaction(async (client) => {
    await seedAssets(client);
    await seedAdmin(client, adminEmail, adminPassword);
  });
  console.log(`Seeded ${STOCKS.length} stocks, ${CRYPTOS.length} cryptos and admin user ${adminEmail}`);
} catch (error) {
  console.error("Seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
