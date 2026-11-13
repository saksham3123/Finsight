import { Router } from "express";
import bcrypt from "bcryptjs";
import pool, { withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { logAudit, logAuditSafely } from "../services/audit.js";
import { hashToken, issueTokenPair, revokeAllRefreshTokens } from "../services/tokens.js";
import { HttpError } from "../utils/httpError.js";
import { camelize } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  message: "Too many authentication attempts, please try again later",
});

// Compared against when the email is unknown, so a failed login takes the same time
// whether or not the account exists (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("finsight-timing-equaliser", v.BCRYPT_COST);

const PUBLIC_USER_COLUMNS = "id, name, email, role, created_at";

router.post("/register", authLimiter, async (req, res) => {
  const name = v.string(req.body?.name, "name", { max: 120 });
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const passwordHash = await bcrypt.hash(password, v.BCRYPT_COST);

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${PUBLIC_USER_COLUMNS}`,
        [name, email, passwordHash]
      );
      const user = rows[0];
      await client.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [user.id]);
      await logAudit(client, { userId: user.id, action: "auth.register", entityType: "user", entityId: user.id, ip: req.ip });
      return { user: camelize(user), ...(await issueTokenPair(client, user)) };
    });
    res.status(201).json(result);
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "An account with this email already exists");
    throw error;
  }
});

router.post("/login", authLimiter, async (req, res) => {
  const email = v.email(req.body?.email);
  const password = v.string(req.body.password, "password", { max: 200 });

  const { rows } = await pool.query(`SELECT ${PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    await logAuditSafely({ userId: user?.id ?? null, action: "auth.login_failed", details: { email }, ip: req.ip });
    throw new HttpError(401, "Invalid email or password");
  }

  const tokens = await issueTokenPair(pool, user);
  await logAuditSafely({ userId: user.id, action: "auth.login", ip: req.ip });
  delete user.password_hash;
  res.json({ user: camelize(user), ...tokens });
});

// Rotation: every refresh token works once. Presenting an already-used token means it was
// copied by someone else, so every session of that user is revoked.
router.post("/refresh", async (req, res) => {
  const token = v.string(req.body?.refreshToken, "refreshToken", { max: 200 });

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.role
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [hashToken(token)]
    );
    const stored = rows[0];
    if (!stored) return { error: "Invalid refresh token" };

    if (stored.revoked_at) {
      await revokeAllRefreshTokens(client, stored.user_id);
      await logAudit(client, { userId: stored.user_id, action: "auth.refresh_token_reuse", ip: req.ip });
      return { error: "Refresh token has already been used; all sessions have been signed out" };
    }
    if (stored.expires_at <= new Date()) return { error: "Refresh token has expired" };

    await client.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1", [stored.id]);
    return { tokens: await issueTokenPair(client, { id: stored.user_id, role: stored.role }) };
  });

  // Thrown after the transaction so the reuse revocation is committed, not rolled back.
  if (result.error) throw new HttpError(401, result.error);
  res.json(result.tokens);
});

router.post("/logout", async (req, res) => {
  const token = v.string(req.body?.refreshToken, "refreshToken", { max: 200 });
  const { rows } = await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id",
    [hashToken(token)]
  );
  if (rows[0]) await logAuditSafely({ userId: rows[0].user_id, action: "auth.logout", ip: req.ip });
  res.status(204).end();
});

router.post("/logout-all", requireAuth, async (req, res) => {
  await revokeAllRefreshTokens(pool, req.user.id);
  await logAuditSafely({ userId: req.user.id, action: "auth.logout_all", ip: req.ip });
  res.status(204).end();
});

export default router;
