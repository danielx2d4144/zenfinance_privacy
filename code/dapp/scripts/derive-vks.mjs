#!/usr/bin/env node
/**
 * code/dapp/scripts/derive-vks.mjs
 *
 * Derives the canonical VK bytes and Keccak vkHash for all 11 circuits
 * using the bb.js 3.0.0-rc.6 Node.js WASM that ships with this package.
 * Overwrites:
 *   code/circuits/<name>/target/vk       (1888 bytes — Keccak format for zkVerify)
 *   code/circuits/<name>/target/vk_hash  (32 bytes  — Keccak circuit digest)
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The default bb.js VK format is Poseidon2 (3680 bytes), designed for recursion
 * (proofs verified inside another circuit). For on-chain verification with
 * zkVerify, we need Keccak format (1888 bytes). Same circuit, same bb.js version,
 * just a different generation option controlled by keccakZK: true.
 *
 * SETTINGS NOTE
 * -------------
 * PROOF_SETTINGS below must match getProofSettingsFromOptions({ keccakZK: true })
 * in bb.js, which is what generateProof({ keccakZK: true }) uses in the browser
 * worker. Using different settings here would produce a different VK and break
 * verification.
 *
 * AFTER RUNNING THIS SCRIPT
 * -------------------------
 * 1. cd code/backend/prover-service && npm run register-vks
 *    Registers the freshly written 1888-byte Keccak VKs with Kurier and writes
 *    new target/kurier_vk_hash files.
 * 2. Copy the new Kurier hashes from each target/kurier_vk_hash file into
 *    src/circuits/kurier-vk-hashes.ts (the script prints them for you).
 * 3. Update VkRegistry.sol and registry.ts with the printed Keccak hashes,
 *    then redeploy ZkVerifier (Keccak hash != Poseidon2 hash, so contracts
 *    need the new values).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// code/dapp/scripts  →  ../..  →  code
// code               +  circuits  →  code/circuits
const CIRCUITS_DIR = join(__dirname, "..", "..", "circuits");

const CIRCUIT_NAMES = [
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

// Must exactly match getProofSettingsFromOptions({ keccakZK: true }) used by
// generateProof({ keccakZK: true }) in the browser worker. Do not change these
// without also changing the worker.
const PROOF_SETTINGS = {
  ipaAccumulation: false,
  oracleHashType: "keccak",
  disableZk: false,
  optimizedSolidityVerifier: false,
};

function bufToHex(buf) {
  return "0x" + Buffer.from(buf).toString("hex");
}

async function processCircuit(api, name) {
  const artifactPath = join(CIRCUITS_DIR, name, "target", `${name}.json`);
  if (!existsSync(artifactPath)) {
    console.error(`  SKIP  ${name}: artifact not found at ${artifactPath}`);
    return { name, ok: false, error: "artifact not found" };
  }

  process.stdout.write(`  ${name.padEnd(26)} loading... `);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  // UltraHonkBackend decompresses the base64-encoded ACIR bytecode in its
  // constructor. We use it only for that; the heavy WASM work happens in api.
  const backend = new UltraHonkBackend(artifact.bytecode, api);

  process.stdout.write("computing VK... ");
  const vkResult = await api.circuitComputeVk({
    circuit: {
      name: "circuit",
      bytecode: backend.acirUncompressedBytecode,
    },
    settings: PROOF_SETTINGS,
  });

  // vkResult.bytes → raw VK bytes (expect 1888 bytes with keccak format)
  // vkResult.hash  → 32-byte Keccak circuit digest (goes in VkRegistry.sol)
  const vkBytes   = vkResult.bytes;
  const hashBytes = vkResult.hash;

  if (hashBytes.length !== 32) {
    console.error(`  ERROR ${name}: vkResult.hash is ${hashBytes.length} bytes, expected 32`);
    return { name, ok: false, error: "hash length mismatch" };
  }

  if (vkBytes.length !== 1888) {
    console.error(`  ERROR ${name}: VK is ${vkBytes.length} bytes, expected 1888 (keccak format)`);
    return { name, ok: false, error: "vk length mismatch - keccak format not active" };
  }

  const hashHex = bufToHex(hashBytes);

  const targetDir = join(CIRCUITS_DIR, name, "target");
  writeFileSync(join(targetDir, "vk"),      Buffer.from(vkBytes));
  writeFileSync(join(targetDir, "vk_hash"), Buffer.from(hashBytes));

  console.log(`done  vk=${vkBytes.length}B  hash=${hashHex}`);
  return { name, ok: true, vkLen: vkBytes.length, hash: hashHex };
}

async function main() {
  console.log("=== derive-vks: bb.js 3.0.0-rc.6 (Keccak format for zkVerify) ===\n");
  console.log(`Circuits dir: ${CIRCUITS_DIR}\n`);
  console.log("Initialising barretenberg WASM (threads=1)...\n");

  const api = await Barretenberg.new({ threads: 1 });

  const results = [];
  for (const name of CIRCUIT_NAMES) {
    const r = await processCircuit(api, name);
    results.push(r);
  }

  await api.destroy();

  const ok     = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(`\n${ok.length}/${CIRCUIT_NAMES.length} circuits processed${failed.length ? `, ${failed.length} failed` : "."}`);
  if (failed.length) {
    console.error("Failed circuits: " + failed.map((r) => `${r.name} (${r.error})`).join(", "));
  }

  // ── VkRegistry.sol constants ─────────────────────────────────────────────
  console.log("\n── VkRegistry.sol updated constants ──────────────────────────────────────");
  const day4 = ["entry_deposit", "entry_withdraw", "supply_asset", "withdraw_supply", "deposit_collateral"];
  const day5 = ["withdraw_collateral", "borrow", "repay", "liquidate", "consolidate_balance", "compute_triggers"];
  for (const [label, names] of [["Day 4 circuits", day4], ["Day 5 circuits", day5]]) {
    console.log(`    // ${label}`);
    for (const n of names) {
      const r = ok.find((x) => x.name === n);
      if (!r) continue;
      const cname = n.toUpperCase().padEnd(22);
      console.log(`    bytes32 internal constant ${cname} =`);
      console.log(`        ${r.hash};`);
    }
    console.log();
  }

  // ── registry.ts vkHash values ─────────────────────────────────────────────
  console.log("── registry.ts vkHash entries ────────────────────────────────────────────");
  const ids = Object.fromEntries(CIRCUIT_NAMES.map((n, i) => [n, i]));
  for (const r of ok) {
    console.log(`  { id: ${String(ids[r.name]).padEnd(2)}, name: "${r.name.padEnd(22)}", vkHash: "${r.hash}" },`);
  }

  // ── Next steps ────────────────────────────────────────────────────────────
  console.log("\n── Next steps ────────────────────────────────────────────────────────────");
  console.log("1.  cd code/backend/prover-service");
  console.log("    npm run register-vks");
  console.log("    → re-registers the 1888-byte Keccak VKs with Kurier");
  console.log("    → writes new kurier_vk_hash files to each circuit target/");
  console.log("    → prints new Kurier VK hashes");
  console.log();
  console.log("2.  Update KURIER_VK_HASHES in");
  console.log("    code/backend/prover-service/src/circuits/kurier-vk-hashes.ts");
  console.log("    with the values that register-vks just printed.");
  console.log();
  console.log("3.  Paste the VkRegistry.sol constants above into");
  console.log("    code/contracts/src/libraries/VkRegistry.sol and redeploy ZkVerifier.");
  console.log("    (Keccak hashes differ from old Poseidon2 hashes, so update required)");
  console.log();
  console.log("4.  Test supply proof submission → should reach 'Aggregated' status!");

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.message ?? String(err));
  process.exit(1);
});
