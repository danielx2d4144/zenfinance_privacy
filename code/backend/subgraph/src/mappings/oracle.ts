import { BigInt } from "@graphprotocol/graph-ts";
import {
  PriceUpdated,
  StalenessWindowSet,
  StorkFeedSet,
} from "../../generated/Oracle/Oracle";
import { getOrCreateMarket } from "../utils/market";

export function handlePriceUpdated(event: PriceUpdated): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.latestPriceUsd1e8 = event.params.priceUsd1e8;
  m.latestPriceAt = event.params.updatedAt;
  m.save();
}

export function handleStalenessWindowSet(_event: StalenessWindowSet): void {
  // Staleness window is a per-feed admin parameter, not Market state. We
  // intentionally don't mirror it here; the REST layer can read it from the
  // oracle contract directly when needed.
}

export function handleStorkFeedSet(_event: StorkFeedSet): void {
  // Stork feed binding is admin-side config; no Market field change.
}
