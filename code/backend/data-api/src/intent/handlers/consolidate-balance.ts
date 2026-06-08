import type { Pool } from "pg";

import { updateIntentStatus, type IntentRow } from "../state.js";

/**
 * consolidate_balance has no contract surface in the Day-2 / Day-14b
 * release; the merge-fragments-into-one flow needs a pool-side method
 * that doesn't exist yet. Surfaces a clean deferral so the dapp's
 * status polling has a terminal state to read.
 *
 * Day 17 (note management) brings the consolidator pool method online.
 */
export async function handleConsolidateBalance(
  pool: Pool,
  intent: IntentRow,
): Promise<void> {
  await updateIntentStatus(
    pool,
    intent.id,
    "failed",
    "not_implemented_until_day17",
  );
}
