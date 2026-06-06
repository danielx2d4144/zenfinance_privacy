import type { Pool } from "pg";

import { updateIntentStatus, type IntentRow } from "../state.js";
import { NOT_IMPLEMENTED_UNTIL } from "../schemas.js";

/**
 * Generic handler for the 9 intent kinds that aren't wired against on-chain
 * contracts yet. Transitions the intent to `failed` immediately with a
 * structured reason. Clients see a clean lifecycle: received -> failed,
 * `failure_reason = not_implemented_until_dayN`.
 */
export async function handleStubbedIntent(pool: Pool, intent: IntentRow): Promise<void> {
  const kind = intent.kind as keyof typeof NOT_IMPLEMENTED_UNTIL;
  const day = NOT_IMPLEMENTED_UNTIL[kind];
  await updateIntentStatus(
    pool,
    intent.id,
    "failed",
    `not_implemented_until_day${day}`,
  );
}
