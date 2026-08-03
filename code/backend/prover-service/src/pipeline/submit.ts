import { log } from "../log.js";
import { KurierClient } from "../kurier/client.js";
import { getCircuit, type CircuitName } from "../circuits/registry.js";
import {
  readPinnedVkHash,
  readProofBytes,
  readPublicSignals,
  readVkBytes,
} from "../circuits/vk-loader.js";
import { readKurierVkHash } from "../circuits/kurier-vk-store.js";
import { defaultPoll, pollUntilTerminal, type PollOptions } from "./poll.js";
import type { AggregationReceipt } from "./types.js";

export interface SubmitOptions {
  /**
   * If true (default), Kurier expects a pre-registered vk and the request's
   * `proofData.vk` field carries the Kurier-side vkHash (loaded from
   * `<circuit>/target/kurier_vk_hash`, written by `register-all-vks`).
   *
   * If false, Kurier will register the vk inline; `proofData.vk` becomes the
   * raw vk bytes. Slower per call; useful only for one-off testing.
   */
  vkRegistered?: boolean;
  chainId?: number;
  poll?: PollOptions;
}

export interface SubmitProofArgs extends SubmitOptions {
  circuit: CircuitName;
  /** 0x-prefixed UltraHonk proof bytes. */
  proof: `0x${string}`;
  /** 0x-prefixed field elements, in circuit order. */
  publicSignals: string[];
  /**
   * Called with the Kurier job id the moment it is known, before polling
   * starts. Callers that must survive a restart persist it here — without it
   * a crash mid-aggregation orphans a job that is still being aggregated.
   */
  onSubmitted?: (jobId: string) => void | Promise<void>;
}

/**
 * Submit proof bytes for the named circuit, wait for aggregation, and return
 * the receipt that on-chain consumers feed to `IVerifyProofAggregation`.
 *
 * This is the shape a server wants: the dapp posts proof bytes over HTTP, so
 * there is no artifact on disk to read. The disk-reading `submitAndWait`
 * below is a thin wrapper for the CLI scripts.
 */
export async function submitProofAndWait(
  client: KurierClient,
  args: SubmitProofArgs,
): Promise<AggregationReceipt> {
  const { circuit, proof, publicSignals } = args;
  const vkRegistered = args.vkRegistered ?? true;

  const vkField = vkRegistered
    ? await readKurierVkHash(circuit)
    : await readVkBytes(circuit);

  log.info(
    {
      circuit,
      vkRegistered,
      chainId: args.chainId,
      proofBytes: (proof.length - 2) / 2,
      publicSignals: publicSignals.length,
    },
    "kurier-submit",
  );

  const submitted = await client.submitProof({
    proofType: "ultrahonk",
    proofOptions: { variant: "ZK", version: "V3_0" },
    vkRegistered,
    ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
    proofData: { proof, publicSignals, vk: vkField },
  });

  await args.onSubmitted?.(submitted.jobId);

  return waitForAggregation(client, circuit, submitted.jobId, args.poll);
}

/**
 * Poll an already-submitted Kurier job to a terminal state.
 *
 * Split out of `submitProofAndWait` so a process that restarts mid-flight can
 * re-attach to a persisted jobId instead of paying for the proof twice.
 */
export async function waitForAggregation(
  client: KurierClient,
  circuit: CircuitName | string,
  jobId: string,
  poll: PollOptions = defaultPoll,
): Promise<AggregationReceipt> {
  const terminal = await pollUntilTerminal(client, jobId, poll);
  if (terminal.kind !== "succeeded") {
    throw new Error(
      `Kurier job ${jobId} ended in ${terminal.kind} (status=${terminal.status})` +
        (terminal.kind === "failed" && terminal.error ? `: ${terminal.error}` : ""),
    );
  }

  return {
    jobId,
    circuit,
    status: terminal.status,
    aggregationId: terminal.aggregationId,
    details: terminal.details,
  };
}

/**
 * Submit one proof **artifact** for the named circuit — the CLI shape, used by
 * `scripts/e2e.ts`, `scripts/smoke-submit.ts` and the Horizen probe. Reads the
 * proof off disk and delegates to `submitProofAndWait`.
 */
export async function submitAndWait(
  client: KurierClient,
  circuit: CircuitName,
  opts: SubmitOptions = {},
): Promise<AggregationReceipt> {
  const pinned = getCircuit(circuit);

  const [proof, publicSignals, onDiskPedersen] = await Promise.all([
    readProofBytes(circuit),
    readPublicSignals(circuit),
    readPinnedVkHash(circuit),
  ]);

  if (onDiskPedersen.toLowerCase() !== pinned.vkHash.toLowerCase()) {
    throw new Error(
      `Pedersen vkHash drift for ${circuit}: registry=${pinned.vkHash} disk=${onDiskPedersen}. ` +
        `Rebuild the circuit and re-pin in VkRegistry.sol before submitting proofs.`,
    );
  }

  return submitProofAndWait(client, { ...opts, circuit, proof, publicSignals });
}
