import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
// helpers.js must be imported first: it points the app at the test database.
import { pool, setup } from "./helpers.js";
import express from "express";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { rateLimit } from "../src/middleware/rateLimit.js";

let ctx;
let user;
before(async () => {
  ctx = await setup();
  user = await ctx.register();
  await ctx.addPrices("TCS", 2, (i) => (i === 0 ? 3000 : 3300));
});
after(() => ctx.close());

const ask = (content, conversationId) =>
  ctx.request("POST", "/chat/messages", { token: user.token, body: { content, conversationId } });

describe("chat assistant", () => {
  let conversationId;

  test("a first message starts a conversation and stores both sides", async () => {
    const res = await ask("help");
    assert.equal(res.status, 201);
    conversationId = res.body.conversationId;
    assert.deepEqual(res.body.messages.map((m) => m.role), ["user", "assistant"]);
    assert.match(res.body.messages[1].content, /I can help with/);
  });

  test("answers about a mentioned asset from real data", async () => {
    const res = await ask("What about TCS?", conversationId);
    assert.match(res.body.messages[1].content, /Tata Consultancy Services/);
    assert.match(res.body.messages[1].content, /\+10%/);
  });

  test("answers about the user's own portfolio", async () => {
    const empty = await ask("how is my portfolio", conversationId);
    assert.match(empty.body.messages[1].content, /don't hold any assets/);

    const tcs = await ctx.assetId("TCS");
    await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "buy", quantity: 2, price: 3000 } });
    const res = await ask("show my portfolio", conversationId);
    assert.match(res.body.messages[1].content, /INR: 1 position/);
  });

  test("conversation history is ordered and listed", async () => {
    const history = await ctx.request("GET", `/chat/conversations/${conversationId}/messages`, { token: user.token });
    assert.equal(history.body.messages.length, 8);
    assert.deepEqual(history.body.messages.slice(0, 2).map((m) => m.role), ["user", "assistant"]);

    const list = await ctx.request("GET", "/chat/conversations", { token: user.token });
    assert.equal(list.body.conversations.length, 1);
    assert.equal(list.body.conversations[0].title, "help");
  });

  test("conversations are private and can be deleted", async () => {
    const other = await ctx.register();
    const peek = await ctx.request("GET", `/chat/conversations/${conversationId}/messages`, { token: other.token });
    assert.equal(peek.status, 404);
    const hijack = await ctx.request("POST", "/chat/messages", { token: other.token, body: { content: "hi", conversationId } });
    assert.equal(hijack.status, 404);

    assert.equal((await ctx.request("DELETE", `/chat/conversations/${conversationId}`, { token: user.token })).status, 204);
    assert.equal((await ctx.request("GET", "/chat/conversations", { token: user.token })).body.conversations.length, 0);
  });
});

describe("admin", () => {
  test("non-admins are refused", async () => {
    assert.equal((await ctx.request("GET", "/admin/stats", { token: user.token })).status, 403);
  });

  test("stats, user list and audit log", async () => {
    const admin = await ctx.loginAdmin();
    const stats = await ctx.request("GET", "/admin/stats", { token: admin.token });
    assert.equal(stats.status, 200);
    assert.equal(stats.body.stats.activeAssets, 15);

    const users = await ctx.request("GET", "/admin/users?q=finsight.test", { token: admin.token });
    assert.ok(users.body.total >= 2);

    const audit = await ctx.request("GET", `/admin/audit-log?userId=${user.user.id}`, { token: admin.token });
    const actions = audit.body.entries.map((e) => e.action);
    assert.ok(actions.includes("auth.register"));
    assert.ok(actions.includes("transaction.create"));
  });

  test("role changes take effect immediately and admins cannot demote themselves", async () => {
    const admin = await ctx.loginAdmin();
    const promote = await ctx.request("PATCH", `/admin/users/${user.user.id}/role`, { token: admin.token, body: { role: "admin" } });
    assert.equal(promote.status, 200);
    // The old access token still says "user", but the role is checked in the database.
    assert.equal((await ctx.request("GET", "/admin/stats", { token: user.token })).status, 200);

    await ctx.request("PATCH", `/admin/users/${user.user.id}/role`, { token: admin.token, body: { role: "user" } });
    assert.equal((await ctx.request("GET", "/admin/stats", { token: user.token })).status, 403);

    const self = await ctx.request("PATCH", `/admin/users/${admin.user.id}/role`, { token: admin.token, body: { role: "user" } });
    assert.equal(self.status, 400);
  });

  test("audit entries record the client IP", async () => {
    const { rows } = await pool.query("SELECT ip_address FROM audit_log WHERE action = 'auth.register' LIMIT 1");
    assert.ok(rows[0].ip_address);
  });
});

describe("rate limiter", () => {
  test("blocks requests over the limit with 429 and Retry-After", async () => {
    const app = express();
    app.get("/", rateLimit({ windowMs: 60_000, max: 2 }), (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      const statuses = [];
      for (let i = 0; i < 3; i += 1) statuses.push((await fetch(url)).status);
      assert.deepEqual(statuses, [200, 200, 429]);
      const blocked = await fetch(url);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
