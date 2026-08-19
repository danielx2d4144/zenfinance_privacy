/**
 * Kurier-side vkHashes, pinned in source.
 *
 * These are what `POST /register-vk` returned for each circuit's UltraHonk
 * verification key. They are NOT the on-chain Pedersen hashes in
 * `VkRegistry.sol` — see the header of `kurier-vk-store.ts` for why both
 * exist.
 *
 * Why pinned here as well as on disk: `kurier-vk-store.ts` reads
 * `code/circuits/<name>/target/kurier_vk_hash`, which only exists in a
 * checkout that has run `nargo`/`bb`. The data-API ships to Railway as a
 * container with no `code/circuits/` tree at all, so submitting a proof
 * would fail on a missing file rather than on anything real. This map is
 * the fallback, mirroring how `VkRegistry.sol` pins the Pedersen hashes
 * rather than recomputing them.
 *
 * Regenerating: `npm run register-vks` rewrites the on-disk files. If a
 * circuit is rebuilt its vk changes, so this map must be updated in the
 * same commit — `readKurierVkHash` throws on a disk/constant mismatch
 * precisely so that drift is loud.
 *
 * Updated 2026-08-19 with Keccak-format VKs (1888 bytes). Previous VKs were
 * Poseidon2 format (3680 bytes), which Kurier rejected. Keccak format is
 * required for on-chain verification with zkVerify.
 */
import type { CircuitName } from "./registry.js";

export const KURIER_VK_HASHES: Readonly<Record<CircuitName, `0x${string}`>> =
  Object.freeze({
    entry_deposit:
      "0x0063b1d06d07c6c2f95c85450bf47e324fd92901fa0009ecf1193a80ea8a4270",
    entry_withdraw:
      "0x7f23d01f0f374830c798db6f83f5bd016468d036437628ddfc762f8b513a823c",
    supply_asset:
      "0x6d827ab8e9cda14748279168d08e083b72fa7469e8fe83226e5ccf77118be373",
    withdraw_supply:
      "0xd6f1bb92d97aa596b227aa556f0b4010761c6ee55780b27c1397c5927497efc2",
    deposit_collateral:
      "0xb14b868cd59033bc935723bd1b427c1128df838a180a6be878f9a5da08346704",
    withdraw_collateral:
      "0x28499c36b7cf01004d99578626afbbc9843b88a0e829f8c540830f5ef96c4c8a",
    borrow:
      "0xd8683cd6f52f93cb0ca080b964e29c9b83048fdbdbe4488c2546ce540b5f7568",
    repay:
      "0xca9cd26328f61b020accacbbba348bf8d783dc78e9d6eba54ed007d6535e50b4",
    liquidate:
      "0xac31cdb92f463d7958513b4fd52b688c4444ef631a6ef75614d9bad6619f27db",
    consolidate_balance:
      "0xf45292467c13d34aeb8654e23bb2e8976954aedfc8d1c82395a5feb4b1480a48",
    compute_triggers:
      "0x26f19d4f331dd3905d3eda2b9254ca4da3252cb8fad7d170fe5cd5a4bc1c2bb7",
  } as const);
