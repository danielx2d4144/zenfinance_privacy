import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";

/**
 * Stable composite id helpers. Keep id encodings in one place so mappings stay
 * one-liners and so the REST/MCP layers above can predict ids.
 */

export function eventId(ev: ethereum.Event): string {
  return ev.transaction.hash.toHexString() + "-" + ev.logIndex.toString();
}

export function aggregationId(domainId: BigInt, aggId: BigInt, leafIdx: BigInt): string {
  return domainId.toString() + "-" + aggId.toString() + "-" + leafIdx.toString();
}

export function commitmentId(commitment: Bytes): string {
  return commitment.toHexString();
}

/** Symbolic market id from the AssetRegistry uint8. Day-10 has two assets. */
export function marketIdFromAssetId(assetId: i32): string {
  if (assetId == 0) return "USDC";
  if (assetId == 1) return "cbBTC";
  // Forward-compat: keep an "ASSET_N" fallback so unknown ids still index
  // without dropping the event entirely.
  return "ASSET_" + assetId.toString();
}
