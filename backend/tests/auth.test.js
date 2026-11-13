import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { pool, setup } from "./helpers.js";

let ctx;
before(async () => {
  ctx = await setup();
});
after(() => ctx.close());

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await ctx.request("GET", "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok" });
  });

  test("unknown routes return 404 JSON", async () => {
    const res = await ctx.request("GET", "/nope");
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Route not found/);
  });

  test("malformed JSON returns 400", async () => {
    const res = await ctx.request("POST", "/auth/login", { body: "{bad json" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Malformed JSON body");
  });
});

describe("register and login", () => {
  test("register returns user and tokens, never the password hash", async () => {
    const res = await ctx.request("POST", "/auth/register", {
      body: { name: "Asha", email: "Asha@Example.com", password: "Password123" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, "asha@example.com");
    assert.equal(res.body.user.role, "user");
    assert.ok(res.body.accessToken && res.body.refreshToken);
    assert.equal(res.body.user.passwordHash, undefined);

    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = 'asha@example.com'");
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
  });

  test("duplicate email (any case) is rejected with 409", async () => {
    const res = await ctx.request("POST", "/auth/register", {
      body: { name: "Asha 2", email: "ASHA@example.com", password: "Password123" },
    });
    assert.equal(res.status, 409);
  });

  test("validation errors return 400 with the field name", async () => {
    const short = await ctx.request("POST", "/auth/register", { body: { name: "X", email: "x@y.z", password: "short" } });
    assert.equal(short.status, 400);
    assert.match(short.body.error, /password/);
    const badEmail = await ctx.request("POST", "/auth/register", { body: { name: "X", email: "nope", password: "Password123" } });
    assert.equal(badEmail.status, 400);
    assert.match(badEmail.body.error, /email/);
  });

  test("login succeeds with the right password and fails otherwise", async () => {
    const ok = await ctx.request("POST", "/auth/login", { body: { email: "asha@example.com", password: "Password123" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken);

    const wrong = await ctx.request("POST", "/auth/login", { body: { email: "asha@example.com", password: "Wrong12345" } });
    assert.equal(wrong.status, 401);
    const unknown = await ctx.request("POST", "/auth/login", { body: { email: "ghost@example.com", password: "Wrong12345" } });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error, "same message for unknown email and wrong password");
  });

  test("failed logins are audited", async () => {
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.login_failed'");
    assert.ok(rows[0].n >= 2);
  });
});

describe("tokens", () => {
  test("protected routes need a valid access token", async () => {
    assert.equal((await ctx.request("GET", "/users/me")).status, 401);
    assert.equal((await ctx.request("GET", "/users/me", { token: "garbage" })).status, 401);
  });

  test("refresh rotates the token and the old one stops working", async () => {
    const user = await ctx.register();
    const first = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: user.refreshToken } });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.refreshToken, user.refreshToken);

    const me = await ctx.request("GET", "/users/me", { token: first.body.accessToken });
    assert.equal(me.status, 200);
  });

  test("reusing a rotated refresh token revokes every session", async () => {
    const user = await ctx.register();
    const rotated = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: user.refreshToken } });
    assert.equal(rotated.status, 200);

    const reuse = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: user.refreshToken } });
    assert.equal(reuse.status, 401);
    assert.match(reuse.body.error, /already been used/);

    // The legitimately rotated token is revoked too.
    const after = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: rotated.body.refreshToken } });
    assert.equal(after.status, 401);
  });

  test("logout revokes the refresh token", async () => {
    const user = await ctx.register();
    const out = await ctx.request("POST", "/auth/logout", { body: { refreshToken: user.refreshToken } });
    assert.equal(out.status, 204);
    const refresh = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: user.refreshToken } });
    assert.equal(refresh.status, 401);
  });
});

describe("profile and preferences", () => {
  test("me returns user with default preferences", async () => {
    const user = await ctx.register();
    const res = await ctx.request("GET", "/users/me", { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.user.email);
    assert.equal(res.body.preferences.theme, "light");
    assert.deepEqual(res.body.preferences.uiState, {});
  });

  test("preferences support partial updates", async () => {
    const user = await ctx.register();
    const a = await ctx.request("PATCH", "/users/me/preferences", { token: user.token, body: { theme: "dark", lastRoute: "/portfolio" } });
    assert.equal(a.status, 200);
    const b = await ctx.request("PATCH", "/users/me/preferences", { token: user.token, body: { uiState: { chartRange: "1y" } } });
    assert.deepEqual(b.body.preferences, { ...b.body.preferences, theme: "dark", lastRoute: "/portfolio", uiState: { chartRange: "1y" } });

    const bad = await ctx.request("PATCH", "/users/me/preferences", { token: user.token, body: { theme: "blue" } });
    assert.equal(bad.status, 400);
  });

  test("changing password requires the current one and signs out other sessions", async () => {
    const user = await ctx.register();
    const wrong = await ctx.request("PATCH", "/users/me/password", { token: user.token, body: { currentPassword: "nope-nope", newPassword: "NewPassword1" } });
    assert.equal(wrong.status, 401);

    const ok = await ctx.request("PATCH", "/users/me/password", { token: user.token, body: { currentPassword: user.password, newPassword: "NewPassword1" } });
    assert.equal(ok.status, 204);
    const refresh = await ctx.request("POST", "/auth/refresh", { body: { refreshToken: user.refreshToken } });
    assert.equal(refresh.status, 401);
    const login = await ctx.request("POST", "/auth/login", { body: { email: user.user.email, password: "NewPassword1" } });
    assert.equal(login.status, 200);
  });

  test("deleting the account removes personal data but keeps the audit trail", async () => {
    const user = await ctx.register();
    const res = await ctx.request("DELETE", "/users/me", { token: user.token, body: { password: user.password } });
    assert.equal(res.status, 204);
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM users WHERE id = $1", [user.user.id]);
    assert.equal(rows[0].n, 0);
    const audit = await pool.query("SELECT user_id FROM audit_log WHERE action = 'user.delete' AND entity_id = $1", [user.user.id]);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].user_id, null);
  });
});
