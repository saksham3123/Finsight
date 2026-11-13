import { Router } from "express";
import bcrypt from "bcryptjs";
import pool, { withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { revokeAllRefreshTokens } from "../services/tokens.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { camelize } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

const getPreferences = async (userId) => {
  const { rows } = await pool.query(
    "SELECT theme, last_route, ui_state, updated_at FROM user_preferences WHERE user_id = $1",
    [userId]
  );
  return camelize(rows[0]) ?? { theme: "light", lastRoute: null, uiState: {}, updatedAt: null };
};

const checkPassword = async (userId, password) => {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!rows[0]) throw notFound("User");
  if (!(await bcrypt.compare(password, rows[0].password_hash))) throw new HttpError(401, "Password is incorrect");
};

router.get("/me", async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = $1", [
    req.user.id,
  ]);
  if (!rows[0]) throw notFound("User");
  res.json({ user: camelize(rows[0]), preferences: await getPreferences(req.user.id) });
});

router.patch("/me", async (req, res) => {
  const name = v.string(req.body?.name, "name", { max: 120 });
  const { rows } = await pool.query(
    "UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name, email, role, created_at, updated_at",
    [req.user.id, name]
  );
  if (!rows[0]) throw notFound("User");
  res.json({ user: camelize(rows[0]) });
});

// Changing the password signs out every other session by revoking all refresh tokens.
router.patch("/me/password", async (req, res) => {
  const currentPassword = v.string(req.body?.currentPassword, "currentPassword", { max: 200 });
  const newPassword = v.password(req.body.newPassword, "newPassword");
  await checkPassword(req.user.id, currentPassword);

  const passwordHash = await bcrypt.hash(newPassword, v.BCRYPT_COST);
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1", [req.user.id, passwordHash]);
    await revokeAllRefreshTokens(client, req.user.id);
    await logAudit(client, { userId: req.user.id, action: "user.password_change", ip: req.ip });
  });
  res.status(204).end();
});

// Deleting the account cascades to all personal data; the audit entry survives with user_id set to NULL.
router.delete("/me", async (req, res) => {
  const password = v.string(req.body?.password, "password", { max: 200 });
  await checkPassword(req.user.id, password);

  await withTransaction(async (client) => {
    await logAudit(client, { userId: req.user.id, action: "user.delete", entityType: "user", entityId: req.user.id, ip: req.ip });
    await client.query("DELETE FROM users WHERE id = $1", [req.user.id]);
  });
  res.status(204).end();
});

router.get("/me/preferences", async (req, res) => {
  res.json({ preferences: await getPreferences(req.user.id) });
});

// Partial update: only the fields sent are changed. uiState is replaced as a whole.
router.patch("/me/preferences", async (req, res) => {
  const body = req.body ?? {};
  const theme = v.oneOf(body.theme, "theme", ["light", "dark"], { required: false });
  const lastRoute = body.lastRoute === undefined ? undefined : v.string(body.lastRoute, "lastRoute", { max: 500 });
  const uiState = body.uiState === undefined ? undefined : v.plainObject(body.uiState, "uiState");
  if (theme === undefined && lastRoute === undefined && uiState === undefined) {
    throw new HttpError(400, "Provide at least one of theme, lastRoute, uiState");
  }

  const { rows } = await pool.query(
    `INSERT INTO user_preferences (user_id, theme, last_route, ui_state)
     VALUES ($1, COALESCE($2, 'light'), $3, COALESCE($4::jsonb, '{}'::jsonb))
     ON CONFLICT (user_id) DO UPDATE SET
       theme = COALESCE($2, user_preferences.theme),
       last_route = CASE WHEN $5 THEN $3 ELSE user_preferences.last_route END,
       ui_state = COALESCE($4::jsonb, user_preferences.ui_state),
       updated_at = NOW()
     RETURNING theme, last_route, ui_state, updated_at`,
    [req.user.id, theme ?? null, lastRoute ?? null, uiState === undefined ? null : JSON.stringify(uiState), lastRoute !== undefined]
  );
  res.json({ preferences: camelize(rows[0]) });
});

export default router;
