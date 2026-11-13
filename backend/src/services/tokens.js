import crypto from "crypto";
import jwt from "jsonwebtoken";
import { HttpError } from "../utils/httpError.js";

const ISSUER = "finsight-api";

const refreshTtlDays = () => Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;

export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export const signAccessToken = (user) =>
  jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: user.id,
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: process.env.JWT_ACCESS_TTL || "15m",
  });

export const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: ISSUER, algorithms: ["HS256"] });
    return { id: payload.sub, role: payload.role };
  } catch {
    throw new HttpError(401, "Invalid or expired access token");
  }
};

// Refresh tokens are opaque random strings; only their SHA-256 hash is stored.
export const issueRefreshToken = async (db, userId) => {
  const token = crypto.randomBytes(48).toString("base64url");
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(days => $3))`,
    [userId, hashToken(token), refreshTtlDays()]
  );
  return token;
};

export const issueTokenPair = async (db, user) => ({
  accessToken: signAccessToken(user),
  refreshToken: await issueRefreshToken(db, user.id),
});

export const revokeAllRefreshTokens = (db, userId) =>
  db.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
