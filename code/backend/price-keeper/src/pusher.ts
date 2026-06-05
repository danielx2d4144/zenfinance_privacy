/**
 * Pushes a TemporalNumericValueInput[] batch to the Stork verifier on-chain,
 * paying the required fee via Stork.getUpdateFeeV1.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { log } from "./log.js";
import { getConfig } from "./config.js";
import type { TemporalNumericValueInput } from "./stork-rest.js";

const INPUT_TUPLE = {
  name: "updateData",
  type: "tuple[]",
  components: [
    {
      name: "temporalNumericValue",
      type: "tuple",
      components: [
        { name: "timestampNs", type: "uint64" },
        { name: "quantizedValue", type: "int192" },
      ],
    },
    { name: "id", type: "bytes32" },
    { name: "publisherMerkleRoot", type: "bytes32" },
    { name: "valueComputeAlgHash", type: "bytes32" },
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
    { name: "v", type: "uint8" },
  ],
} as const;

const STORK_ABI = [
  {
    type: "function",
    name: "updateTemporalNumericValuesV1",
    stateMutability: "payable",
    inputs: [INPUT_TUPLE],
    outputs: [],
  },
  {
    type: "function",
    name: "getUpdateFeeV1",
    stateMutability: "view",
    inputs: [INPUT_TUPLE],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTemporalNumericValueUnsafeV1",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "timestampNs", type: "uint64" },
          { name: "quantizedValue", type: "int192" },
        ],
      },
    ],
  },
] as const;

export interface PushResult {
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  feeWei: bigint;
}

function clients() {
  const cfg = getConfig();
  const account = privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(cfg.BASE_SEPOLIA_HTTPS);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
  return { publicClient, walletClient, account };
}

/**
 * Push a batch of updates to Stork. Computes the required fee, simulates,
 * sends, and waits for inclusion.
 */
export async function pushToStork(
  updates: TemporalNumericValueInput[],
): Promise<PushResult> {
  if (updates.length === 0) throw new Error("no updates to push");
  const cfg = getConfig();
  const stork = cfg.STORK_BASE_SEPOLIA as Address;
  const { publicClient, walletClient, account } = clients();

  const feeWei = (await publicClient.readContract({
    address: stork,
    abi: STORK_ABI,
    functionName: "getUpdateFeeV1",
    args: [updates],
  })) as bigint;

  log.info(
    {
      stork,
      count: updates.length,
      feeWei: feeWei.toString(),
      firstId: updates[0]?.id,
      firstTimestampNs: updates[0]?.temporalNumericValue.timestampNs.toString(),
    },
    "stork-push-prepared",
  );

  await publicClient.simulateContract({
    address: stork,
    abi: STORK_ABI,
    functionName: "updateTemporalNumericValuesV1",
    args: [updates],
    account,
    value: feeWei,
  });

  const txHash = await walletClient.writeContract({
    address: stork,
    abi: STORK_ABI,
    functionName: "updateTemporalNumericValuesV1",
    args: [updates],
    account,
    chain: baseSepolia,
    value: feeWei,
  });

  const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (r.status !== "success") {
    throw new Error(`stork updateTemporalNumericValuesV1 reverted (tx ${txHash})`);
  }
  return {
    txHash,
    blockNumber: r.blockNumber,
    gasUsed: r.gasUsed,
    feeWei,
  };
}

/** Read the latest stored value (for verification after push). */
export async function readStork(id: Hex): Promise<{ timestampNs: bigint; quantizedValue: bigint }> {
  const cfg = getConfig();
  const { publicClient } = clients();
  const v = (await publicClient.readContract({
    address: cfg.STORK_BASE_SEPOLIA as Address,
    abi: STORK_ABI,
    functionName: "getTemporalNumericValueUnsafeV1",
    args: [id],
  })) as { timestampNs: bigint; quantizedValue: bigint };
  return v;
}
