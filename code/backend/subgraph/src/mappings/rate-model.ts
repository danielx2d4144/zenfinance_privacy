import { BigInt } from "@graphprotocol/graph-ts";
import {
  AssetInitialized,
  RateParamsSet,
  IndexAccrued,
  AssetPausedStateSet,
} from "../../generated/RateModel/RateModel";
import { getOrCreateMarket, recomputeUtilization } from "../utils/market";

const RAY = BigInt.fromString("1000000000000000000000000000"); // 1e27

export function handleAssetInitialized(event: AssetInitialized): void {
  const m = getOrCreateMarket(event.params.assetId);
  // RateModel sets both indices to RAY at init.
  m.supplyIndex = RAY;
  m.borrowIndex = RAY;
  m.lastAccrual = event.block.timestamp;
  m.save();
}

export function handleRateParamsSet(_event: RateParamsSet): void {
  // RateParams (uOptimal/slope1/slope2) drive rate calc but aren't stored on
  // Market in the schema — they're computed downstream when rates are read.
  // Kept as an explicit no-op handler so the manifest's eventHandlers list
  // documents the wired surface.
}

export function handleIndexAccrued(event: IndexAccrued): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.borrowIndex = event.params.borrowIndex;
  m.supplyIndex = event.params.supplyIndex;
  m.lastAccrual = BigInt.fromI64(event.params.timestamp);
  m.utilizationBps = recomputeUtilization(m);
  // Rate fields stay at last-known values; pool-driven setTotals events on
  // Day 11 will refresh totalSupply/totalBorrow and let us recompute APRs
  // off the kink curve. For Day 10 we expose the index/utilisation truth.
  m.save();
}

export function handleAssetPausedStateSet(event: AssetPausedStateSet): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.paused = event.params.paused;
  m.save();
}

