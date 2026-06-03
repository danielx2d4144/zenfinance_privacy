import { log } from "../log.js";
import { KurierClient } from "../kurier/client.js";
import { sleep } from "../kurier/retry.js";
import {
  InProgressStatus,
  TerminalStatus,
  type JobStatusResponse,
} from "../kurier/schemas.js";
import type { JobState } from "./types.js";

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
  /** Called on every status change; useful for tests and CLI progress. */
  onTransition?: (prev: JobState | null, next: JobState) => void;
}

export const defaultPoll: PollOptions = {
  intervalMs: 5_000,
  timeoutMs: 20 * 60_000,
};

const KNOWN_IN_PROGRESS = new Set<string>(Object.values(InProgressStatus));
const KNOWN_TERMINAL = new Set<string>(Object.values(TerminalStatus));

export function classify(res: JobStatusResponse): JobState {
  const status = res.status;
  if (
    status === TerminalStatus.Aggregated ||
    status === TerminalStatus.AggregationPublished
  ) {
    if (!res.aggregationDetails || res.aggregationId == null) {
      // Defensive: server may briefly report Aggregated with partial fields.
      // Treat as in-progress so the poller waits one more tick.
      return { kind: "in-progress", status };
    }
    return {
      kind: "succeeded",
      status,
      aggregationId: res.aggregationId,
      details: res.aggregationDetails,
    };
  }
  if (status === TerminalStatus.Failed) {
    return { kind: "failed", status, error: res.error ?? undefined };
  }
  if (!KNOWN_IN_PROGRESS.has(status) && !KNOWN_TERMINAL.has(status)) {
    log.warn({ status }, "kurier-unknown-status");
  }
  return { kind: "in-progress", status };
}

export async function pollUntilTerminal(
  client: KurierClient,
  jobId: string,
  opts: PollOptions = defaultPoll,
): Promise<JobState> {
  const deadline = Date.now() + opts.timeoutMs;
  let prev: JobState | null = null;

  while (Date.now() < deadline) {
    const res = await client.getJobStatus(jobId);
    const next = classify(res);

    if (prev === null || prev.status !== next.status) {
      opts.onTransition?.(prev, next);
      log.info({ jobId, status: next.status, kind: next.kind }, "kurier-status");
      prev = next;
    }

    if (next.kind !== "in-progress") return next;
    await sleep(opts.intervalMs);
  }

  return {
    kind: "failed",
    status: prev?.status ?? "unknown",
    error: `poll deadline exceeded after ${opts.timeoutMs}ms`,
  };
}
