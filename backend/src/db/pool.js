import pg from "pg";
import { requireEnv } from "../config/env.js";

// Type parsers for values pg would otherwise return awkwardly:
// - NUMERIC (1700) arrives as a string; calculations happen in SQL, so a JS number is fine for the API.
// - BIGINT (20) is what COUNT(*) returns; counts here never exceed Number.MAX_SAFE_INTEGER.
// - DATE (1082) would become a JS Date at local midnight, which shifts the day when serialised to UTC.
pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(1082, (value) => value);

const pool = new pg.Pool({ connectionString: requireEnv("DATABASE_URL") });

// Runs fn inside BEGIN/COMMIT on one pooled client, rolling back if it throws.
export const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export default pool;
