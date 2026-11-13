import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

// Applies schema.sql in a single transaction and returns the resulting table names.
export const applySchema = async (connectionString) => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const sql = await fs.readFile(schemaPath, "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return rows.map((row) => row.table_name);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};
