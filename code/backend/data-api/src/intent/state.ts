import type { Pool } from "pg";

/**
 * Intent lifecycle states. Mirror of S13 §3; we use the migration's
 * `intent_status` enum verbatim.
 */
export const INTENT_STATUSES = [
  "received",
  "proving",
  "submitted",
  "aggregated",
  "userop_pending",
  "confirmed",
  "failed",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/**
 * Statuses a restart can legitimately resume from: the intent was accepted but
 * never reached a terminal state. `received` is included because the crash may
 * have landed between the INSERT and the first status update.
 */
export const RESUMABLE_STATUSES = [
  "received",
  "proving",
  "submitted",
  "aggregated",
  "userop_pending",
] as const satisfies readonly IntentStatus[];

export interface IntentRow {
  id: string;
  account_address: Buffer;
  kind: string;
  asset_id: number;
  amount: string | null;
  status: IntentStatus;
  failure_reason: string | null;
  /** The original POST body, kept so a restart can rebuild the pool call. */
  request_body: unknown;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  intent_id: string;
  kurier_job_id: string | null;
  bundler_user_op: string | null;
  tx_hash: Buffer | null;
  status_payload: unknown;
  created_at: string;
  updated_at: string;
}

export async function insertIntent(
  pool: Pool,
  args: {
    /** Optional pre-generated UUID so the idempotency claim and the intent
     *  row can share an identity created before the handler kicks off. */
    id?: string;
    accountAddress: Buffer;
    kind: string;
    assetId: number;
    amount: string | null;
    /** Verbatim POST body; replayed by the boot sweep to resume the handler. */
    requestBody?: unknown;
  },
): Promise<IntentRow> {
  const body = args.requestBody === undefined ? null : JSON.stringify(args.requestBody);
  if (args.id) {
    const r = await pool.query<IntentRow>(
      `INSERT INTO intents (id, account_address, kind, asset_id, amount, status, request_body)
       VALUES ($1, $2, $3, $4, $5, 'received', $6)
       RETURNING *`,
      [args.id, args.accountAddress, args.kind, args.assetId, args.amount, body],
    );
    return r.rows[0]!;
  }
  const r = await pool.query<IntentRow>(
    `INSERT INTO intents (account_address, kind, asset_id, amount, status, request_body)
     VALUES ($1, $2, $3, $4, 'received', $5)
     RETURNING *`,
    [args.accountAddress, args.kind, args.assetId, args.amount, body],
  );
  return r.rows[0]!;
}

export async function updateIntentStatus(
  pool: Pool,
  intentId: string,
  status: IntentStatus,
  failureReason?: string,
): Promise<void> {
  await pool.query(
    `UPDATE intents SET status = $2, failure_reason = $3 WHERE id = $1`,
    [intentId, status, failureReason ?? null],
  );
}

export async function getIntent(pool: Pool, intentId: string): Promise<IntentRow | null> {
  const r = await pool.query<IntentRow>(`SELECT * FROM intents WHERE id = $1`, [intentId]);
  return r.rows[0] ?? null;
}

/**
 * Attach the settled transaction to the intent's job row.
 *
 * Prefers the row `recordKurierJobId` already created, so one intent maps to
 * one job carrying both the Kurier id and the tx hash. Falls back to an insert
 * for paths with no Kurier leg (entry_deposit, mock mode without a job row).
 */
export async function insertJobWithTx(
  pool: Pool,
  intentId: string,
  txHash: Buffer,
  payload: unknown,
): Promise<JobRow> {
  const updated = await pool.query<JobRow>(
    `UPDATE jobs SET tx_hash = $2, status_payload = $3
     WHERE id = (
       SELECT id FROM jobs
       WHERE intent_id = $1 AND tx_hash IS NULL
       ORDER BY created_at ASC LIMIT 1
     )
     RETURNING *`,
    [intentId, txHash, payload],
  );
  if (updated.rows[0]) return updated.rows[0];

  const r = await pool.query<JobRow>(
    `INSERT INTO jobs (intent_id, tx_hash, status_payload)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [intentId, txHash, payload],
  );
  return r.rows[0]!;
}

/**
 * Record the Kurier job id for an intent the moment Kurier issues it.
 *
 * Written before the first poll, not after aggregation: the whole point is to
 * survive a crash *during* the wait. Upserts on `intent_id` so a resumed
 * handler that somehow re-submits doesn't leave two rows claiming the intent.
 */
export async function recordKurierJobId(
  pool: Pool,
  intentId: string,
  kurierJobId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO jobs (intent_id, kurier_job_id)
     SELECT $1, $2
     WHERE NOT EXISTS (
       SELECT 1 FROM jobs WHERE intent_id = $1 AND kurier_job_id IS NOT NULL
     )`,
    [intentId, kurierJobId],
  );
}

export async function getKurierJobId(pool: Pool, intentId: string): Promise<string | null> {
  const r = await pool.query<{ kurier_job_id: string }>(
    `SELECT kurier_job_id FROM jobs
     WHERE intent_id = $1 AND kurier_job_id IS NOT NULL
     ORDER BY created_at ASC LIMIT 1`,
    [intentId],
  );
  return r.rows[0]?.kurier_job_id ?? null;
}

/**
 * Intents that were accepted but never reached a terminal state — the boot
 * sweep's work list. Ordered oldest-first so the longest-stranded user is
 * served first.
 */
export async function getResumableIntents(pool: Pool): Promise<IntentRow[]> {
  const r = await pool.query<IntentRow>(
    `SELECT * FROM intents
     WHERE status = ANY($1::intent_status[])
     ORDER BY created_at ASC`,
    [RESUMABLE_STATUSES as unknown as string[]],
  );
  return r.rows;
}

export async function getJobsForIntent(pool: Pool, intentId: string): Promise<JobRow[]> {
  const r = await pool.query<JobRow>(
    `SELECT * FROM jobs WHERE intent_id = $1 ORDER BY created_at ASC`,
    [intentId],
  );
  return r.rows;
}
