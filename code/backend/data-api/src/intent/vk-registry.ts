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
 *
 * Updated 2026-08-21: Synced with Keccak-format VK hashes (1888 bytes)
 * from kurier-vk-hashes.ts and VkRegistry.sol. Previous values were
 * Poseidon2 format (3680 bytes) which caused VkHashMismatch reverts.
 */

export const CIRCUITS = [
  { id: 0, name: "entry_deposit",       vkHash: "0x0063b1d06d07c6c2f95c85450bf47e324fd92901fa0009ecf1193a80ea8a4270" },
  { id: 1, name: "entry_withdraw",      vkHash: "0x7f23d01f0f374830c798db6f83f5bd016468d036437628ddfc762f8b513a823c" },
  { id: 2, name: "supply_asset",        vkHash: "0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373" },
  { id: 3, name: "withdraw_supply",     vkHash: "0xd6f1bb92d97aa596b227aa556f0b4010761c6ee55780b27c1397c5927497efc2" },
  { id: 4, name: "deposit_collateral",  vkHash: "0xb14b868cd59033bc935723bd1b427c1128df838a180a6be878f9a5da08346704" },
  { id: 5, name: "withdraw_collateral", vkHash: "0x28499c36b7cf01004d99578626afbbc9843b88a0e829f8c540830f5ef96c4c8a" },
  { id: 6, name: "borrow",              vkHash: "0xd8683cd6f52f93cb0ca080b964e29c9b83048fdbdbe4488c2546ce540b5f7568" },
  { id: 7, name: "repay",               vkHash: "0xca9cd26328f61b020accacbbba348bf8d783dc78e9d6eba54ed007d6535e50b4" },
  { id: 8, name: "liquidate",           vkHash: "0xac31cdb92f463d7958513b4fd52b688c4444ef631a6ef75614d9bad6619f27db" },
  { id: 9, name: "consolidate_balance", vkHash: "0xf45292467c13d34aeb8654e23bb2e8976954aedfc8d1c82395a5feb4b1480a48" },
  { id: 10, name: "compute_triggers",   vkHash: "0x26f19d4f331dd3905d3eda2b9254ca4da3252cb8fad7d170fe5cd5a4bc1c2bb7" },
] as const;

export type CircuitName = (typeof CIRCUITS)[number]["name"];

export function getCircuit(name: CircuitName) {
  const c = CIRCUITS.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown circuit: ${name}`);
  return c;
}
