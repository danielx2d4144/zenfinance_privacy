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
import { KURIER_VK_HASHES } from "./kurier-vk-hashes.js";
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

/**
 * Resolve a circuit's Kurier vkHash.
 *
 * Disk wins when present, because that's what `register-all-vks` just wrote
 * and a freshly rebuilt circuit is the case where the constant is stale. When
 * the file is absent — the deployed data-API container, which has no
 * `code/circuits/` tree — fall back to the pinned constant.
 *
 * A disk value that disagrees with the constant is a hard error: it means the
 * circuit was rebuilt and re-registered without updating
 * `kurier-vk-hashes.ts`, so anything deployed from this commit would submit
 * proofs against the wrong key and be rejected by Kurier with a confusing
 * message. Fail here instead, where the cause is legible.
 */
export async function readKurierVkHash(name: CircuitName): Promise<`0x${string}`> {
  const pinned = KURIER_VK_HASHES[name];

  let trimmed: string;
  try {
    trimmed = (await readFile(filePath(name), "utf8")).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (!pinned) {
        throw new Error(
          `${name}: no kurier_vk_hash on disk and no pinned constant. ` +
            `Run \`npm run register-vks\` in a checkout with built circuits.`,
        );
      }
      return pinned;
    }
    throw err;
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new Error(
      `${name}: kurier_vk_hash file missing or malformed. Run \`npm run register-vks\` first.`,
    );
  }
  if (pinned && trimmed.toLowerCase() !== pinned.toLowerCase()) {
    throw new Error(
      `Kurier vkHash drift for ${name}: pinned=${pinned} disk=${trimmed}. ` +
        `The circuit was re-registered without updating src/circuits/kurier-vk-hashes.ts — ` +
        `update it in the same commit, or the deployed API will submit against the wrong key.`,
    );
  }
  return trimmed as `0x${string}`;
}
