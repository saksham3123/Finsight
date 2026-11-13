# FinSight Backend — Design Decisions

Each entry records what was decided, why, and what was rejected.

## Stage 1 — Project setup

### S1-1. Express 5 with ES modules
- **Decision:** Keep Express 5 and `"type": "module"` (already set up in the project).
- **Why:** Express 5 forwards rejected promises from `async` handlers to the error middleware, so route code needs no try/catch wrappers. ES modules (`import`/`export`) match the React frontend.
- **Rejected:** Express 4 plus `express-async-errors`, which adds a dependency to work around something Express 5 already handles.

### S1-2. `src/app.js` separate from `src/server.js`
- **Decision:** `app.js` builds and exports the Express app. `server.js` loads config and calls `listen()`.
- **Why:** Tests (e.g. Supertest) can import the app without opening a port, and startup concerns (env checks, port) stay out of the request pipeline.

### S1-3. Middleware chosen
| Middleware | Purpose |
|---|---|
| `helmet` | Sets secure HTTP headers (HSTS, `X-Content-Type-Options`, CSP, frame protection). |
| `cors` | Allows only the React dev server (`CORS_ORIGIN`, default `http://localhost:5173`), not `*`. |
| `express.json({ limit: "1mb" })` | Parses JSON bodies. The limit blocks oversized payloads. |
| `morgan` | Request logging: `dev` format locally, `combined` (Apache-style) in production. |

- Order matters: helmet and cors run first so even error responses carry the right headers.
- A 404 handler and a central error handler come last. They return a consistent `{ error }` JSON shape, and for 500s they hide internal details from clients while logging them on the server.

### S1-4. Secrets only in `.env`
- **Decision:** `src/config/env.js` loads `backend/.env` using a path resolved from the file, not the working directory. `requireEnv()` stops the process with a clear message if a variable is missing.
- **Why:** Failing fast at startup beats failing on the first request. Resolving the path from the file means `npm run migrate` works from any folder.
- `.env` is git-ignored (root and `backend/.gitignore`). `.env.example` documents every variable with placeholder values.
- The old `DB_HOST/DB_PORT/...` variables were merged into a single `DATABASE_URL`: one value to configure, and the standard format used by hosting providers (Render, Railway, Neon, Supabase).

### S1-5. Health endpoints
- `GET /api/health` → `{ "status": "ok" }`. It doesn't touch the database, so it shows the process is alive even when the DB is down (liveness check).
- `GET /api/health/db` (kept from the earlier version) runs `SELECT NOW()` and returns 503 if the DB is unreachable (readiness check).

### S1-6. nodemon for development
- `npm run dev` restarts on file changes. `npm start` uses plain `node` for production.

## Stage 2 — Database

### S2-1. UUID primary keys
- **Decision:** `UUID DEFAULT gen_random_uuid()` on all entity tables.
- **Why:** IDs can't be guessed or enumerated from URLs (`/users/5` → `/users/6`), they can be generated anywhere (e.g. by the ML service) without collisions, and they reveal nothing about row counts. `gen_random_uuid()` is built into PostgreSQL 13+, so no extension is needed.
- **Trade-off:** 16 bytes vs 4 for `SERIAL`, and slightly slower index inserts. That's negligible at this project's scale.
- **Exceptions (natural keys):** `price_history` uses `(asset_id, date)` because there's exactly one candle per asset per day. `user_preferences` uses `user_id` because there's exactly one row per user.

### S2-2. Foreign keys: `ON DELETE CASCADE`, with two deliberate exceptions
- Deleting a user removes their preferences, tokens, watchlist, holdings, transactions, SIPs and chats. This keeps the data consistent and supports the right to erasure.
- **`transactions.sip_plan_id` → `SET NULL`:** cancelling or deleting a SIP must not erase the trades it already executed.
- **`audit_log.user_id` → `SET NULL`:** an audit trail has to outlive the account it describes. Otherwise deleting a user would also destroy the evidence of what they did.

### S2-3. `CHECK` constraints rather than PostgreSQL `ENUM` types
- **Decision:** `role IN ('user','admin')`, `signal IN (...)`, etc. are `VARCHAR` + `CHECK`.
- **Why:** A `CHECK` can be dropped and re-created inside a migration. Changing an `ENUM` (especially removing a value) is awkward, and `CREATE TYPE` has no `IF NOT EXISTS`, which would break idempotency.

### S2-4. `NUMERIC` for money and quantities, never `FLOAT`
- Floating-point can't represent 0.1 exactly, so sums drift. `NUMERIC(20,8)` for prices and `NUMERIC(28,8)` for quantities hold exact values, with 8 decimals for fractional crypto (1 satoshi = 0.00000001 BTC). SIP `amount` and `fees` are fiat, so they use `NUMERIC(18,2)`.
- Note: `pg` returns `NUMERIC` as a JavaScript **string** to avoid precision loss. Convert deliberately in the API layer.

### S2-5. Timestamps
- `TIMESTAMPTZ` everywhere: it stores UTC and converts per client, which matters because crypto trades 24/7 while NSE runs on IST.
- `created_at` on every table. `updated_at` only on mutable tables (users, user_preferences, assets, sip_plans, holdings). Ledger-style tables (transactions, price_history, audit_log, chat_messages) are append-only, so they have no `updated_at`.
- **No `updated_at` triggers:** the original design used a PL/pgSQL trigger, but on the development machine Windows Application Control blocks PostgreSQL's `plpgsql.dll` (`An Application Control policy has blocked this file`). Rather than weaken OS security, the application sets `updated_at = NOW()` in its UPDATE queries. The schema now needs no procedural language at all, which also makes it more portable.

### S2-6. Idempotent schema in one file
- Every statement uses `CREATE TABLE/INDEX IF NOT EXISTS`, so `npm run migrate` can run any number of times.
- `scripts/migrate.js` runs the file inside a single transaction (PostgreSQL DDL is transactional), so a failure leaves the database unchanged. It then lists the tables as proof.
- **Limitation:** `IF NOT EXISTS` doesn't modify tables that already exist. Later changes go in an "Upgrades" section at the end of `schema.sql`, written as idempotent `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` statements (first used in Stages 5 and 6). PL/pgSQL is blocked (S2-5), so there's no conditional DDL and these statements re-run on every migrate. That's cheap at this scale. A production system with large tables would switch to numbered migration files (`001_*.sql`, `002_*.sql`) tracked in a `schema_migrations` table.

### S2-7. Table-specific decisions
- **users:** `email` is `UNIQUE` with `CHECK (email = LOWER(email))`, so `A@x.com` and `a@x.com` can't become two accounts. The app lowercases before inserting.
- **user_preferences:** `ui_state JSONB` holds open-ended UI state (collapsed panels, chart ranges) without needing a migration for each new UI feature. `theme` and `last_route` are real columns because they're read on every login.
- **refresh_tokens:** only a SHA-256 **hash** of each token is stored, so a database leak doesn't hand out live sessions. `revoked_at` supports logout and token rotation.
- **assets:** `UNIQUE (symbol, asset_type)`, so a stock and a coin with the same ticker can coexist. `currency` is stored per asset (stocks INR, crypto USD).
- **price_history:** OHLCV plus `CHECK (high >= low)` and non-negative values to reject bad imported data.
- **holdings:** derived from `transactions`, but stored so portfolio pages don't re-sum the whole ledger on every request. The application updates both in one DB transaction. `transactions` stays the source of truth.
- **sip_plans:** `next_run_date` plus a partial index `WHERE status = 'active'`, so a scheduler can find due plans cheaply.
- **advisories:** `UNIQUE (asset_id, advisory_date)` enforces one advisory per asset per day at the database level. Sentiment is in −1..1; risk and confidence are in 0..1.
- **news_sentiment:** `asset_id` is nullable for market-wide news. `UNIQUE (asset_id, url)` stops the same article being stored twice.
- **chat_messages:** `conversation_id` groups messages into threads without a separate conversations table (YAGNI for now).
- **audit_log:** `details JSONB` for flexible event payloads and `INET` for validated IP addresses.

### S2-8. Indexes
- Primary keys and `UNIQUE` constraints already create indexes. Extra indexes cover the main access patterns: tokens by user, transactions by user and time, news by asset and time, chats by conversation, audit by user and time, due SIPs.

### S2-9. Seed data
- 10 NSE large-caps (RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, HINDUNILVR, ITC, SBIN, BHARTIARTL, LT) and 5 cryptos (BTC, ETH, SOL, BNB, XRP).
- Admin credentials come from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, never from source code. The password is hashed with **bcryptjs** at cost 12. bcrypt is slow and salted, which makes brute-forcing leaked hashes expensive. bcryptjs is pure JavaScript, so there's no native build step on Windows.
- The seed is idempotent (`ON CONFLICT ... DO UPDATE`) and runs in one transaction. Re-running it resets the admin password to the current `ADMIN_PASSWORD`, so `.env` stays the source of truth.

### S2-10. Raw SQL with `pg`, no ORM
- Writing SQL directly keeps the schema explicit and easy to defend in a viva, and avoids ORM abstraction and dependency weight. All queries use parameter placeholders (`$1`), which prevents SQL injection.

## Cross-cutting (used by every later stage)

### X-1. Code structure: routes → services → database
- `src/routes/*` handle HTTP (validation, status codes, response shape). `src/services/*` hold business logic shared between routes and scripts (trading, SIP execution, tokens, advisory engine). For example, `executeTrade()` is used by `POST /transactions` and by the SIP runner, so both follow exactly the same holding rules.
- **Rejected:** a separate controller layer per route. At this size it would add files without separating anything new.

### X-2. Hand-written validation instead of a schema library
- `src/utils/validate.js` has small functions (`string`, `email`, `uuid`, `decimal`, `date`, `oneOf`, …) that return a cleaned value or throw `HttpError(400, "<field> <problem>")`.
- **Why:** no extra dependency (the brief asks to avoid unusual installs), every rule is visible and explainable, and error messages name the field.
- Decimals are validated as **strings** (`^\d+(\.\d{1,8})?$`) and passed to PostgreSQL unchanged, so a JavaScript float never touches a stored quantity or price.
- **Rejected:** Joi or Zod. They're good libraries, but they'd be an extra dependency for about 15 field types.

### X-3. Errors
- One error handler maps failures to status codes:
  - `HttpError` → its own status.
  - PostgreSQL constraint errors → client errors: unique violation `23505` → 409, foreign-key `23503` → 400, check `23514` → 400, bad format `22P02` → 400.
  - Anything else → 500 with a generic message, and the full error is logged on the server.
- So the database constraints from Stage 2 act as a last line of validation, and their failures surface as clean 4xx responses instead of 500s.

### X-4. Response format
- Snake_case rows are converted to camelCase (`camelize`) to match JavaScript and React conventions.
- pg type parsers: `NUMERIC` → JS number (all arithmetic is already done in SQL), `COUNT` bigint → number, and `DATE` → plain `YYYY-MM-DD` string. Without the last one, pg turns a `DATE` into a JS `Date` at local midnight, and `JSON.stringify` then shows the **previous day** in UTC for IST users (+05:30). This is a classic off-by-one-day bug.

### X-5. Transactions
- `withTransaction(fn)` wraps `BEGIN/COMMIT/ROLLBACK` on a single pooled client. Anything that changes several tables (register = user + preferences + tokens + audit; trade = holding + transaction + audit) commits together or not at all.

## Stage 3 — Authentication and users

### S3-1. Access token plus refresh token
- **Access token:** a JWT (HS256, 15 minutes) holding the user id (`sub`) and role. It's verified without a database lookup, so most requests stay fast.
- **Refresh token:** 48 random bytes (base64url), valid for 30 days, used only at `/auth/refresh`. Only its SHA-256 hash is stored (`refresh_tokens.token_hash`). A database leak doesn't hand out usable sessions, and SHA-256 is enough here (no bcrypt needed) because the token is random and high-entropy, not a guessable password.
- **Why two tokens:** a stolen access token works for at most 15 minutes, while users stay signed in for 30 days. Logging out and changing the password work by revoking refresh tokens.
- **Rejected:** one long-lived JWT, which can't be revoked before it expires. Server-side sessions, which need a lookup on every request plus sticky sessions or shared storage.
- `jwt.verify` pins `algorithms: ["HS256"]` and the `issuer`, which blocks the known `alg: none` and algorithm-switching attacks.

### S3-2. Refresh-token rotation with reuse detection
- Each refresh token works **once**: `/auth/refresh` revokes it and issues a new pair.
- If an already-revoked token is presented, someone else must have a copy. The server then revokes **all** of that user's tokens and writes `auth.refresh_token_reuse` to the audit log. This follows the OAuth 2.0 Security Best Current Practice (RFC 9700) recommendation for refresh tokens.
- The token row is locked with `SELECT ... FOR UPDATE`, so two simultaneous refreshes can't both succeed.
- The 401 for reuse is thrown **after** the transaction commits. Otherwise the error would roll back the revocation it just made.

### S3-3. Refresh token in the JSON body, not a cookie
- **Why:** simpler for a separate React SPA on another port (no cookie or CSRF setup), and easy to test with Postman.
- **Trade-off:** JavaScript can read a token kept in browser storage, so an XSS bug could steal it. An `httpOnly`, `SameSite=Strict` cookie would be safer and is the recommended hardening for production. Short access tokens and reuse detection limit the damage meanwhile.

### S3-4. Password handling
- bcrypt at cost 12, measured at about 0.73 s per hash with pure-JavaScript `bcryptjs` on the dev machine. That's slow enough to make offline guessing expensive and acceptable for an occasional login or register. If it ever bottlenecks under load, the options are cost 11 (about half the time) or the native `bcrypt` package (faster, but needs a C++ build toolchain on Windows).
- Length 8 to **72 bytes**, because bcrypt silently ignores everything after byte 72. Two long passwords sharing their first 72 bytes would otherwise both work.
- **Timing-safe login:** when the email doesn't exist, the password is still compared against a dummy hash, so the response takes the same time. Together with one shared message ("Invalid email or password"), this stops attackers from discovering which emails are registered.
- Changing the password revokes all refresh tokens, so other devices are signed out.
- Emails are lowercased before saving and before lookup, matching the `CHECK (email = LOWER(email))` constraint from Stage 2.

### S3-5. Rate limiting login and register
- A small in-memory fixed-window limiter (`middleware/rateLimit.js`) allows 20 attempts per IP per 15 minutes and returns 429 with `Retry-After` and `RateLimit-*` headers.
- **Why hand-written:** about 30 lines, no dependency, easy to explain.
- **Limitation:** the counters live in one process, so several server instances would each count separately. That needs a shared store (e.g. Redis, which the brief excludes) or a proxy-level limit. Behind a reverse proxy, Express `trust proxy` must be set so `req.ip` is the real client IP.

### S3-6. Admin checks read the role from the database
- The JWT carries the role, but `requireAdmin` re-reads `users.role`. Demoting an admin takes effect immediately, not up to 15 minutes later, at the cost of one indexed lookup on admin routes only.
- Admins can't change their own role, so the last admin can't lock everyone out by accident.

### S3-7. Preferences
- `PATCH /users/me/preferences` is a partial update done as one upsert. `COALESCE` keeps fields that weren't sent. `uiState` is limited to 10 KB so it can't be abused as free storage.

### S3-8. Account deletion
- `DELETE /users/me` needs the password, then deletes the user. The Stage 2 foreign keys cascade to all personal data. The audit row written just before is kept, with `user_id` set to NULL and the old id in `entity_id`.

## Stage 4 — Assets and market data

### S4-1. Public read endpoints
- Asset lists, prices, advisories and news need no login, so the landing pages can show live data. Writing needs an admin or the ML service.

### S4-2. Latest quote via `LATERAL` joins
- Lists include the latest close, the previous close and the daily % change. These come from two `LEFT JOIN LATERAL (... ORDER BY date DESC LIMIT 1)` subqueries, which use the `(asset_id, date)` primary-key index directly. The SQL fragment is shared (`QUOTE_JOINS`), so assets, watchlist, portfolio and chat all calculate it the same way.
- **Rejected:** storing a "current price" column on `assets`, which duplicates data and can go stale.

### S4-3. Bulk price ingestion
- `PUT /assets/:id/prices` takes up to 5,000 candles and upserts them in **one** SQL statement using `unnest()` over parallel arrays. Re-sending the same dates overwrites them, so imports can be repeated safely.
- `npm run import:prices` reads Yahoo-Finance-style CSV files and reuses the same validation and upsert code.
- `replace: true` (added for the ML pipeline) deletes the asset's existing candles before inserting, in one transaction. Upserting alone would leave synthetic demo candles behind on dates the real data doesn't cover, e.g. today's synthetic candle would stay the "latest price". With one transaction, readers see either the old history or the new one, never a mix.

### S4-4. Synthetic sample data
- `npm run seed:sample-prices` generates deterministic random-walk prices so charts, valuation, SIPs and advisories can be demonstrated offline. The script, its output and this document all label the data as **synthetic, not real market prices**. Results from it must not be presented as market analysis.

### S4-5. Search safety
- `q` is matched with `ILIKE`, and `%`, `_` and `\` are escaped (`likePattern`), so user input is matched literally and can't act as a wildcard.

## Stage 5 — Portfolio: watchlist, transactions, holdings, SIPs

### S5-1. Ledger plus materialised holdings, always in one transaction
- `executeTrade()` inserts the transaction and updates `holdings` inside one database transaction, so they can never disagree. `transactions` is append-only (no update or delete endpoints). A mistake is corrected with an opposite trade, which keeps history auditable, as accounting ledgers do.

### S5-2. Weighted average cost, calculated in SQL
- On a buy: `avg = (old_qty × old_avg + qty × price) / (old_qty + qty)`. This runs inside `INSERT ... ON CONFLICT DO UPDATE` on `NUMERIC` values, so the result is exact (verified by a test: 10 @ 3000 + 5 @ 3600 → exactly 3200).
- Fees aren't added to the average cost. They're subtracted from realised P&L on sells instead, which keeps the average equal to the price actually paid.
- A sell doesn't change the average cost. Realised P&L = `(sell price − avg) × qty − fees` is returned in the response.

### S5-3. Safe concurrent sells
- `UPDATE holdings SET quantity = quantity − $q WHERE ... AND quantity >= $q` checks and decrements in one atomic statement. Two simultaneous sells can't both spend the same units, and no explicit lock is needed. A holding that reaches zero is deleted.

### S5-4. Portfolio valuation per currency
- Holdings are valued at the latest close, with cost basis, market value, unrealised P&L and %, all calculated in SQL.
- Totals are **grouped by currency**: stocks are in INR, crypto in USD, and adding them without an exchange rate would be meaningless. Allocation % uses a window function (`SUM() OVER (PARTITION BY currency)`).

### S5-5. Watchlist add is idempotent
- Adding an asset that's already watched returns 200 instead of 409. That's simpler for the UI (a "star" button) and has the same outcome.

### S5-6. SIP execution
- Each run buys `ROUND(amount / latest close, 8)` units. Fractional units are allowed, which is a simplification for stocks, where real SIPs buy whole shares or go through mutual funds.
- Every due plan runs in **its own** transaction with `SELECT ... FOR UPDATE SKIP LOCKED`. Two scheduler runs at once never execute the same plan twice, and one failing plan doesn't stop the others.
- **No back-filling:** an overdue plan (e.g. the server was off) runs once, then `next_run_date` jumps to the first scheduled date after today (`generate_series`). Buying several periods' worth at one price would misrepresent the SIP.
- If there's no price, the plan is skipped and stays due for the next run.
- A plan whose `end_date` has passed becomes `completed`. This needed a new status value, added with an idempotent `DROP/ADD CONSTRAINT` (see S2-3: this is why `CHECK` was chosen over `ENUM`).
- Resuming a paused plan whose run date passed restarts it from today, again with no back-fill. Cancelled and completed plans are final (409).
- Scheduling: an in-process timer (`SIP_SCHEDULER_INTERVAL_MINUTES`, default 60) for simplicity, plus `npm run sips:run` for cron or Windows Task Scheduler and `POST /admin/sips/run` for demos. `SKIP LOCKED` makes it safe to use all three together.

## Stage 6 — Advisories and news (ML integration)

### S6-1. Service-key authentication for the ML pipeline
- The ML service sends `X-Service-Key: <ML_SERVICE_KEY>`, compared with `crypto.timingSafeEqual` so the comparison time doesn't leak the key.
- **Why not a user account:** a service doesn't log in, has no password to rotate through the UI, and shouldn't be able to act as a person. Admins can call the same endpoints with their JWT.

### S6-2. Upsert by natural keys
- Advisories are upserted on `(asset_id, advisory_date)`, so re-running the model for a day replaces its output (one advisory per asset per day, as the brief asks).
- News is upserted on `(asset_id, url)` with `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+), so a market-wide article (`asset_id` NULL) also can't be stored twice. Plain `UNIQUE` treats NULLs as different, which would have allowed duplicates. `url` became `NOT NULL` for the same reason.
- Ingestion accepts `symbol + assetType` instead of `assetId`, because the ML pipeline knows tickers, not database UUIDs.
- A whole batch runs in one transaction: one invalid item rejects the batch and the error names it (`advisories[3].confidence ...`).
- News URLs must start with `http(s)://`, so a `javascript:` URL can't be stored and later rendered as a link.

### S6-3. Baseline advisory engine
- Until the ML model is ready, `services/advisoryEngine.js` produces explainable advisories from price history:
  - trend = 20-day vs 50-day simple moving average (SMA)
  - risk = annualised volatility of 30 daily log returns, capped at 1
  - an optional 7-day news-sentiment adjustment
- Rules:
  - risk ≥ 0.85 → `high_risk`
  - gap > +2% and price above SMA20 → `buy`
  - gap < −2% and price below SMA20 → `sell`
  - |gap| ≤ 1% → `hold`
  - otherwise → `watch`
  - strongly negative news turns a buy into watch; strongly positive news turns a sell into watch
  - confidence grows with the size of the gap (0.5 to 0.95)
- It's tagged `model_version = "baseline-sma-v1"` and **never overwrites** an advisory from another model for the same day (`ON CONFLICT ... WHERE model_version = ...`), so ML output always wins.
- `computeAdvisory()` is a pure function, so the rules are unit-tested without a database.
- This is a simple rule-based technical-indicator baseline, not a predictive model. It also serves as the comparison point for evaluating the ML model in the paper.

## Stage 7 — Chat assistant and audit log

### S7-1. Rule-based, data-grounded assistant
- `generateReply()` recognises intents with keyword patterns (help, portfolio, watchlist, SIPs, a mentioned symbol or company name, buy/sell advice) and answers **only from the database**: the user's holdings, latest prices, advisories and their rationale.
- **Why:** no external API, no cost, no hallucinated numbers, and every answer can be traced. Answers that involve signals end with a "not financial advice" disclaimer.
- **Extension point:** `generateReply(userId, message)` is the only function the route calls, so it can later be swapped for the ML service or an LLM without changing the API.
- Messages are grouped by a `conversation_id` UUID. Another user's conversation id returns 404, never their messages.
- The question and the answer use `clock_timestamp()` rather than `NOW()`. `NOW()` is the same for a whole transaction, which could give both messages the same timestamp and make their order ambiguous.

### S7-2. What is audited and how
- Recorded events:
  - register, login, failed login (with the attempted email), logout and logout-all
  - refresh-token reuse
  - password change and account deletion
  - role change
  - asset create and update
  - every transaction, SIP create, update and execution
  - admin SIP runs and advisory generation
- Changes to data (trades, SIPs, roles) are logged with the **same transaction client**, so an audit row exists exactly when the change committed.
- Login events use `logAuditSafely`, so a logging failure never blocks sign-in.
- The client IP is stored as `INET`. Admins can filter the log by user or action.

## Stage 8 — Quality: tests, API docs, Postman

### S8-1. Tests use Node's built-in runner and real HTTP
- `node --test` and `fetch`, both built into Node 24, so no Jest, Mocha or Supertest is installed.
- Every test file rebuilds a separate `finsight_test` database (schema + seed), starts the app on a random port and sends real HTTP requests. The middleware, SQL and constraints are exercised exactly as in production.
- **Safety:** the reset runs `DROP SCHEMA public CASCADE`, so it refuses to run unless the database name ends in `_test`. That's checked twice, on the URL and on the live connection with `SELECT current_database()`. The second check was added after code review found that a test importing an app module before the helper would have connected to the dev database.
- Files run one at a time (`--test-concurrency=1`) because they share the test database.
- 60 tests cover auth (rotation, reuse detection, timing-equal errors), validation, exact average-cost maths, oversell protection, P&L, per-currency totals, SIP scheduling edge cases, ingestion auth, the advisory rules, chat privacy, admin and rate limiting.

### S8-2. Postman collection
- `postman/FinSight.postman_collection.json`: 35 requests and 44 assertions that walk through a whole user journey. It saves tokens and ids into variables as it goes, so it doubles as a live demo for the viva. It runs headless with the Postman CLI (`postman collection run`).

### S8-3. Frontend integration (not done here: frontend is out of scope)
- CORS already allows the Vite dev server (`CORS_ORIGIN`). `docs/API.md` is the contract for the React client: store the access token in memory, call `/auth/refresh` on a 401, and send `Authorization: Bearer`.

## Stage 9 — Range forecasts on advisories

### S9-1. Five nullable columns, not a separate table
- `price_low`, `price_high`, `range_level`, `horizon_days` and `range_model_version` on `advisories`. A range belongs to exactly one advisory (same asset, same day, same ML run), so a separate table would add a join for no benefit.
- **Nullable** so rule-based baseline advisories and older ML runs stay valid.
- **Added with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`** in the upgrade section of `schema.sql`, so `npm run migrate` upgrades existing databases in place without PL/pgSQL.

### S9-2. Validated twice: database and API
- A CHECK constraint (`advisories_range_check`) enforces "all range fields or none", `price_low > 0`, `price_high >= price_low`, `0 < range_level < 1` and `horizon_days` 1–60. Even a direct SQL insert can't store a broken range.
- The API checks the same rules first, so clients get a clear 400 message naming the field instead of a database error.
- `NUMERIC(20, 8)` for prices, the same precision as `price_history`, so coin prices like XRP's keep their decimals.

### S9-3. The assistant leads with the range
- "Tell me about ITC" now starts with "Forecast range: 80% likely to close between INR 274.08 and INR 295.13 in 5 trading days", before the direction signal. The ML evaluation shows the range has measurable skill and the direction doesn't, so the more reliable information comes first.
