import { HttpError } from "./httpError.js";

export const BCRYPT_COST = 12;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const fail = (field, message) => {
  throw new HttpError(400, `${field} ${message}`);
};

const isMissing = (value) => value === undefined || value === null || value === "";

// Each validator returns the cleaned value, or undefined when an optional field is absent.

export const string = (value, field, { required = true, max = 1000 } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (typeof value !== "string") fail(field, "must be a string");
  const trimmed = value.trim();
  if (!trimmed) fail(field, "must not be empty");
  if (trimmed.length > max) fail(field, `must be at most ${max} characters`);
  return trimmed;
};

export const email = (value, field = "email") => {
  const normalized = string(value, field, { max: 255 }).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) fail(field, "must be a valid email address");
  return normalized;
};

// bcrypt only uses the first 72 bytes of a password, so longer ones are rejected.
export const password = (value, field = "password") => {
  if (typeof value !== "string" || !value) fail(field, "is required");
  if (value.length < 8) fail(field, "must be at least 8 characters");
  if (Buffer.byteLength(value) > 72) fail(field, "must be at most 72 bytes");
  return value;
};

export const oneOf = (value, field, options, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (!options.includes(value)) fail(field, `must be one of: ${options.join(", ")}`);
  return value;
};

export const uuid = (value, field, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(field, "must be a valid UUID");
  return value.toLowerCase();
};

// Returns a decimal string so pg passes the exact value to NUMERIC columns.
export const decimal = (value, field, { required = true, scale = 8, allowZero = false } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(text)) {
    fail(field, `must be a non-negative number with at most ${scale} decimal places`);
  }
  if (!allowZero && Number(text) === 0) fail(field, "must be greater than zero");
  return text;
};

export const score = (value, field, min, max, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(field, `must be a number between ${min} and ${max}`);
  }
  return value;
};

export const date = (value, field, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) fail(field, "must be a date in YYYY-MM-DD format");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(field, "is not a real date");
  return value;
};

export const timestamp = (value, field, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) fail(field, "must be an ISO 8601 timestamp");
  return parsed.toISOString();
};

export const boolean = (value, field, { required = true } = {}) => {
  if (isMissing(value)) return required ? fail(field, "is required") : undefined;
  if (typeof value !== "boolean") fail(field, "must be true or false");
  return value;
};

export const plainObject = (value, field, { maxBytes = 10_000 } = {}) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(field, "must be an object");
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail(field, `must be at most ${maxBytes} bytes`);
  return value;
};

export const array = (value, field, { max = 1000 } = {}) => {
  if (!Array.isArray(value) || value.length === 0) fail(field, "must be a non-empty array");
  if (value.length > max) fail(field, `must contain at most ${max} items`);
  return value;
};

export const pagination = (query, { defaultLimit = 50, maxLimit = 200 } = {}) => {
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) fail("limit", `must be an integer from 1 to ${maxLimit}`);
  if (!Number.isInteger(offset) || offset < 0) fail("offset", "must be a non-negative integer");
  return { limit, offset };
};

// Escapes LIKE wildcards so user input is matched literally.
export const likePattern = (text) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;
