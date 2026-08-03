BEGIN;

DROP INDEX IF EXISTS jobs_kurier_job_idx;

ALTER TABLE intents DROP COLUMN IF EXISTS request_body;

COMMIT;
