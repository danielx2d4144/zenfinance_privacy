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
 * Captured 2026-08-03 from each circuit's `target/kurier_vk_hash`; the
 * `entry_deposit` entry is the one exercised end to end by the Phase-0
 * Horizen aggregation probe.
 */
import type { CircuitName } from "./registry.js";

export const KURIER_VK_HASHES: Readonly<Record<CircuitName, `0x${string}`>> =
  Object.freeze({
    entry_deposit:
      "0x324bffc3082940f27925fcf4cb080794e02ee9ba00e2dfde9c2ab88fcf4f5aec",
    entry_withdraw:
      "0x65b188181a1391a15c32304383c3221976411d68a4c0af09878f098bbb46023b",
    supply_asset:
      "0x5d7e2731bcfc9f0e6706ece84063394024241cb9f1878adc7cc15a76cd579298",
    withdraw_supply:
      "0x068515bb7c81ddc269915adc00c361a16070e28cb5c69bf7d52ce71ff6f55df0",
    deposit_collateral:
      "0x81854bf49e8378dba88aff409a18403410eaa43e5d651bb222fd4ee5360b3b4d",
    withdraw_collateral:
      "0x9471fd08b1c8d3b0a3a68ad1c876f109f2511470b15962050a4a831cc240f148",
    borrow:
      "0x8eb1255477ca86160a303e891914ded679792eedc2cee4cd80b160cc6af4f055",
    repay:
      "0xc2983fcba67a3669933f00508e321b7715eeacd7775e087e4c6f8d23ab73690d",
    liquidate:
      "0x05bbd845065e93244c94db32948fbe4b9e1a146c0897178d61107602ae20f829",
    consolidate_balance:
      "0xd1e8dfe0833e031936868f9e0b5461d1a0279128b5f6fc4cdc72ab90f11238dc",
    compute_triggers:
      "0x19f988f73a819cc24b01efa6e3d1121501bf68433ca159624b43ad035e8b1465",
  } as const);
