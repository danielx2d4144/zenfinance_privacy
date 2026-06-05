-- Inverse of 01__init.up.sql — strict reverse order, transactional.
-- After this runs the public schema should hold no zenfinance objects.

BEGIN;

DROP TRIGGER IF EXISTS jobs_touch ON jobs;
DROP TRIGGER IF EXISTS intents_touch ON intents;

DROP FUNCTION IF EXISTS touch_updated_at();

DROP INDEX IF EXISTS jobs_intent_idx;
DROP TABLE IF EXISTS jobs;

DROP INDEX IF EXISTS intents_status_idx;
DROP INDEX IF EXISTS intents_account_idx;
DROP TABLE IF EXISTS intents;

DROP TABLE IF EXISTS idempotency_keys;

DROP TYPE IF EXISTS intent_status;
DROP TYPE IF EXISTS intent_kind;

COMMIT;
