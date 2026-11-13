import pool, { withTransaction } from "../db/pool.js";
import { latestClose } from "./assets.js";
import { logAudit } from "./audit.js";
import { executeTrade } from "./trading.js";

export const FREQUENCY_INTERVAL = { daily: "1 day", weekly: "1 week", monthly: "1 month" };

// Runs one due plan inside its own transaction. FOR UPDATE SKIP LOCKED means two scheduler
// runs at the same time never execute the same plan twice.
const runPlan = (planId) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM sip_plans
       WHERE id = $1 AND status = 'active' AND next_run_date <= CURRENT_DATE
       FOR UPDATE SKIP LOCKED`,
      [planId]
    );
    const plan = rows[0];
    if (!plan) return { planId, outcome: "skipped", reason: "not due or locked" };

    if (plan.end_date && plan.next_run_date > plan.end_date) {
      await client.query("UPDATE sip_plans SET status = 'completed', updated_at = NOW() WHERE id = $1", [plan.id]);
      return { planId, outcome: "completed" };
    }

    const price = await latestClose(client, plan.asset_id);
    if (price === null) return { planId, outcome: "skipped", reason: "no market price" };

    const { rows: [{ quantity }] } = await client.query("SELECT ROUND($1::numeric / $2::numeric, 8) AS quantity", [
      plan.amount,
      price,
    ]);
    if (quantity <= 0) return { planId, outcome: "skipped", reason: "amount too small for one unit fraction" };

    const { transaction } = await executeTrade(client, {
      userId: plan.user_id,
      assetId: plan.asset_id,
      type: "buy",
      quantity: String(quantity),
      price: String(price),
      sipPlanId: plan.id,
    });

    // Missed periods (e.g. the server was down) are not back-filled: the plan runs once,
    // then moves to the first scheduled date after today.
    const interval = FREQUENCY_INTERVAL[plan.frequency];
    const { rows: [updated] } = await client.query(
      `UPDATE sip_plans SET
         next_run_date = (
           SELECT MIN(d)::date FROM generate_series(next_run_date + $2::interval, CURRENT_DATE + $2::interval, $2::interval) d
           WHERE d > CURRENT_DATE
         ),
         updated_at = NOW()
       WHERE id = $1
       RETURNING next_run_date, end_date`,
      [plan.id, interval]
    );
    if (updated.end_date && updated.next_run_date > updated.end_date) {
      await client.query("UPDATE sip_plans SET status = 'completed', updated_at = NOW() WHERE id = $1", [plan.id]);
    }

    await logAudit(client, {
      userId: plan.user_id,
      action: "sip.executed",
      entityType: "sip_plan",
      entityId: plan.id,
      details: { transactionId: transaction.id, quantity, price },
    });
    return { planId, outcome: "executed", transactionId: transaction.id, quantity, price, nextRunDate: updated.next_run_date };
  });

export const runDueSips = async () => {
  const { rows } = await pool.query(
    "SELECT id FROM sip_plans WHERE status = 'active' AND next_run_date <= CURRENT_DATE ORDER BY next_run_date"
  );
  const results = [];
  for (const { id } of rows) {
    try {
      results.push(await runPlan(id));
    } catch (error) {
      results.push({ planId: id, outcome: "failed", reason: error.message });
    }
  }
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return { due: rows.length, executed: count("executed"), completed: count("completed"), skipped: count("skipped"), failed: count("failed"), results };
};
