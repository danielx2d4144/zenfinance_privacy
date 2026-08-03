/**
 * The Horizen keeper's decision logic.
 *
 * Worth testing directly because the failure it guards against is invisible
 * until it is total: `Oracle.getPrice` reverts past MAX_STALENESS_WINDOW
 * (3600s) and takes every borrow, collateral and liquidation flow with it.
 * A keeper that skips a round for the wrong reason looks perfectly healthy in
 * logs right up to the outage.
 */
import { describe, expect, it } from "vitest";

import {
  decidePush,
  resolveTargetPrice,
  PRICE_SCALE,
  USDC_ASSET_ID,
  type OnChainPrice,
} from "../src/oracle-push.js";

const CFG = { HORIZEN_MAX_AGE_SECONDS: 1_800, PRICE_MOVE_THRESHOLD_BPS: 50 };

const NOW = 1_800_000_000;
const btc = (usd: number): bigint => BigInt(Math.round(usd * Number(PRICE_SCALE)));

function priced(usd: number, ageSeconds: number): OnChainPrice {
  return { priceUsd1e8: btc(usd), updatedAt: BigInt(NOW - ageSeconds) };
}

describe("decidePush", () => {
  it("pushes an unset slot regardless of age arithmetic", () => {
    // updatedAt of 0 is the unix epoch; an age check alone would call this
    // ~55 years stale and happen to do the right thing, but priceUsd1e8 == 0
    // with a recent timestamp would not. getPrice reverts PriceUnset for both.
    const d = decidePush({ priceUsd1e8: 0n, updatedAt: 0n }, btc(64_000), NOW, CFG);
    expect(d).toMatchObject({ push: true, reason: "unset" });

    const zeroPriced = decidePush(
      { priceUsd1e8: 0n, updatedAt: BigInt(NOW - 5) },
      btc(64_000),
      NOW,
      CFG,
    );
    expect(zeroPriced).toMatchObject({ push: true, reason: "unset" });
  });

  it("pushes on age alone, even when the price has not moved at all", () => {
    const d = decidePush(priced(64_000, 1_800), btc(64_000), NOW, CFG);
    expect(d.push).toBe(true);
    expect(d.reason).toBe("stale");
    expect(d.moveBps).toBe(0);
  });

  it("holds off while fresh and steady", () => {
    const d = decidePush(priced(64_000, 60), btc(64_000), NOW, CFG);
    expect(d.push).toBe(false);
    expect(d.reason).toBeNull();
  });

  it("pushes early on a large move", () => {
    // 64_000 -> 65_000 is 156 bps, well past the 50 bps threshold.
    const d = decidePush(priced(64_000, 60), btc(65_000), NOW, CFG);
    expect(d.push).toBe(true);
    expect(d.reason).toBe("moved");
    expect(d.moveBps).toBe(156);
  });

  it("treats the move threshold as inclusive", () => {
    // Exactly 50 bps: 64_000 -> 64_320.
    const d = decidePush(priced(64_000, 60), btc(64_320), NOW, CFG);
    expect(d.moveBps).toBe(50);
    expect(d.push).toBe(true);
  });

  it("measures a downward move by magnitude, not sign", () => {
    const d = decidePush(priced(64_000, 60), btc(63_000), NOW, CFG);
    expect(d.push).toBe(true);
    expect(d.reason).toBe("moved");
    expect(d.moveBps).toBe(156);
  });

  it("pushes well before the 3600s window the contract enforces", () => {
    // The whole point of the default: a failed run must not be an outage.
    const oneMissedRun = decidePush(priced(64_000, 1_800), btc(64_000), NOW, CFG);
    expect(oneMissedRun.push).toBe(true);
    expect(oneMissedRun.ageSeconds).toBeLessThan(3_600);
  });
});

describe("resolveTargetPrice", () => {
  it("pins USDC to $1 without consulting the feed", () => {
    expect(resolveTargetPrice(USDC_ASSET_ID, priced(1, 60), null)).toBe(PRICE_SCALE);
  });

  it("prefers live spot for cbBTC", () => {
    expect(resolveTargetPrice(1, priced(60_000, 60), btc(64_000))).toBe(btc(64_000));
  });

  it("re-pushes the last on-chain value when the feed is down", () => {
    // Freshness beats accuracy: a repeated price keeps lending usable, a
    // skipped round marches every flow toward PriceStale.
    expect(resolveTargetPrice(1, priced(60_000, 1_900), null)).toBe(btc(60_000));
  });

  it("refuses to invent a price when there is neither feed nor history", () => {
    expect(
      resolveTargetPrice(1, { priceUsd1e8: 0n, updatedAt: 0n }, null),
    ).toBeNull();
  });
});
