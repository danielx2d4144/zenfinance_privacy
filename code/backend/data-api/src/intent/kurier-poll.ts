import { createHash, randomBytes } from "node:crypto";

/**
 * Kurier-poll module — submit a proof, wait for aggregation, return the
 * receipt the on-chain `verifyAndConsume` consumer needs.
 *
 * Day-14b on Anvil: this is a **synthetic stub** that returns a
 * deterministic AggregationReceipt without touching Kurier. The receipt
 * has the same shape `submitAndWait` from prover-service returns, so the
 * handler call sites and `MockVerifyProofAggregation.setAllowed` agree
 * on the (domainId, aggregationId, leafIndex) tuple.
 *
 * Day 17 (testnet cut) replaces the body of `submitAndWait` here with
 * a call to the real prover-service KurierClient + pollUntilTerminal.
 * The exported signature does not change.
 */

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
}

/**
 * Build a deterministic AggregationReceipt for an Anvil-local handler.
 * The `aggregationId` is derived from the proof bytes so concurrent
 * submissions don't collide. `leafIndex=0`, `numberOfLeaves=1`,
 * empty `merkleProof` — the mock proxy ignores merkle path validity.
 */
export async function submitAndWait(args: SubmitArgs): Promise<AggregationReceipt> {
  const digest = createHash("sha256").update(args.proof).digest();

  const aggregationId = bytesToBigInt(digest.subarray(0, 8)).toString();
  const leafHex = `0x${digest.toString("hex")}` as `0x${string}`;
  const receiptHex = `0x${createHash("sha256")
    .update(`receipt:${aggregationId}`)
    .digest()
    .toString("hex")}` as `0x${string}`;

  return {
    jobId: `stub-${randomBytes(8).toString("hex")}`,
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
