import type { Pool } from "pg";

/**
 * Idempotency-Key dedup, persisted via the idempotency_keys table from
 * Day-10 migrations. T-11.2 contract: the SAME key replayed within the
 * retention window MUST return the SAME `intent_id`.
 *
 * Day-11 keeps the response body verbatim — that's the simplest contract.
 * Future hardening: hash the request body alongside the key so a key
 * collision with a different body returns 409 (S13 §4.1 ‘Idempotency
 * collision’).
 */
export interface IdempotencyHit {
  intentId: string;
  responseBody: unknown;
  responseStatus: number;
}

export async function lookupIdempotency(
  pool: Pool,
  key: string,
): Promise<IdempotencyHit | null> {
  const r = await pool.query<{ intent_id: string; response_body: unknown; response_status: number }>(
    `SELECT intent_id, response_body, response_status FROM idempotency_keys WHERE id = $1`,
    [key],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    intentId: row.intent_id,
    responseBody: row.response_body,
    responseStatus: row.response_status,
  };
}

export async function recordIdempotency(
  pool: Pool,
  args: {
    key: string;
    intentId: string;
    responseBody: unknown;
    responseStatus: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_keys (id, intent_id, response_body, response_status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [args.key, args.intentId, args.responseBody, args.responseStatus],
  );
}
