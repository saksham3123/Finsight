import { requireEnv } from "../src/config/env.js";
import { applySchema } from "../src/db/migrate.js";

try {
  const tables = await applySchema(requireEnv("DATABASE_URL"));
  console.log(`Schema applied. ${tables.length} tables:`);
  tables.forEach((table) => console.log(`  - ${table}`));
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
}
