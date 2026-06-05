import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Market } from "../../generated/schema";
import { marketIdFromAssetId } from "./ids";

/**
 * Lazily get-or-create the Market entity for `assetId`. Mappings touching the
 * Market (RateModel, Oracle, AssetRegistry, …) all funnel through this so
 * field defaults stay consistent and we don't store nulls where we mean zero.
 */
export function getOrCreateMarket(assetId: i32): Market {
  const id = marketIdFromAssetId(assetId);
  let m = Market.load(id);
  if (m == null) {
    m = new Market(id);
    m.assetId = assetId;
    // Token / decimals are filled in by AssetRegistry.handleAssetEnabled when
    // it lands; zero is the documented "unknown" sentinel.
    m.token = changetype<Bytes>(new Uint8Array(20));
    m.decimals = 0;
    m.totalSupply = BigInt.zero();
    m.totalBorrow = BigInt.zero();
    m.supplyIndex = BigInt.zero();
    m.borrowIndex = BigInt.zero();
    m.utilizationBps = 0;
    m.supplyRateBps = 0;
    m.borrowRateBps = 0;
    m.lastAccrual = BigInt.zero();
    m.latestPriceUsd1e8 = null;
    m.latestPriceAt = null;
    m.paused = false;
  }
  return m;
}

const RAY = BigInt.fromString("1000000000000000000000000000"); // 1e27
const BPS = BigInt.fromI32(10_000);

/** Recompute utilisation = totalBorrow / totalSupply in basis points. */
export function recomputeUtilization(m: Market): i32 {
  if (m.totalSupply.isZero()) return 0;
  const utilRay = m.totalBorrow.times(RAY).div(m.totalSupply);
  return utilRay.times(BPS).div(RAY).toI32();
}
