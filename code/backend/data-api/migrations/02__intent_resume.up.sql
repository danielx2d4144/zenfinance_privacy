-- M3: make an in-flight intent survive a process restart.
--
-- Real Kurier aggregation takes minutes (2m 54s measured on Horizen testnet),
-- which is far longer than a deploy, an OOM kill or a Railway restart. Before
-- this migration the handler ran fire-and-forget in memory, so a restart left
-- the intent stuck in `proving` forever while zkVerify happily went on to
-- aggregate and publish the proof.
--
-- Resuming needs two things the database didn't hold:
--
--   intents.request_body — the original POST body. The handler derives the
--     pool, the method and every argument from it deterministically, so
--     replaying the body is enough to rebuild the call. It also carries the
--     proof bytes, which is what makes resuming cheaper than re-proving.
--     No new disclosure: these bytes were already sent to Kurier, and the
--     public inputs are public by construction.
--
--   jobs.kurier_job_id — already exists (see 01__init.up.sql); this only adds
--     the lookup index, since the boot sweep joins jobs to intents by it.

BEGIN;

ALTER TABLE intents ADD COLUMN IF NOT EXISTS request_body jsonb;

CREATE INDEX IF NOT EXISTS jobs_kurier_job_idx ON jobs (kurier_job_id);

COMMIT;
