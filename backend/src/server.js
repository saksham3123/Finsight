// env.js must be imported first so variables are loaded before any other module reads them.
import { requireEnv } from "./config/env.js";
import app from "./app.js";
import { runDueSips } from "./services/sip.js";

requireEnv("JWT_SECRET");
const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  console.log(`FinSight API is running on http://localhost:${PORT}`);
});

// In-process SIP scheduler. Set SIP_SCHEDULER_INTERVAL_MINUTES=0 to disable it and run
// `npm run sips:run` from an OS scheduler (cron / Task Scheduler) instead.
const intervalMinutes = Number(process.env.SIP_SCHEDULER_INTERVAL_MINUTES ?? 60);
if (intervalMinutes > 0) {
  const tick = async () => {
    try {
      const summary = await runDueSips();
      if (summary.due) console.log(`SIP scheduler: ${summary.executed} executed, ${summary.skipped} skipped, ${summary.failed} failed`);
    } catch (error) {
      console.error("SIP scheduler failed:", error.message);
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, intervalMinutes * 60_000);
}
