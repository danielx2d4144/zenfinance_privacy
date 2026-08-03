/**
 * Boot sweep — pick up intents that a previous process left in flight.
 *
 * Why this exists: `POST /v1/intents` responds 202 and runs the handler
 * fire-and-forget in memory. On Anvil that gap was milliseconds. Against real
 * Kurier the handler sits in `pollUntilTerminal` for minutes, which is longer
 * than a deploy, an OOM kill or a container restart. Without a sweep the
 * intent stays `proving` forever while zkVerify goes on to aggregate and
 * publish the proof — the work succeeded, the user is told nothing.
 *
 * The sweep replays each stranded intent's stored request body through the
 * normal handler. Inside, `verifyAndCall` finds the persisted Kurier job id
 * and re-attaches to that job instead of submitting a second proof, so
 * resuming is a poll, not a re-run. See `attest()` in
 * `handlers/verify-and-call.ts` for why re-submitting would be actively wrong.
 */
import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";

import { AnyIntent } from "./schemas.js";
import { getResumableIntents, updateIntentStatus } from "./state.js";
import { runHandler } from "../routes/intents.js";

export interface SweepResult {
  resumed: number;
  abandoned: number;
}

export async function resumeInFlightIntents(
  pool: Pool,
  logger: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
): Promise<SweepResult> {
  const stranded = await getResumableIntents(pool);
  if (stranded.length === 0) return { resumed: 0, abandoned: 0 };

  logger.info({ count: stranded.length }, "intent-resume-sweep-start");

  let resumed = 0;
  let abandoned = 0;

  for (const intent of stranded) {
    // Intents created before the request_body column existed, or written by a
    // path that didn't store one, cannot be rebuilt. Fail them loudly rather
    // than leaving them pending forever — a visible failure is recoverable by
    // the user, a permanent `proving` is not.
    const parsed = AnyIntent.safeParse(intent.request_body);
    if (!parsed.success) {
      abandoned += 1;
      logger.warn({ intentId: intent.id, kind: intent.kind }, "intent-resume-unreplayable");
      await updateIntentStatus(
        pool,
        intent.id,
        "failed",
        "interrupted by a server restart and could not be replayed (no stored request body)",
      );
      continue;
    }

    resumed += 1;
    logger.info({ intentId: intent.id, status: intent.status }, "intent-resume");
    // Same fire-and-forget shape as the POST route: the sweep must not block
    // the server from accepting traffic while minutes of aggregation replay.
    void runHandler(parsed.data, intent.id).catch((err) => {
      logger.error({ err, intentId: intent.id }, "intent-resume-crash");
    });
  }

  logger.info({ resumed, abandoned }, "intent-resume-sweep-done");
  return { resumed, abandoned };
}
