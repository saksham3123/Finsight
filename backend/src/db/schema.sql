-- FinSight database schema.
-- Safe to run repeatedly: every table and index uses IF NOT EXISTS.
-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is needed.

-- updated_at has a DEFAULT for inserts; the application sets it on every UPDATE.
-- (No trigger: PL/pgSQL is blocked by Windows Application Control on the dev machine.)

-- ---------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE CHECK (email = LOWER(email)),
  password_hash TEXT NOT NULL,
  role          VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per user, so user_id is the primary key.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme      VARCHAR(5) NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
  last_route TEXT,
  ui_state   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only a SHA-256 hash of each refresh token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------------
-- Market data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol     VARCHAR(20) NOT NULL,
  name       VARCHAR(150) NOT NULL,
  asset_type VARCHAR(10) NOT NULL CHECK (asset_type IN ('stock', 'crypto')),
  exchange   VARCHAR(30),
  currency   CHAR(3) NOT NULL DEFAULT 'INR',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, asset_type)
);

-- Daily OHLCV candles. NUMERIC avoids floating-point rounding on money values;
-- 8 decimal places cover fractional crypto prices and volumes.
CREATE TABLE IF NOT EXISTS price_history (
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  open       NUMERIC(20, 8) NOT NULL CHECK (open >= 0),
  high       NUMERIC(20, 8) NOT NULL CHECK (high >= 0),
  low        NUMERIC(20, 8) NOT NULL CHECK (low >= 0),
  close      NUMERIC(20, 8) NOT NULL CHECK (close >= 0),
  volume     NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (volume >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, date),
  CHECK (high >= low)
);

-- ---------------------------------------------------------------------------
-- Portfolio
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS watchlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);

-- Created before transactions because transactions reference it.
CREATE TABLE IF NOT EXISTS sip_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  amount        NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  frequency     VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  start_date    DATE NOT NULL,
  end_date      DATE,
  next_run_date DATE NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sip_plans_status_check CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_sip_plans_user ON sip_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_sip_plans_due ON sip_plans(next_run_date) WHERE status = 'active';

-- Immutable ledger of every buy and sell.
-- sip_plan_id uses SET NULL: cancelling or deleting a SIP must not erase its trade history.
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  sip_plan_id UUID REFERENCES sip_plans(id) ON DELETE SET NULL,
  txn_type    VARCHAR(4) NOT NULL CHECK (txn_type IN ('buy', 'sell')),
  quantity    NUMERIC(28, 8) NOT NULL CHECK (quantity > 0),
  price       NUMERIC(20, 8) NOT NULL CHECK (price >= 0),
  fees        NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_time ON transactions(user_id, executed_at DESC);

-- Current position per user per asset, derived from transactions and kept
-- in step by the application so portfolio reads do not re-sum the ledger.
CREATE TABLE IF NOT EXISTS holdings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  quantity      NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_buy_price NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (avg_buy_price >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);

-- ---------------------------------------------------------------------------
-- Insights
-- ---------------------------------------------------------------------------

-- One advisory per asset per day. Sentiment is -1..1; risk and confidence are 0..1.
CREATE TABLE IF NOT EXISTS advisories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  advisory_date   DATE NOT NULL,
  signal          VARCHAR(10) NOT NULL CHECK (signal IN ('buy', 'hold', 'sell', 'watch', 'high_risk')),
  sentiment_score NUMERIC(5, 4) CHECK (sentiment_score BETWEEN -1 AND 1),
  risk_score      NUMERIC(5, 4) CHECK (risk_score BETWEEN 0 AND 1),
  confidence      NUMERIC(5, 4) CHECK (confidence BETWEEN 0 AND 1),
  rationale       TEXT,
  model_version   VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, advisory_date)
);

-- asset_id is nullable so market-wide news can be stored without a specific asset.
-- NULLS NOT DISTINCT (PostgreSQL 15+) makes the same market-wide URL a duplicate too.
CREATE TABLE IF NOT EXISTS news_sentiment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID REFERENCES assets(id) ON DELETE CASCADE,
  headline        TEXT NOT NULL,
  source          VARCHAR(100),
  url             TEXT NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL,
  sentiment_score NUMERIC(5, 4) NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),
  sentiment_label VARCHAR(10) NOT NULL CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT news_sentiment_asset_id_url_key UNIQUE NULLS NOT DISTINCT (asset_id, url)
);
CREATE INDEX IF NOT EXISTS idx_news_sentiment_asset_time ON news_sentiment(asset_id, published_at DESC);

-- ---------------------------------------------------------------------------
-- Chat and auditing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(user_id, conversation_id, created_at);

-- user_id uses SET NULL: audit records must outlive the account they describe.
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   UUID,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Upgrades for databases created by an earlier version of this file.
-- CREATE TABLE IF NOT EXISTS never alters an existing table, so changed
-- constraints are dropped and re-added here. Without PL/pgSQL (blocked on the
-- dev machine) there is no conditional DDL, so these run on every migrate;
-- they are cheap on tables of this size.
-- ---------------------------------------------------------------------------

-- Stage 5: SIP plans gain a terminal "completed" status (end date reached).
ALTER TABLE sip_plans DROP CONSTRAINT IF EXISTS sip_plans_status_check;
ALTER TABLE sip_plans ADD CONSTRAINT sip_plans_status_check
  CHECK (status IN ('active', 'paused', 'cancelled', 'completed'));

-- Stage 6: every news item needs a URL, and market-wide duplicates are rejected.
ALTER TABLE news_sentiment ALTER COLUMN url SET NOT NULL;
ALTER TABLE news_sentiment DROP CONSTRAINT IF EXISTS news_sentiment_asset_id_url_key;
ALTER TABLE news_sentiment ADD CONSTRAINT news_sentiment_asset_id_url_key
  UNIQUE NULLS NOT DISTINCT (asset_id, url);

-- Stage 8: advisories carry an ML range forecast, an interval for the close
-- `horizon_days` trading days ahead with probability `range_level` (e.g. 0.8).
-- Nullable, so baseline advisories and older ML runs stay valid.
ALTER TABLE advisories ADD COLUMN IF NOT EXISTS price_low NUMERIC(20, 8);
ALTER TABLE advisories ADD COLUMN IF NOT EXISTS price_high NUMERIC(20, 8);
ALTER TABLE advisories ADD COLUMN IF NOT EXISTS range_level NUMERIC(4, 3);
ALTER TABLE advisories ADD COLUMN IF NOT EXISTS horizon_days SMALLINT;
ALTER TABLE advisories ADD COLUMN IF NOT EXISTS range_model_version VARCHAR(50);
ALTER TABLE advisories DROP CONSTRAINT IF EXISTS advisories_range_check;
ALTER TABLE advisories ADD CONSTRAINT advisories_range_check CHECK (
  (price_low IS NULL AND price_high IS NULL AND range_level IS NULL AND horizon_days IS NULL)
  OR (price_low > 0 AND price_high >= price_low AND range_level > 0 AND range_level < 1
      AND horizon_days BETWEEN 1 AND 60)
);
