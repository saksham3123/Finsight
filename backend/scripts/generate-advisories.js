// Generates today's baseline (SMA/volatility) advisories for all active assets.
import "../src/config/env.js";
import pool from "../src/db/pool.js";
import { MODEL_VERSION, generateAdvisories } from "../src/services/advisoryEngine.js";

try {
  const summary = await generateAdvisories();
  console.log(`Generated ${summary.generated} advisories with ${MODEL_VERSION}.`);
  if (summary.skipped.length) console.log(`Skipped: ${summary.skipped.join(", ")}`);
} catch (error) {
  console.error("Advisory generation failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
