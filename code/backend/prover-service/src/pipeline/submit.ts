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

/**
 * Submit one proof artifact for the named circuit, wait for aggregation, and
 * return the receipt that on-chain consumers feed to `IVerifyProofAggregation`.
 */
export async function submitAndWait(
  client: KurierClient,
  circuit: CircuitName,
  opts: SubmitOptions = {},
): Promise<AggregationReceipt> {
  const pinned = getCircuit(circuit);
  const vkRegistered = opts.vkRegistered ?? true;

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

  const vkField = vkRegistered
    ? await readKurierVkHash(circuit)
    : await readVkBytes(circuit);

  log.info(
    {
      circuit,
      pedersenVkHash: pinned.vkHash,
      vkRegistered,
      proofBytes: (proof.length - 2) / 2,
      publicSignals: publicSignals.length,
    },
    "kurier-submit",
  );

  const submitted = await client.submitProof({
    proofType: "ultrahonk",
    proofOptions: { variant: "ZK", version: "V3_0" },
    vkRegistered,
    ...(opts.chainId !== undefined ? { chainId: opts.chainId } : {}),
    proofData: { proof, publicSignals, vk: vkField },
  });

  const terminal = await pollUntilTerminal(client, submitted.jobId, opts.poll ?? defaultPoll);
  if (terminal.kind !== "succeeded") {
    throw new Error(
      `Kurier job ${submitted.jobId} ended in ${terminal.kind} (status=${terminal.status})` +
        (terminal.kind === "failed" && terminal.error ? `: ${terminal.error}` : ""),
    );
  }

  return {
    jobId: submitted.jobId,
    circuit,
    status: terminal.status,
    aggregationId: terminal.aggregationId,
    details: terminal.details,
  };
}
