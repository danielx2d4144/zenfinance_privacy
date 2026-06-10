// Stage E.3 -- chain-state reader for the witness builders.
//
// At prove time the lending circuits need 24 Field-element public
// inputs split across three 8-element arrays (one slot per asset
// index in `lib_common::MAX_ASSETS`):
//
//   current_prices[i]          -- Oracle.getPrice(i),     scaled 1e8
//   current_borrow_indices[i]  -- RateModel.state(i).borrowIndex
//   current_supply_indices[i]  -- RateModel.state(i).supplyIndex
//   ltv_bps[i]                 -- AssetRegistry.assets(i).ltvBps
//   lt_bps[i]                  -- AssetRegistry.assets(i).liquidationThresholdBps
//
// The contract emits the same values via the public-inputs check on
// each verifier; using viem.multicall ensures we read every slot
// atomically against a single block so a mid-prove accrual can't
// silently desync circuit witness vs on-chain verifier state.
//
// Slots for disabled / not-yet-registered assets are zero-padded so
// the circuit's loops over [0..MAX_ASSETS] hash deterministic
// Field elements regardless of how many real assets the registry
// currently exposes.

import { createPublicClient, http, type Address, type Hex } from "viem";
import { defineChain } from "viem";

export const MAX_ASSETS = 8;

export interface ChainSnapshot {
  /** Block the snapshot was read at (for the relayer's `accrue` race). */
  block: bigint;
  /** Field-element price (USD scaled 1e8) per asset slot. */
  prices: bigint[];
  /** Field-element borrow-index (ray-scaled 1e27) per asset slot. */
  borrowIndices: bigint[];
  /** Field-element supply-index (ray-scaled 1e27) per asset slot. */
  supplyIndices: bigint[];
  /** Field-element LTV (basis points) per asset slot. */
  ltvBps: bigint[];
  /** Field-element liquidation-threshold (basis points) per asset slot. */
  ltBps: bigint[];
  /** Number of registered assets (registry.numAssets). */
  numAssets: number;
}

const RPC_URL =
  process.env.NEXT_PUBLIC_ANVIL_RPC ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? 31337);

const anvilLocal = defineChain({
  id: CHAIN_ID,
  name: "Anvil Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const ORACLE = process.env.NEXT_PUBLIC_ANVIL_ORACLE as Address | undefined;
const RATE_MODEL = process.env.NEXT_PUBLIC_ANVIL_RATE_MODEL as Address | undefined;
const ASSET_REGISTRY =
  process.env.NEXT_PUBLIC_ANVIL_ASSET_REGISTRY as Address | undefined;

const oracleAbi = [
  {
    type: "function",
    name: "getPrice",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [{ type: "uint128" }],
  },
] as const;

const rateModelAbi = [
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalSupply", type: "uint128" },
          { name: "totalBorrow", type: "uint128" },
          { name: "supplyIndex", type: "uint128" },
          { name: "borrowIndex", type: "uint128" },
          { name: "lastAccrualTimestamp", type: "uint64" },
          { name: "paused", type: "bool" },
          { name: "deficit", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const assetRegistryAbi = [
  {
    type: "function",
    name: "numAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "oracleFeed", type: "address" },
          { name: "decimals", type: "uint8" },
          { name: "ltvBps", type: "uint16" },
          { name: "liquidationThresholdBps", type: "uint16" },
          { name: "liquidationBonusBps", type: "uint16" },
          { name: "protocolFeeOfBonusBps", type: "uint16" },
          { name: "reserveFactorBps", type: "uint16" },
          { name: "closeFactorHfThresholdBps", type: "uint16" },
          { name: "minBorrowSize", type: "uint128" },
          { name: "dustDebtThreshold", type: "uint128" },
          { name: "suppliable", type: "bool" },
          { name: "borrowable", type: "bool" },
          { name: "collateralizable", type: "bool" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isEnabled",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [{ type: "bool" }],
  },
] as const;

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  cachedClient = createPublicClient({
    chain: anvilLocal,
    transport: http(RPC_URL),
  });
  return cachedClient;
}

/**
 * Read every reader call needed to fill a circuit's chain-state
 * public inputs at the current block. The reads land in a single
 * viem.multicall so they all reflect the same chain snapshot.
 */
export async function readChainSnapshot(): Promise<ChainSnapshot> {
  if (!ORACLE || !RATE_MODEL || !ASSET_REGISTRY) {
    throw new Error(
      "chain-reader: missing NEXT_PUBLIC_ANVIL_{ORACLE,RATE_MODEL,ASSET_REGISTRY}",
    );
  }
  const client = getClient();

  const [block, numAssetsRaw] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({
      address: ASSET_REGISTRY,
      abi: assetRegistryAbi,
      functionName: "numAssets",
    }),
  ]);
  const numAssets = Number(numAssetsRaw);

  const prices: bigint[] = new Array(MAX_ASSETS).fill(0n);
  const borrowIndices: bigint[] = new Array(MAX_ASSETS).fill(0n);
  const supplyIndices: bigint[] = new Array(MAX_ASSETS).fill(0n);
  const ltvBps: bigint[] = new Array(MAX_ASSETS).fill(0n);
  const ltBps: bigint[] = new Array(MAX_ASSETS).fill(0n);

  // Read per-asset state for every registered asset in parallel.
  // We only run reads for slots [0, numAssets) -- the rest stay
  // zero, matching what the circuits expect for unused slots.
  const reads: Promise<unknown>[] = [];
  for (let i = 0; i < Math.min(numAssets, MAX_ASSETS); i++) {
    const assetId = i;
    reads.push(
      client
        .readContract({
          address: ORACLE,
          abi: oracleAbi,
          functionName: "getPrice",
          args: [assetId],
          blockNumber: block,
        })
        .then((p) => {
          prices[i] = BigInt(p as bigint);
        }),
      client
        .readContract({
          address: RATE_MODEL,
          abi: rateModelAbi,
          functionName: "state",
          args: [assetId],
          blockNumber: block,
        })
        .then((s) => {
          const st = s as { supplyIndex: bigint; borrowIndex: bigint };
          supplyIndices[i] = BigInt(st.supplyIndex);
          borrowIndices[i] = BigInt(st.borrowIndex);
        }),
      client
        .readContract({
          address: ASSET_REGISTRY,
          abi: assetRegistryAbi,
          functionName: "assets",
          args: [assetId],
          blockNumber: block,
        })
        .then((c) => {
          const cfg = c as {
            ltvBps: number;
            liquidationThresholdBps: number;
            enabled: boolean;
          };
          // Disabled assets behave as if collateralisation isn't
          // permitted -- pass through the registry values verbatim
          // so the circuit's per-asset checks see the same data the
          // contract does.
          ltvBps[i] = BigInt(cfg.ltvBps);
          ltBps[i] = BigInt(cfg.liquidationThresholdBps);
        }),
    );
  }
  await Promise.all(reads);

  return {
    block,
    prices,
    borrowIndices,
    supplyIndices,
    ltvBps,
    ltBps,
    numAssets,
  };
}

/**
 * Compute the witness hints `lib_common::check_accrual` expects:
 *
 *   debt * idx_now == accrued_debt * idx_at_update + remainder
 *   remainder < idx_at_update   (or both 0 when debt == 0)
 *
 * Off-circuit we just do floor division on bigints. Returns both
 * arrays in slot order -- the caller wires them into the witness's
 * `accrued_debts` + `accrual_remainders` private inputs.
 */
export function computeAccrualHints(
  debts: bigint[],
  idxNows: bigint[],
  idxAtUpdates: bigint[],
): { accruedDebts: bigint[]; remainders: bigint[] } {
  if (
    debts.length !== MAX_ASSETS ||
    idxNows.length !== MAX_ASSETS ||
    idxAtUpdates.length !== MAX_ASSETS
  ) {
    throw new Error("computeAccrualHints: array length must equal MAX_ASSETS");
  }
  const accruedDebts: bigint[] = new Array(MAX_ASSETS).fill(0n);
  const remainders: bigint[] = new Array(MAX_ASSETS).fill(0n);
  for (let i = 0; i < MAX_ASSETS; i++) {
    const debt = debts[i];
    const idxNow = idxNows[i];
    const idxOld = idxAtUpdates[i];
    if (debt === 0n) {
      // Unused slot or no debt -- circuit asserts accrued_debt == 0
      // and remainder == 0 in this case.
      continue;
    }
    if (idxOld === 0n) {
      throw new Error(
        `computeAccrualHints: slot ${i} has debt ${debt} but borrowIndexAtUpdate == 0`,
      );
    }
    const product = debt * idxNow;
    accruedDebts[i] = product / idxOld;
    remainders[i] = product % idxOld;
  }
  return { accruedDebts, remainders };
}

export type { Address, Hex };
