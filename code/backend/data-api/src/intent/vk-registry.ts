/**
 * Per-circuit vkHash + on-chain CircuitId enum value.
 *
 * Mirror of `code/contracts/src/libraries/VkRegistry.sol` +
 * `IZkVerifier.CircuitId`. Order is load-bearing and matches the enum.
 * If the enum changes upstream, change this array too.
 *
 * Re-exposed here (instead of importing from prover-service) so the
 * data-API stays a self-contained package and the prover-service can
 * remain optional during local dev. The values are static and audited
 * via the Day-6 invariant test that pins them.
 */

export const CIRCUITS = [
  { id: 0, name: "entry_deposit",       vkHash: "0x2cb1a74389c8e9874bc7afb547715f84294b5b9ad4afda62f673f0d7723914d3" },
  { id: 1, name: "entry_withdraw",      vkHash: "0x1feea9cbba20ac77c4a57ce109b9f469ca66f28f9589336f5c374f5de1cb72f7" },
  { id: 2, name: "supply_asset",        vkHash: "0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6" },
  { id: 3, name: "withdraw_supply",     vkHash: "0x18959383b7a911cc6a75759adcf9d3639ec3f9e5009438ae636c40718366889c" },
  { id: 4, name: "deposit_collateral",  vkHash: "0x2f711a9ef305f88bf6f01c2110430f47e82ef9c9542c5d1ca6ec6a2c3ffe2b16" },
  { id: 5, name: "withdraw_collateral", vkHash: "0x24871915f320a4bc37ff6436424394660768b2176d9e4b32653b6796e1643cdc" },
  { id: 6, name: "borrow",              vkHash: "0x08d36912f9bb3b71d0773b5a7058d8c015908324e704553ce607b325cbb32a10" },
  { id: 7, name: "repay",               vkHash: "0x20e23e6c6e062ab49e4c8cb63f3e24d631a22c184b6b24c164b7fef34a609b0b" },
  { id: 8, name: "liquidate",           vkHash: "0x02970702f859db033e1bfd39a3cccb83febd4cda36b3512554fc7b74483bc914" },
  { id: 9, name: "consolidate_balance", vkHash: "0x1bd0e1573b44b78c835e1f226dbfee8816743117198715875424e0b2ec333f0c" },
  { id: 10, name: "compute_triggers",   vkHash: "0x22165dc59931e98ee8cebfee4c559f991812cfd2802db553fe0e6c4a15b4e1f3" },
] as const;

export type CircuitName = (typeof CIRCUITS)[number]["name"];

export function getCircuit(name: CircuitName) {
  const c = CIRCUITS.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown circuit: ${name}`);
  return c;
}
