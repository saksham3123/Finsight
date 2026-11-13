// Test harness: every test file gets a freshly rebuilt test database and its own server
// on a random port. Real HTTP requests go through the whole stack (middleware, SQL, constraints).
import "../src/config/env.js";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set. See .env.example, then run npm run db:create-test.");
const dbName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
// Safety net: the reset below drops every table, so never point it at a real database.
if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests against "${dbName}" (name must end in _test)`);

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.ML_SERVICE_KEY = "test-service-key";
process.env.JWT_SECRET ||= "test-jwt-secret";

export const ADMIN = { email: "admin@finsight.test", password: "AdminPass123" };
export const SERVICE_KEY = process.env.ML_SERVICE_KEY;

// Imported after the environment is switched so the pool connects to the test database.
const { default: app } = await import("../src/app.js");
const { default: pool } = await import("../src/db/pool.js");
const { applySchema } = await import("../src/db/migrate.js");
const { seedAdmin, seedAssets } = await import("../src/db/seed.js");

export { pool };

export const setup = async () => {
  // Checked on the live connection too, in case a module created the pool before the switch above.
  const { rows: [db] } = await pool.query("SELECT current_database() AS name");
  if (!db.name.endsWith("_test")) throw new Error(`Refusing to reset "${db.name}": not a _test database`);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applySchema(testUrl);
  const client = await pool.connect();
  try {
    await seedAssets(client);
    await seedAdmin(client, ADMIN.email, ADMIN.password);
  } finally {
    client.release();
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const request = async (method, path, { body, token, headers = {} } = {}) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };

  let userCount = 0;
  const register = async (overrides = {}) => {
    userCount += 1;
    const payload = { name: `Test User ${userCount}`, email: `user${userCount}-${Date.now()}@finsight.test`, password: "Password123", ...overrides };
    const res = await request("POST", "/auth/register", { body: payload });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...res.body, password: payload.password, token: res.body.accessToken };
  };

  const loginAdmin = async () => {
    const res = await request("POST", "/auth/login", { body: ADMIN });
    return { ...res.body, token: res.body.accessToken };
  };

  const assetId = async (symbol) => {
    const { rows } = await pool.query("SELECT id FROM assets WHERE symbol = $1", [symbol]);
    return rows[0].id;
  };

  // Inserts `count` daily closes ending today, all at `close` unless a function is given.
  const addPrices = async (symbol, count, close) => {
    const id = await assetId(symbol);
    for (let i = count - 1; i >= 0; i -= 1) {
      const value = typeof close === "function" ? close(count - 1 - i) : close;
      await pool.query(
        `INSERT INTO price_history (asset_id, date, open, high, low, close, volume)
         VALUES ($1, CURRENT_DATE - $2::int, $3, $3, $3, $3, 1000)
         ON CONFLICT (asset_id, date) DO UPDATE SET close = EXCLUDED.close, open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low`,
        [id, i, value]
      );
    }
    return id;
  };

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  };

  return { request, register, loginAdmin, assetId, addPrices, close };
};
