// Creates the database named in TEST_DATABASE_URL (if missing) so `npm test` has somewhere to run.
import pg from "pg";
import { requireEnv } from "../src/config/env.js";

const testUrl = new URL(requireEnv("TEST_DATABASE_URL"));
const name = decodeURIComponent(testUrl.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(name)) {
  console.error(`Refusing to use "${name}": the test database name must end in _test.`);
  process.exit(1);
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });

try {
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (rowCount) {
    console.log(`Test database ${name} already exists.`);
  } else {
    // Identifiers cannot be parameters; the name was validated against a strict pattern above.
    await client.query(`CREATE DATABASE ${name}`);
    console.log(`Created test database ${name}.`);
  }
} catch (error) {
  console.error("Could not create test database:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
