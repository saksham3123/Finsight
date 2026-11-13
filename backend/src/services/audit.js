import pool from "../db/pool.js";

// Records an audit event. Pass a transaction client as `db` when the event must commit
// or roll back together with the change it describes (e.g. a trade).
export const logAudit = (db, { userId = null, action, entityType = null, entityId = null, details = {}, ip = null }) =>
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, entityType, entityId, details, ip]
  );

// For events outside a transaction (logins, failures): auditing must never break the request.
export const logAuditSafely = async (event) => {
  try {
    await logAudit(pool, event);
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
};
