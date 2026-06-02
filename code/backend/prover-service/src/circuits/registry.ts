/**
 * Mirror of `code/contracts/src/libraries/VkRegistry.sol`.
 *
 * Order is load-bearing: it matches the on-chain `IZkVerifier.CircuitId` enum.
 * `scripts/register-all-vks.ts` walks this list in order; `submit-proof` looks
 * up vkHash by name. If the on-chain enum changes, change this array too.
 */

export const CIRCUITS = [
  { id: 0, name: "entry_deposit",       vkHash: "0x2b315b228ad9d1124d0c77a4f4812d7f5d4fa97bd6c34da5ccf366e1bf36c645" },
  { id: 1, name: "entry_withdraw",      vkHash: "0x0d6eaaba1ffb40359304c8ba5acf9f6e9c5770180cb46bce7266322f299bebdd" },
  { id: 2, name: "supply_asset",        vkHash: "0x056c48ddfa2fd803a9037c1db2198e65f1acc3ecca83c92fa54d8b76d1631a67" },
  { id: 3, name: "withdraw_supply",     vkHash: "0x2ed1cb47c676ffd7a77615d30892d52d1b13e3a4ce8b838472841579482c2abb" },
  { id: 4, name: "deposit_collateral",  vkHash: "0x1c5c568a48c9299dd98143271e92b5789e40cf24dd2a4c45710971d44b0e279a" },
  { id: 5, name: "withdraw_collateral", vkHash: "0x00a0580b083d25ced7db2de46c7da47e6f20fcb255ac5c2d3d5983ea9c711b01" },
  { id: 6, name: "borrow",              vkHash: "0x2f26f557f39e6e67a6e12bf0cf1fb829cf1439a8443fd9d39adff5caa60ae3b8" },
  { id: 7, name: "repay",               vkHash: "0x2c8e338f012f872c037e86c22ed1c8c6f5b0ef91b29004c195bd7124483d00d5" },
  { id: 8, name: "liquidate",           vkHash: "0x07303181b6304630990c35f21b94ff2f2ca9d7d64dd149a9ea6605e607c2be46" },
  { id: 9, name: "consolidate_balance", vkHash: "0x080a500330e9d1a5688b72700e155ca9c08f4504ba496cb8bec86a39dd0e4a12" },
  { id: 10, name: "compute_triggers",   vkHash: "0x24d7519a8f955dfe41595d78deff63db5f88f98e126af02b0c42df5500e0a109" },
] as const;

export type CircuitName = (typeof CIRCUITS)[number]["name"];

export function getCircuit(name: CircuitName) {
  const c = CIRCUITS.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown circuit: ${name}`);
  return c;
}
