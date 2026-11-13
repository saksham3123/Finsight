// Executes every SIP plan that is due today. Safe to schedule with cron or Windows Task Scheduler.
import "../src/config/env.js";
import pool from "../src/db/pool.js";
import { runDueSips } from "../src/services/sip.js";

try {
  const summary = await runDueSips();
  console.log(`Due: ${summary.due}, executed: ${summary.executed}, completed: ${summary.completed}, skipped: ${summary.skipped}, failed: ${summary.failed}`);
  summary.results.filter((r) => r.outcome !== "executed").forEach((r) => console.log(`  - ${r.planId}: ${r.outcome} ${r.reason ?? ""}`));
} catch (error) {
  console.error("SIP run failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
