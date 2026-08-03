/**
 * Kurier-poll module — submit a proof, wait for aggregation, return the
 * receipt the on-chain `verifyAndConsume` consumer needs.
 *
 * Two modes, selected by `ATTESTATION_MODE`:
 *
 *   kurier — the real path (M3). Proof bytes go to Horizen Labs' Kurier
 *            relayer, zkVerify aggregates them, the publisher posts the root
 *            to the destination chain's proxy, and the merkle witness that
 *            comes back is what the pool verifies. Measured 2m 54s to
 *            `Aggregated` on Horizen testnet.
 *
 *   mock   — Anvil only. A deterministic synthetic receipt, paired with
 *            `setAllowed` on `MockVerifyProofAggregation`. **No cryptography
 *            runs.** Kept because there is no real aggregation domain
 *            targeting chain 31337, so local dev has nothing to aggregate
 *            against.
 *
 * The receipt shape is identical either way — the stub was written to match
 * Kurier's — so all eight handlers are unaffected by the mode.
 */

import { createHash, randomBytes } from "node:crypto";

import {
  KurierClient,
  submitProofAndWait,
  waitForAggregation,
  type AggregationReceipt as KurierAggregationReceipt,
  type CircuitName as KurierCircuitName,
  type PollOptions,
} from "@lending/prover-service";

import { getConfig } from "../config.js";
import type { CircuitName } from "./vk-registry.js";

export interface AggregationDetails {
  receipt: `0x${string}`;
  receiptBlockHash: `0x${string}`;
  root: `0x${string}`;
  leaf: `0x${string}`;
  leafIndex: number;
  numberOfLeaves: number;
  merkleProof: `0x${string}`[];
}

export interface AggregationReceipt {
  jobId: string;
  circuit: CircuitName;
  status: string;
  aggregationId: string | number;
  details: AggregationDetails;
}

export interface SubmitArgs {
  circuit: CircuitName;
  proof: `0x${string}`;
  publicInputs: string[];
  /**
   * Invoked with the Kurier job id the instant it exists, before the first
   * poll. Callers persist it here so a process restart mid-aggregation can
   * re-attach with `resumeAggregation` instead of stranding the intent.
   */
  onSubmitted?: (jobId: string) => void | Promise<void>;
}

let client: KurierClient | null = null;

function getKurierClient(): KurierClient {
  if (client) return client;
  const cfg = getConfig();
  // Both options passed explicitly: that is the constructor path that skips
  // prover-service's own `getConfig()`, so the data-API never has to satisfy
  // prover-service's env schema (Volta WSS urls, Base Sepolia addresses, …).
  client = new KurierClient({
    baseUrl: cfg.KURIER_BASE_URL,
    apiKey: cfg.KURIER_API_KEY!,
  });
  return client;
}

function pollOptions(): PollOptions {
  const cfg = getConfig();
  return {
    intervalMs: cfg.KURIER_POLL_INTERVAL_MS,
    timeoutMs: cfg.KURIER_POLL_TIMEOUT_MS,
  };
}

export async function submitAndWait(args: SubmitArgs): Promise<AggregationReceipt> {
  const cfg = getConfig();
  if (cfg.ATTESTATION_MODE === "mock") return syntheticReceipt(args);

  const receipt = await submitProofAndWait(getKurierClient(), {
    circuit: args.circuit as KurierCircuitName,
    proof: args.proof,
    publicSignals: args.publicInputs,
    chainId: cfg.CHAIN_ID,
    poll: pollOptions(),
    ...(args.onSubmitted ? { onSubmitted: args.onSubmitted } : {}),
  });
  return narrow(receipt, args.circuit);
}

/**
 * Re-attach to a Kurier job that was submitted before a restart.
 *
 * Aggregation takes minutes and outlives any single process, so the job id is
 * persisted at submit time. Resuming costs one poll; re-submitting would cost
 * a second aggregation slot and produce a receipt whose leaf the first attempt
 * may already have consumed.
 */
export async function resumeAggregation(
  circuit: CircuitName,
  jobId: string,
): Promise<AggregationReceipt> {
  const cfg = getConfig();
  if (cfg.ATTESTATION_MODE === "mock") {
    throw new Error(
      `cannot resume Kurier job ${jobId} in mock mode — synthetic receipts are not persisted`,
    );
  }
  const receipt = await waitForAggregation(getKurierClient(), circuit, jobId, pollOptions());
  return narrow(receipt, circuit);
}

/**
 * prover-service types the hex fields as plain `string` (they come out of a
 * Zod regex, which can't produce a template-literal type). Everything
 * downstream is viem, which wants `0x${string}`. The regex already guarantees
 * the shape, so this is a widening-to-narrowing cast, not a claim.
 */
function narrow(r: KurierAggregationReceipt, circuit: CircuitName): AggregationReceipt {
  return {
    jobId: r.jobId,
    circuit,
    status: r.status,
    aggregationId: r.aggregationId,
    details: r.details as unknown as AggregationDetails,
  };
}

/**
 * Build a deterministic AggregationReceipt for an Anvil-local handler.
 * The `aggregationId` is derived from the proof bytes so concurrent
 * submissions don't collide. `leafIndex=0`, `numberOfLeaves=1`,
 * empty `merkleProof` — the mock proxy ignores merkle path validity.
 */
async function syntheticReceipt(args: SubmitArgs): Promise<AggregationReceipt> {
  const digest = createHash("sha256").update(args.proof).digest();

  const aggregationId = bytesToBigInt(digest.subarray(0, 8)).toString();
  const leafHex = `0x${digest.toString("hex")}` as `0x${string}`;
  const receiptHex = `0x${createHash("sha256")
    .update(`receipt:${aggregationId}`)
    .digest()
    .toString("hex")}` as `0x${string}`;

  const jobId = `stub-${randomBytes(8).toString("hex")}`;
  await args.onSubmitted?.(jobId);

  return {
    jobId,
    circuit: args.circuit,
    status: "Aggregated",
    aggregationId,
    details: {
      receipt: receiptHex,
      receiptBlockHash: receiptHex,
      root: receiptHex,
      leaf: leafHex,
      leafIndex: 0,
      numberOfLeaves: 1,
      merkleProof: [],
    },
  };
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}
