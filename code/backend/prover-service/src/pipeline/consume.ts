/**
 * On-chain attestation consumer.
 *
 * Calls `ZkVerifier.verifyAndConsume` on Base Sepolia with the aggregation
 * tuple returned by `submitAndWait`. On success, emits `ProofConsumed`.
 *
 * This is the third hop in the Day-8 pipeline:
 *   Kurier `Aggregated` receipt → IVerifyProofAggregation.verifyProofAggregation
 *                                → ZkVerifier.verifyAndConsume (this module)
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { log } from "../log.js";
import { getConfig } from "../config.js";
import { CIRCUITS, type CircuitName } from "../circuits/registry.js";
import type { AggregationReceipt } from "./types.js";

const ZK_VERIFIER_ABI = [
  {
    type: "function",
    name: "verifyAndConsume",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circuitId", type: "uint8" },
      { name: "expectedVkHash", type: "bytes32" },
      {
        name: "proof",
        type: "tuple",
        components: [
          { name: "domainId", type: "uint256" },
          { name: "aggregationId", type: "uint256" },
          { name: "leaf", type: "bytes32" },
          { name: "merklePath", type: "bytes32[]" },
          { name: "leafCount", type: "uint256" },
          { name: "leafIndex", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "ProofConsumed",
    inputs: [
      { name: "circuitId", type: "uint8", indexed: true },
      { name: "domainId", type: "uint256", indexed: true },
      { name: "aggregationId", type: "uint256", indexed: true },
      { name: "leafIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

export interface ConsumeOptions {
  /** Override domain id; otherwise pulled from ZKVERIFY_TESTNET_DOMAIN_ID env. */
  domainId?: bigint;
  /** Override ZkVerifier address; otherwise pulled from ZKVERIFIER_BASE_SEPOLIA env. */
  contractAddress?: Address;
}

export interface ConsumeResult {
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  circuitId: number;
  domainId: bigint;
  aggregationId: bigint;
  leafIndex: bigint;
}

function getCircuitId(name: CircuitName): number {
  const c = CIRCUITS.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown circuit: ${name}`);
  return c.id;
}

function getViemClients() {
  const cfg = getConfig();
  const account = privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(cfg.BASE_SEPOLIA_HTTPS);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
  return { publicClient, walletClient, account };
}

/**
 * Submit `verifyAndConsume` for an aggregation receipt and wait for inclusion.
 * Throws if the tx reverts, the proof is not in the aggregation, or the
 * ProofConsumed event is missing from the receipt.
 */
export async function consumeOnChain(
  receipt: AggregationReceipt,
  opts: ConsumeOptions = {},
): Promise<ConsumeResult> {
  const cfg = getConfig();
  const contractAddress =
    opts.contractAddress ?? (cfg.ZKVERIFIER_BASE_SEPOLIA as Address);
  if (!contractAddress) {
    throw new Error(
      "ZKVERIFIER_BASE_SEPOLIA is not set in .env — run DeployZkVerifier first.",
    );
  }
  const domainId = opts.domainId ?? BigInt(cfg.ZKVERIFY_TESTNET_DOMAIN_ID);

  const circuitId = getCircuitId(receipt.circuit as CircuitName);
  const pinned = CIRCUITS[circuitId];
  if (!pinned) throw new Error(`Circuit id ${circuitId} out of range`);
  const aggregationId = BigInt(receipt.aggregationId);
  const leafCount = BigInt(receipt.details.numberOfLeaves);
  const leafIndex = BigInt(receipt.details.leafIndex);

  const { publicClient, walletClient, account } = getViemClients();

  const args = [
    circuitId,
    pinned.vkHash as Hex,
    {
      domainId,
      aggregationId,
      leaf: receipt.details.leaf as Hex,
      merklePath: receipt.details.merkleProof as Hex[],
      leafCount,
      leafIndex,
    },
  ] as const;

  log.info(
    {
      contractAddress,
      circuit: receipt.circuit,
      circuitId,
      domainId: domainId.toString(),
      aggregationId: aggregationId.toString(),
      leafCount: leafCount.toString(),
      leafIndex: leafIndex.toString(),
      merklePathDepth: receipt.details.merkleProof.length,
    },
    "consume-prepared",
  );

  // Simulate first — catches revert reasons (e.g. NotInAggregation,
  // VkHashMismatch, AlreadyConsumed) without spending gas.
  await publicClient.simulateContract({
    address: contractAddress,
    abi: ZK_VERIFIER_ABI,
    functionName: "verifyAndConsume",
    args,
    account,
  });

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: ZK_VERIFIER_ABI,
    functionName: "verifyAndConsume",
    args,
    account,
    chain: baseSepolia,
  });

  log.info({ txHash }, "consume-tx-sent");

  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (txReceipt.status !== "success") {
    throw new Error(`verifyAndConsume reverted (txHash=${txHash})`);
  }

  let event:
    | { circuitId: number; domainId: bigint; aggregationId: bigint; leafIndex: bigint }
    | undefined;

  for (const lg of txReceipt.logs) {
    if (lg.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: ZK_VERIFIER_ABI,
        data: lg.data,
        topics: lg.topics,
      });
      if (decoded.eventName === "ProofConsumed") {
        event = {
          circuitId: Number(decoded.args.circuitId),
          domainId: decoded.args.domainId,
          aggregationId: decoded.args.aggregationId,
          leafIndex: decoded.args.leafIndex,
        };
        break;
      }
    } catch {
      // Not a ZkVerifier event; skip.
    }
  }

  if (!event) {
    throw new Error(
      `verifyAndConsume tx ${txHash} succeeded but did not emit ProofConsumed`,
    );
  }

  return {
    txHash,
    blockNumber: txReceipt.blockNumber,
    gasUsed: txReceipt.gasUsed,
    ...event,
  };
}
