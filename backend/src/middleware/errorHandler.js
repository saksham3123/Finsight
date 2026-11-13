// PostgreSQL error codes that are really client errors.
const PG_ERRORS = {
  23505: [409, "Resource already exists"],
  23503: [400, "Referenced resource does not exist"],
  23514: [400, "Value violates a database constraint"],
  "22P02": [400, "Invalid value format"],
  22003: [400, "Numeric value out of range"],
  22001: [400, "Value too long"],
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Express recognises error handlers by their four arguments, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  if (PG_ERRORS[error.code]) {
    const [status, message] = PG_ERRORS[error.code];
    return res.status(status).json({ error: message });
  }

  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : error.message });
};
