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

/**
 * Atomically claim an Idempotency-Key. Returns `intentId === proposedIntentId`
 * if we won and the caller should create the intent + dispatch the handler,
 * or the OTHER winner's intent id (with their cached response, if any) if we
 * lost the race. The single SQL statement is race-free thanks to the primary
 * key uniqueness on idempotency_keys.id.
 */
export async function claimIdempotency(
  pool: Pool,
  args: {
    key: string;
    proposedIntentId: string;
    pendingBody: unknown;
    pendingStatus: number;
  },
): Promise<{ wonClaim: boolean; intentId: string; cached: IdempotencyHit | null }> {
  const ins = await pool.query<{ intent_id: string }>(
    `INSERT INTO idempotency_keys (id, intent_id, response_body, response_status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING intent_id`,
    [args.key, args.proposedIntentId, args.pendingBody, args.pendingStatus],
  );
  if (ins.rows[0]) {
    return { wonClaim: true, intentId: args.proposedIntentId, cached: null };
  }
  const cached = await lookupIdempotency(pool, args.key);
  if (!cached) {
    // The conflicting row vanished between insert and lookup — shouldn't
    // happen since we never delete keys, but treat as a bizarre race.
    return { wonClaim: false, intentId: args.proposedIntentId, cached: null };
  }
  return { wonClaim: false, intentId: cached.intentId, cached };
}

/** Update the cached body for an existing idempotency claim (winner only). */
export async function persistIdempotencyBody(
  pool: Pool,
  key: string,
  body: unknown,
  status: number,
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET response_body = $2, response_status = $3 WHERE id = $1`,
    [key, body, status],
  );
}
