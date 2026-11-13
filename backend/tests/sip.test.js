import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { pool, setup } from "./helpers.js";

let ctx;
let user;
let infy;
before(async () => {
  ctx = await setup();
  user = await ctx.register();
  infy = await ctx.addPrices("INFY", 1, 1500);
});
after(() => ctx.close());

const runSips = async () => {
  const admin = await ctx.loginAdmin();
  return ctx.request("POST", "/admin/sips/run", { token: admin.token });
};

describe("SIP plans", () => {
  let sipId;

  test("create starts today by default and validates input", async () => {
    const res = await ctx.request("POST", "/sips", { token: user.token, body: { assetId: infy, amount: "3000", frequency: "monthly" } });
    assert.equal(res.status, 201);
    sipId = res.body.sip.id;
    assert.equal(res.body.sip.status, "active");
    assert.equal(res.body.sip.nextRunDate, res.body.sip.startDate);

    const past = await ctx.request("POST", "/sips", { token: user.token, body: { assetId: infy, amount: 100, frequency: "weekly", startDate: "2020-01-01" } });
    assert.equal(past.status, 400);
    const badFreq = await ctx.request("POST", "/sips", { token: user.token, body: { assetId: infy, amount: 100, frequency: "hourly" } });
    assert.equal(badFreq.status, 400);
  });

  test("running due SIPs buys amount / price units and schedules the next run", async () => {
    const res = await runSips();
    assert.equal(res.status, 200);
    assert.equal(res.body.executed, 1);

    const { rows: [h] } = await pool.query("SELECT quantity::text FROM holdings WHERE user_id = $1 AND asset_id = $2", [user.user.id, infy]);
    assert.equal(h.quantity, "2.00000000"); // 3000 / 1500

    const sip = await ctx.request("GET", `/sips/${sipId}`, { token: user.token });
    assert.equal(sip.body.sip.executions, 1);
    assert.ok(sip.body.sip.nextRunDate > sip.body.sip.startDate);

    const txns = await ctx.request("GET", `/transactions?sipPlanId=${sipId}`, { token: user.token });
    assert.equal(txns.body.transactions.length, 1);
  });

  test("running again on the same day does nothing", async () => {
    const res = await runSips();
    assert.equal(res.body.executed, 0);
  });

  test("a plan that is overdue runs once and jumps to the next future date", async () => {
    await pool.query("UPDATE sip_plans SET next_run_date = CURRENT_DATE - 75 WHERE id = $1", [sipId]);
    const res = await runSips();
    assert.equal(res.body.executed, 1);
    const { rows: [plan] } = await pool.query("SELECT next_run_date > CURRENT_DATE AS future FROM sip_plans WHERE id = $1", [sipId]);
    assert.equal(plan.future, true);
  });

  test("a plan whose end date has passed is completed", async () => {
    await pool.query("UPDATE sip_plans SET start_date = CURRENT_DATE - 10, next_run_date = CURRENT_DATE, end_date = CURRENT_DATE - 1 WHERE id = $1", [sipId]);
    const res = await runSips();
    assert.equal(res.body.completed, 1);
    const sip = await ctx.request("GET", `/sips/${sipId}`, { token: user.token });
    assert.equal(sip.body.sip.status, "completed");

    const edit = await ctx.request("PATCH", `/sips/${sipId}`, { token: user.token, body: { amount: 10 } });
    assert.equal(edit.status, 409);
  });

  test("paused plans are skipped; resuming an overdue plan restarts from today", async () => {
    const created = await ctx.request("POST", "/sips", { token: user.token, body: { assetId: infy, amount: 1500, frequency: "weekly" } });
    const id = created.body.sip.id;
    const paused = await ctx.request("PATCH", `/sips/${id}`, { token: user.token, body: { status: "paused" } });
    assert.equal(paused.body.sip.status, "paused");
    assert.equal((await runSips()).body.executed, 0);

    await pool.query("UPDATE sip_plans SET next_run_date = CURRENT_DATE - 3 WHERE id = $1", [id]);
    const resumed = await ctx.request("PATCH", `/sips/${id}`, { token: user.token, body: { status: "active" } });
    assert.equal(resumed.body.sip.nextRunDate, resumed.body.sip.startDate);
  });

  test("users cannot see or modify other users' plans", async () => {
    const other = await ctx.register();
    assert.equal((await ctx.request("GET", `/sips/${sipId}`, { token: other.token })).status, 404);
    assert.equal((await ctx.request("PATCH", `/sips/${sipId}`, { token: other.token, body: { status: "cancelled" } })).status, 404);
  });

  test("assets without a price are skipped, not failed", async () => {
    const eth = await ctx.assetId("ETH");
    await ctx.request("POST", "/sips", { token: user.token, body: { assetId: eth, amount: 100, frequency: "daily" } });
    const res = await runSips();
    assert.equal(res.body.failed, 0);
    assert.ok(res.body.results.some((r) => r.reason === "no market price"));
  });
});
