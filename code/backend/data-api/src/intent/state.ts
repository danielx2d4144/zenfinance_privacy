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

export interface IntentRow {
  id: string;
  account_address: Buffer;
  kind: string;
  asset_id: number;
  amount: string | null;
  status: IntentStatus;
  failure_reason: string | null;
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
  },
): Promise<IntentRow> {
  if (args.id) {
    const r = await pool.query<IntentRow>(
      `INSERT INTO intents (id, account_address, kind, asset_id, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'received')
       RETURNING *`,
      [args.id, args.accountAddress, args.kind, args.assetId, args.amount],
    );
    return r.rows[0]!;
  }
  const r = await pool.query<IntentRow>(
    `INSERT INTO intents (account_address, kind, asset_id, amount, status)
     VALUES ($1, $2, $3, $4, 'received')
     RETURNING *`,
    [args.accountAddress, args.kind, args.assetId, args.amount],
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

export async function insertJobWithTx(
  pool: Pool,
  intentId: string,
  txHash: Buffer,
  payload: unknown,
): Promise<JobRow> {
  const r = await pool.query<JobRow>(
    `INSERT INTO jobs (intent_id, tx_hash, status_payload)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [intentId, txHash, payload],
  );
  return r.rows[0]!;
}

export async function getJobsForIntent(pool: Pool, intentId: string): Promise<JobRow[]> {
  const r = await pool.query<JobRow>(
    `SELECT * FROM jobs WHERE intent_id = $1 ORDER BY created_at ASC`,
    [intentId],
  );
  return r.rows;
}
