# FinSight API Reference

Base URL: `http://localhost:5000/api`. Every request and response body is JSON, with camelCase fields.

**Authentication.** Send `Authorization: Bearer <accessToken>` on routes marked 🔒. Routes marked 👑 also need the admin role. Routes marked 🤖 accept either an admin token or the ML service header `X-Service-Key: <ML_SERVICE_KEY>`.

**Errors.** Errors look like `{ "error": "message" }`:

| Status | Meaning |
|---|---|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Not allowed |
| 404 | Not found |
| 409 | Conflict |
| 413 | Body too large |
| 429 | Rate limited |
| 500 | Server error |

**Pagination.** List endpoints take `limit` (default 50, max 200) and `offset`.

**Numbers and dates.** Money and quantities are stored as exact `NUMERIC` and returned as JSON numbers. You can send them as numbers or strings, with up to 8 decimals (2 for amounts and fees). Dates use `YYYY-MM-DD`; timestamps use ISO 8601.

---

## Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ status: "ok" }`. Liveness check. |
| GET | `/health/db` | Database connectivity. Returns 503 if unreachable. |

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` | 201 `{ user, accessToken, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` | `{ user, accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }`. The old token is consumed. |
| POST | `/auth/logout` | `{ refreshToken }` | 204 |
| POST | `/auth/logout-all` 🔒 | none | 204. Revokes every session. |

- Register and login are rate limited (default 20 per 15 minutes per IP).
- Passwords must be 8 to 72 bytes.
- Access tokens last 15 minutes and refresh tokens 30 days.
- Reusing a refresh token that was already used revokes all of that user's sessions.

## Current user 🔒
| Method | Path | Body / notes |
|---|---|---|
| GET | `/users/me` | `{ user, preferences }` |
| PATCH | `/users/me` | `{ name }` |
| PATCH | `/users/me/password` | `{ currentPassword, newPassword }`. Signs out all sessions. |
| DELETE | `/users/me` | `{ password }`. Deletes the account and all personal data. |
| GET | `/users/me/preferences` | `{ preferences: { theme, lastRoute, uiState } }` |
| PATCH | `/users/me/preferences` | Any of `{ theme: "light"\|"dark", lastRoute, uiState: {...} }` |

## Assets and market data
| Method | Path | Notes |
|---|---|---|
| GET | `/assets?type=stock\|crypto&q=` | Public. Includes `latestPrice`, `previousClose`, `changePct`. |
| GET | `/assets/:id` | Public. `{ asset, latestAdvisory, sentiment7d: { average, articles } }` |
| GET | `/assets/:id/prices?from=&to=` | Public. OHLCV candles, oldest first. Defaults to the last 365 days. |
| GET | `/assets/:id/advisories` | Public. Advisory history, newest first. |
| POST | `/assets` 👑 | `{ symbol, name, assetType, exchange?, currency? }` |
| PATCH | `/assets/:id` 👑 | `{ name?, exchange?, currency?, isActive? }` |
| PUT | `/assets/:id/prices` 🤖 | `{ candles: [{ date, open, high, low, close, volume? }], replace? }`. Upserts up to 5,000 candles. `replace: true` first deletes all stored candles for the asset, in the same transaction. Returns `{ deleted, upserted }`. |

## Watchlist 🔒
| Method | Path | Notes |
|---|---|---|
| GET | `/watchlist` | Items with latest quotes. |
| POST | `/watchlist` | `{ assetId }`. Returns 201 if added, 200 if already there. |
| DELETE | `/watchlist/:assetId` | 204 |

## Transactions 🔒
| Method | Path | Notes |
|---|---|---|
| GET | `/transactions?assetId=&sipPlanId=&type=` | Newest first. |
| POST | `/transactions` | `{ assetId, type: "buy"\|"sell", quantity, price?, fees?, executedAt? }`. Returns 201 `{ transaction, realizedPnl }`. |

- If `price` is omitted, the latest close is used.
- A sell larger than the holding returns 400.
- Transactions can't be edited or deleted. To correct a mistake, record an opposite trade.

## Portfolio 🔒
| Method | Path | Notes |
|---|---|---|
| GET | `/portfolio` | Returns `{ holdings, totals }`. |

- Each holding has `quantity`, `avgBuyPrice`, `latestPrice`, `costBasis`, `marketValue`, `unrealizedPnl`, `unrealizedPnlPct` and `allocationPct`.
- `totals` has one row per currency.

## SIP plans 🔒
| Method | Path | Notes |
|---|---|---|
| GET | `/sips?status=` | Includes the `executions` count. |
| GET | `/sips/:id` | |
| POST | `/sips` | `{ assetId, amount, frequency: "daily"\|"weekly"\|"monthly", startDate?, endDate? }`. `startDate` defaults to today. |
| PATCH | `/sips/:id` | `{ amount?, status?: "active"\|"paused"\|"cancelled", endDate? }`. Cancelled and completed plans return 409. |

How due plans run:
- They run from the in-process scheduler, `npm run sips:run`, or `POST /admin/sips/run`.
- Each run buys `amount / latest close` units, rounded to 8 decimals.
- Missed periods aren't back-filled: an overdue plan runs once, then moves to the next future date.

## Advisories and news
| Method | Path | Notes |
|---|---|---|
| GET | `/advisories?signal=&type=` | Public. The latest advisory per asset, sorted by confidence. |
| POST | `/advisories` 🤖 | `{ advisories: [{ assetId \| symbol+assetType, date, signal, sentimentScore?, riskScore?, confidence?, rationale?, modelVersion?, priceLow?, priceHigh?, rangeLevel?, horizonDays?, rangeModelVersion? }] }`. Upserts one advisory per asset per day. |
| GET | `/news?assetId=&sentiment=` | Public. Newest first. |
| POST | `/news` 🤖 | `{ articles: [{ assetId? \| symbol+assetType?, headline, source?, url, publishedAt, sentimentScore, sentimentLabel }] }`. Leave out the asset for market-wide news. Upserts by (asset, url). |

- `signal` is one of `buy`, `hold`, `sell`, `watch`, `high_risk`.
- **Range forecast (optional):** `priceLow` and `priceHigh` bound the close `horizonDays` trading days ahead (1–60) with probability `rangeLevel` (strictly between 0 and 1, e.g. 0.8). Send all four together or none; `priceHigh` must be ≥ `priceLow`. `GET /advisories` and `GET /assets/:id` return them, and `GET /advisories` also includes the asset's `currency`.
- `sentimentScore` is between -1 and 1; `riskScore` and `confidence` are between 0 and 1.
- `sentimentLabel` is one of `positive`, `neutral`, `negative`.

## Chat assistant 🔒
| Method | Path | Notes |
|---|---|---|
| POST | `/chat/messages` | `{ content, conversationId? }`. Returns 201 `{ conversationId, messages: [user, assistant] }`. |
| GET | `/chat/conversations` | Each conversation has `title` (its first question), `messageCount` and `lastMessageAt`. |
| GET | `/chat/conversations/:id/messages` | Messages in order. |
| DELETE | `/chat/conversations/:id` | 204 |

The assistant answers questions about your portfolio, watchlist and SIPs, and about any asset you mention by symbol or name. It can also list the top buy signals, and replies to "help".

## Admin 👑
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | Counts of users, assets, transactions, SIPs and today's advisories. |
| GET | `/admin/users?q=` | Paginated, with `total`. |
| PATCH | `/admin/users/:id/role` | `{ role: "user"\|"admin" }`. Admins can't change their own role. |
| GET | `/admin/audit-log?userId=&action=` | Newest first. Default limit 100, max 500. |
| POST | `/admin/sips/run` | Runs due SIP plans now. |
| POST | `/admin/advisories/generate` | Generates today's baseline (SMA) advisories. |
