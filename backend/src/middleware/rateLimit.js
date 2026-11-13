import { HttpError } from "../utils/httpError.js";

// Fixed-window, in-memory limiter keyed by client IP. Fine for a single server process;
// several instances behind a load balancer would need a shared store instead.
export const rateLimit = ({ windowMs, max, message = "Too many requests, please try again later" }) => {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;

    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - entry.count));
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(429, message);
    }
    next();
  };
};
