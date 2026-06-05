-- Day-10 initial schema: intent + job tracking.
--
-- These tables back the Day-11 REST API. Subgraph data is queried directly
-- from Goldsky; we only persist the bits the chain doesn't index for us:
--   * idempotency_keys — server-side dedup across retries (T-11.2 dependency)
--   * intents          — server-issued intent rows (one per submitted action)
--   * jobs             — Kurier / bundler job status mirrored from external
--                        services so we can answer status polls without an
--                        upstream round-trip
--
-- Conventions:
--   * Every row carries created_at / updated_at as timestamptz, set via
--     trigger so callers can't drift them.
--   * All amounts are stored as numeric(78,0) so we can round-trip a uint256
--     without loss; reads convert to BigInt at the JS boundary.

BEGIN;

CREATE TYPE intent_kind AS ENUM (
  'entry_deposit',
  'entry_withdraw',
  'supply',
  'withdraw_supply',
  'deposit_collateral',
  'withdraw_collateral',
  'borrow',
  'repay',
  'liquidate',
  'consolidate_balance'
);

CREATE TYPE intent_status AS ENUM (
  'received',     -- POST landed; nothing submitted yet
  'proving',      -- prover-service has the witness
  'submitted',    -- proof submitted to Kurier
  'aggregated',   -- Kurier reports Aggregated
  'userop_pending', -- bundler has the userOp
  'confirmed',    -- on-chain tx mined
  'failed'        -- terminal failure; see failure_reason
);

CREATE TABLE idempotency_keys (
  id              text PRIMARY KEY,
  intent_id       uuid NOT NULL,
  response_body   jsonb NOT NULL,
  response_status smallint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_address bytea NOT NULL,
  kind            intent_kind NOT NULL,
  asset_id        smallint NOT NULL,
  amount          numeric(78,0),
  status          intent_status NOT NULL DEFAULT 'received',
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intents_account_idx ON intents (account_address);
CREATE INDEX intents_status_idx ON intents (status);

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id       uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  kurier_job_id   text UNIQUE,
  bundler_user_op text UNIQUE,
  tx_hash         bytea,
  status_payload  jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_intent_idx ON jobs (intent_id);

-- updated_at trigger: set NEW.updated_at = now() on every UPDATE so callers
-- can't drift it. One function reused by every table that wants it.
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER intents_touch
  BEFORE UPDATE ON intents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER jobs_touch
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
