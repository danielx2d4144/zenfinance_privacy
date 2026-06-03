import { describe, expect, it } from "vitest";
import { CIRCUITS } from "../src/circuits/registry.js";

describe("consume argument shape", () => {
  it("each circuit name maps to its enum id 0..10 in order", () => {
    const expectedOrder = [
      "entry_deposit",
      "entry_withdraw",
      "supply_asset",
      "withdraw_supply",
      "deposit_collateral",
      "withdraw_collateral",
      "borrow",
      "repay",
      "liquidate",
      "consolidate_balance",
      "compute_triggers",
    ];
    expect(CIRCUITS.map((c) => c.name)).toEqual(expectedOrder);
    expect(CIRCUITS.map((c) => c.id)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("every circuit has a 32-byte Pedersen vkHash", () => {
    for (const c of CIRCUITS) {
      expect(c.vkHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
