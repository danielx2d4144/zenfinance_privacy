import {
  AssetEnabled,
  AssetConfigUpdated,
  AssetDisabled,
  AssetRegistry,
} from "../../generated/AssetRegistry/AssetRegistry";
import { getOrCreateMarket } from "../utils/market";

export function handleAssetEnabled(event: AssetEnabled): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.token = event.params.token;
  const reg = AssetRegistry.bind(event.address);
  const cfg = reg.try_assets(event.params.assetId);
  if (!cfg.reverted) {
    m.decimals = cfg.value.decimals;
  }
  m.save();
}

export function handleAssetConfigUpdated(event: AssetConfigUpdated): void {
  const m = getOrCreateMarket(event.params.assetId);
  const reg = AssetRegistry.bind(event.address);
  const cfg = reg.try_assets(event.params.assetId);
  if (!cfg.reverted) {
    m.decimals = cfg.value.decimals;
    m.token = cfg.value.token;
  }
  m.save();
}

export function handleAssetDisabled(event: AssetDisabled): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.paused = true;
  m.save();
}
