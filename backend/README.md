# FinSight Backend

REST API for FinSight, built with Node.js 24, Express 5 and PostgreSQL 15 or later (developed on 18). It provides:

- authentication with JWT access tokens and rotating refresh tokens
- market data
- portfolio tracking: watchlists, transactions, holdings and SIPs
- advisories and news sentiment
- a data-driven chat assistant
- admin tools and an audit log

## Setup

```powershell
cd backend
npm install
copy .env.example .env      # then fill in DATABASE_URL, JWT_SECRET, ML_SERVICE_KEY, ADMIN_PASSWORD, TEST_DATABASE_URL
npm run migrate             # create or upgrade tables (safe to re-run)
npm run seed                # 10 NSE stocks, 5 cryptos, admin user
npm run seed:sample-prices  # optional: SYNTHETIC prices for demos
npm run advisories:generate # optional: baseline advisories from those prices
npm run dev                 # http://localhost:5000/api/health
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | Start the API (dev mode restarts on file changes). |
| `npm run migrate` | Apply `src/db/schema.sql` and list the tables. |
| `npm run seed` | Upsert the seed assets and the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. |
| `npm run seed:sample-prices [-- days]` | Generate synthetic daily prices (not real market data). |
| `npm run import:prices -- file.csv SYMBOL stock\|crypto` | Import real OHLCV prices from a CSV (Yahoo Finance format). |
| `npm run advisories:generate` | Generate today's baseline SMA and volatility advisories. |
| `npm run sips:run` | Execute SIP plans that are due (for cron or Task Scheduler). |
| `npm run db:create-test` | Create the test database named in `TEST_DATABASE_URL`. |
| `npm test` | Run the automated API tests against the test database. |

The Postman collection in `postman/FinSight.postman_collection.json` runs a full demo flow. Import it into Postman, or run it from the command line:

```powershell
postman collection run postman/FinSight.postman_collection.json --env-var "adminPassword=<your admin password>"
```

## Layout

```
src/
  app.js            Express app: middleware and routes
  server.js         starts the HTTP server and the SIP scheduler
  config/env.js     loads .env and checks required variables at startup
  db/               pool, schema.sql, migrate and seed helpers
  middleware/       auth (JWT, admin, service key), rate limiting, errors
  routes/           one file per resource
  services/         tokens, trading, SIPs, assets, advisories, assistant, audit
  utils/            validation, errors, camelCase serialisation
scripts/            command-line tasks (migrate, seed, import, run SIPs, ...)
tests/              node:test API tests
docs/               API.md, DECISIONS.md, VIVA_NOTES.md, FinSight_Backend_Research.docx
```

See `docs/API.md` for every endpoint and `docs/DECISIONS.md` for why things are built this way.
