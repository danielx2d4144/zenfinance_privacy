/**
 * Storage for the per-circuit Kurier vkHash returned by `POST /register-vk`.
 *
 * This is distinct from the on-chain Pedersen vkHash pinned in `VkRegistry.sol`
 * (and `<circuit>/target/vk_hash`). They are two different hashes over the same
 * key:
 *   - on-chain vkHash (Pedersen): used by `ZkVerifier.sol` for the EVM-side
 *     identity check, pinned at deploy time.
 *   - Kurier vkHash (Substrate pallet, blake2-style): used by Kurier in
 *     `submit-proof` so it knows which registered vk to use on Volta.
 *
 * Both must be preserved. This file persists the Kurier mapping next to the
 * circuit artifacts so `submit-proof` can populate `proofData.vk` correctly.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CircuitName } from "./registry.js";

function targetDir(name: CircuitName): string {
  const here = fileURLToPath(new URL("./", import.meta.url));
  return resolve(here, "..", "..", "..", "..", "circuits", name, "target");
}

function filePath(name: CircuitName): string {
  return join(targetDir(name), "kurier_vk_hash");
}

export async function writeKurierVkHash(name: CircuitName, vkHash: string): Promise<void> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(vkHash)) {
    throw new Error(`refusing to write malformed kurier vkHash for ${name}: ${vkHash}`);
  }
  await writeFile(filePath(name), `${vkHash}\n`, "utf8");
}

export async function readKurierVkHash(name: CircuitName): Promise<`0x${string}`> {
  const raw = await readFile(filePath(name), "utf8");
  const trimmed = raw.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new Error(
      `${name}: kurier_vk_hash file missing or malformed. Run \`npm run register-vks\` first.`,
    );
  }
  return trimmed as `0x${string}`;
}
