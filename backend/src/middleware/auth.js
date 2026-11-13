import crypto from "crypto";
import pool from "../db/pool.js";
import { verifyAccessToken } from "../services/tokens.js";
import { HttpError } from "../utils/httpError.js";

const bearerToken = (req) => {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
};

export const requireAuth = (req, res, next) => {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "Authentication required");
  req.user = verifyAccessToken(token);
  next();
};

// The role is re-read from the database, so a demoted admin loses access immediately
// instead of when their access token expires.
export const requireAdmin = async (req, res, next) => {
  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [req.user.id]);
  if (rows[0]?.role !== "admin") throw new HttpError(403, "Admin access required");
  next();
};

const isServiceRequest = (req) => {
  const provided = req.headers["x-service-key"];
  const expected = process.env.ML_SERVICE_KEY;
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// For data-ingestion endpoints: the ML service authenticates with X-Service-Key, people as admins.
export const requireAdminOrService = async (req, res, next) => {
  if (isServiceRequest(req)) {
    req.service = true;
    return next();
  }
  if (req.headers["x-service-key"]) throw new HttpError(401, "Invalid service key");
  requireAuth(req, res, () => {});
  await requireAdmin(req, res, next);
};
