/**
 * Public surface of `@lending/prover-service`, consumed by `@lending/data-api`
 * over a `file:` dependency.
 *
 * Only the Kurier attestation pipeline is exported. Everything that touches
 * the local filesystem (`vk-loader`, the `scripts/` CLIs) or this package's own
 * `.env` (`config.ts`) stays internal — the deployed data-API container has
 * neither a `code/circuits/` tree nor a prover-service `.env`, so importing
 * those would only produce confusing runtime failures. `KurierClient` is
 * constructed with an explicit `{baseUrl, apiKey}` there, which is exactly the
 * path that skips `getConfig()`.
 */
export { KurierClient, type KurierClientOptions } from "./kurier/client.js";
export {
  KurierError,
  KurierJobFailed,
  KurierRateLimited,
  KurierResponseShapeError,
  KurierVkNotRegistered,
} from "./kurier/errors.js";
export {
  InProgressStatus,
  TerminalStatus,
  type AggregationDetails,
  type JobStatusResponse,
} from "./kurier/schemas.js";
export { defaultRetry, type RetryOptions } from "./kurier/retry.js";

export {
  submitProofAndWait,
  waitForAggregation,
  type SubmitOptions,
  type SubmitProofArgs,
} from "./pipeline/submit.js";
export {
  classify,
  defaultPoll,
  pollUntilTerminal,
  type PollOptions,
} from "./pipeline/poll.js";
export type { AggregationReceipt, JobState } from "./pipeline/types.js";

export { CIRCUITS, getCircuit, type CircuitName } from "./circuits/registry.js";
export { KURIER_VK_HASHES } from "./circuits/kurier-vk-hashes.js";
