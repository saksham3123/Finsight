import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { generateAdvisories } from "../services/advisoryEngine.js";
import { logAudit, logAuditSafely } from "../services/audit.js";
import { runDueSips } from "../services/sip.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { camelize, camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/stats", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM assets WHERE is_active) AS active_assets,
      (SELECT COUNT(*) FROM transactions) AS transactions,
      (SELECT COUNT(*) FROM sip_plans WHERE status = 'active') AS active_sips,
      (SELECT COUNT(*) FROM advisories WHERE advisory_date = CURRENT_DATE) AS advisories_today,
      (SELECT MAX(date) FROM price_history) AS latest_price_date`);
  res.json({ stats: camelize(rows[0]) });
});

router.get("/users", async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const q = v.string(req.query.q, "q", { required: false, max: 100 });
  const { rows } = await pool.query(
    `SELECT id, name, email, role, created_at, COUNT(*) OVER () AS total
     FROM users
     WHERE $1::text IS NULL OR name ILIKE $1 OR email ILIKE $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [q ? v.likePattern(q) : null, limit, offset]
  );
  res.json({ users: camelizeAll(rows.map(({ total, ...user }) => user)), total: rows[0]?.total ?? 0, limit, offset });
});

router.patch("/users/:id/role", async (req, res) => {
  const id = v.uuid(req.params.id, "id");
  const role = v.oneOf(req.body?.role, "role", ["user", "admin"]);
  if (id === req.user.id) throw new HttpError(400, "You cannot change your own role");

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      "UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name, email, role",
      [id, role]
    );
    if (!rows[0]) throw notFound("User");
    await logAudit(client, { userId: req.user.id, action: "admin.role_change", entityType: "user", entityId: id, details: { role }, ip: req.ip });
    return rows[0];
  });
  res.json({ user: camelize(user) });
});

router.get("/audit-log", async (req, res) => {
  const { limit, offset } = v.pagination(req.query, { defaultLimit: 100, maxLimit: 500 });
  const userId = v.uuid(req.query.userId, "userId", { required: false });
  const action = v.string(req.query.action, "action", { required: false, max: 100 });
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, u.email AS user_email, l.action, l.entity_type, l.entity_id, l.details, l.ip_address, l.created_at
     FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
     WHERE ($1::uuid IS NULL OR l.user_id = $1) AND ($2::text IS NULL OR l.action = $2)
     ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`,
    [userId ?? null, action ?? null, limit, offset]
  );
  res.json({ entries: camelizeAll(rows), limit, offset });
});

router.post("/sips/run", async (req, res) => {
  const summary = await runDueSips();
  await logAuditSafely({ userId: req.user.id, action: "admin.sips_run", details: { executed: summary.executed }, ip: req.ip });
  res.json(summary);
});

router.post("/advisories/generate", async (req, res) => {
  const summary = await generateAdvisories();
  await logAuditSafely({ userId: req.user.id, action: "admin.advisories_generate", details: { generated: summary.generated }, ip: req.ip });
  res.json(summary);
});

export default router;
