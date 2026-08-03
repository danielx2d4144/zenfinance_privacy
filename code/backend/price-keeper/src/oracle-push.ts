/**
 * Keeps the Horizen testnet Oracle inside its staleness window.
 *
 * The Base Sepolia keeper (`pusher.ts`) submits signed Stork payloads to the
 * Stork verifier. Nothing in that path applies here: Horizen's Oracle was
 * deployed with `stork_ = address(0)`, so prices arrive through
 * `Oracle.pushPrice(assetId, priceUsd1e8)` under `MANAGER_ROLE`.
 *
 * The job this process exists to do is *freshness*, not price accuracy.
 * `Oracle.getPrice` reverts with `PriceStale` past `MAX_STALENESS_WINDOW`
 * (3600s), and every borrow, collateral and liquidation flow reads through it —
 * so a lapse is a total protocol outage, whereas a slightly stale testnet BTC
 * quote is cosmetic. That asymmetry drives the fallback in `resolveTargetPrice`:
 * when the spot feed is unreachable we re-push the last on-chain value rather
 * than skip the round.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { log } from "./log.js";
import {
  getHorizenConfig,
  horizenAssetIds,
  type HorizenConfig,
} from "./horizen-config.js";

/** Asset id 0 is tUSDC, pinned to $1 — no feed lookup needed. */
export const USDC_ASSET_ID = 0;
export const PRICE_SCALE = 100_000_000n; // 1e8, the Oracle's unit

const ORACLE_ABI = [
  {
    type: "function",
    name: "pushPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "priceUsd1e8", type: "uint128" },
    ],
    outputs: [],
  },
  {
    // Unlike getPrice, this does NOT revert on a stale value — which is the
    // whole point: we need to read a stale price in order to refresh it.
    type: "function",
    name: "priceData",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "priceUsd1e8", type: "uint128" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface OnChainPrice {
  priceUsd1e8: bigint;
  updatedAt: bigint;
}

export type PushReason = "stale" | "moved" | "unset" | null;

export interface PushDecision {
  push: boolean;
  reason: PushReason;
  ageSeconds: number;
  moveBps: number;
}

/**
 * Pure decision step — no chain, no network, so the interesting edge cases
 * (unset price, exact-threshold movement) are testable directly.
 */
export function decidePush(
  onchain: OnChainPrice,
  targetPrice: bigint,
  nowSeconds: number,
  cfg: Pick<HorizenConfig, "HORIZEN_MAX_AGE_SECONDS" | "PRICE_MOVE_THRESHOLD_BPS">,
): PushDecision {
  // updatedAt == 0 means the slot was never written. `getPrice` reverts with
  // PriceUnset here, so this must push regardless of age arithmetic (which
  // would otherwise be measured against the unix epoch).
  if (onchain.updatedAt === 0n || onchain.priceUsd1e8 === 0n) {
    return { push: true, reason: "unset", ageSeconds: 0, moveBps: 0 };
  }

  const ageSeconds = nowSeconds - Number(onchain.updatedAt);

  const diff =
    targetPrice > onchain.priceUsd1e8
      ? targetPrice - onchain.priceUsd1e8
      : onchain.priceUsd1e8 - targetPrice;
  const moveBps = Number((diff * 10_000n) / onchain.priceUsd1e8);

  if (ageSeconds >= cfg.HORIZEN_MAX_AGE_SECONDS) {
    return { push: true, reason: "stale", ageSeconds, moveBps };
  }
  if (moveBps >= cfg.PRICE_MOVE_THRESHOLD_BPS) {
    return { push: true, reason: "moved", ageSeconds, moveBps };
  }
  return { push: false, reason: null, ageSeconds, moveBps };
}

/** Fetch BTC/USD spot, scaled to the Oracle's 1e8 unit. Null if unavailable. */
export async function fetchBtcSpot(
  cfg: HorizenConfig = getHorizenConfig(),
): Promise<bigint | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.BTC_PRICE_TIMEOUT_MS);
    let body: unknown;
    try {
      const res = await fetch(cfg.BTC_PRICE_URL, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const usd = (body as { bitcoin?: { usd?: number } })?.bitcoin?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error(`unexpected payload shape: ${JSON.stringify(body).slice(0, 120)}`);
    }
    // Round rather than truncate; at 1e8 the difference is immaterial but
    // truncation would bias every quote downward.
    return BigInt(Math.round(usd * Number(PRICE_SCALE)));
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), url: cfg.BTC_PRICE_URL },
      "horizen-spot-fetch-failed",
    );
    return null;
  }
}

/**
 * What price should this asset be set to?
 *
 * Falls back to the last on-chain value when the feed is down, because a
 * repeated-but-fresh price keeps the protocol usable while a skipped round
 * marches every lending flow toward a revert.
 */
export function resolveTargetPrice(
  assetId: number,
  onchain: OnChainPrice,
  spot: bigint | null,
): bigint | null {
  if (assetId === USDC_ASSET_ID) return PRICE_SCALE;
  if (spot !== null) return spot;
  if (onchain.priceUsd1e8 > 0n) return onchain.priceUsd1e8;
  return null; // never set and no feed — nothing honest to push
}

function clients(cfg: HorizenConfig) {
  const chain = defineChain({
    id: cfg.HORIZEN_TESTNET_CHAIN_ID,
    name: "Horizen Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.HORIZEN_TESTNET_HTTPS] } },
  });
  const account = privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(cfg.HORIZEN_TESTNET_HTTPS);
  return {
    chain,
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

export interface AssetPushResult {
  assetId: number;
  pushed: boolean;
  reason: PushReason;
  priceUsd1e8: bigint | null;
  ageSeconds: number;
  txHash: Hex | null;
}

/** One sweep over every configured asset. Safe to run from a cron. */
export async function keepHorizenFresh(
  cfg: HorizenConfig = getHorizenConfig(),
): Promise<AssetPushResult[]> {
  const assetIds = horizenAssetIds(cfg);
  const oracle = cfg.ORACLE_HORIZEN as Address;
  const { publicClient, walletClient, account, chain } = clients(cfg);

  // Only hit the feed if some non-USDC asset actually needs it.
  const spot = assetIds.some((id) => id !== USDC_ASSET_ID)
    ? await fetchBtcSpot(cfg)
    : null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const results: AssetPushResult[] = [];

  for (const assetId of assetIds) {
    const onchain = (await publicClient.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: "priceData",
      args: [assetId],
    })) as OnChainPrice;

    const target = resolveTargetPrice(assetId, onchain, spot);
    if (target === null) {
      log.error({ assetId }, "horizen-push-no-price-available");
      results.push({
        assetId,
        pushed: false,
        reason: null,
        priceUsd1e8: null,
        ageSeconds: 0,
        txHash: null,
      });
      continue;
    }

    const decision = decidePush(onchain, target, nowSeconds, cfg);
    if (!decision.push) {
      log.info(
        { assetId, ageSeconds: decision.ageSeconds, moveBps: decision.moveBps },
        "horizen-push-skipped",
      );
      results.push({
        assetId,
        pushed: false,
        reason: null,
        priceUsd1e8: target,
        ageSeconds: decision.ageSeconds,
        txHash: null,
      });
      continue;
    }

    const txHash = await walletClient.writeContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: "pushPrice",
      args: [assetId, target],
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Oracle.pushPrice reverted for asset ${assetId} (tx ${txHash})`);
    }

    log.info(
      {
        assetId,
        reason: decision.reason,
        priceUsd1e8: target.toString(),
        ageSeconds: decision.ageSeconds,
        moveBps: decision.moveBps,
        txHash,
        gasUsed: receipt.gasUsed.toString(),
      },
      "horizen-push-ok",
    );
    results.push({
      assetId,
      pushed: true,
      reason: decision.reason,
      priceUsd1e8: target,
      ageSeconds: decision.ageSeconds,
      txHash,
    });
  }

  return results;
}
