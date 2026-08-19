#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const ARTIFACT_PATH = "C:/Users/Hi/Desktop/team idea/code/circuits/supply_asset/target/supply_asset.json";

async function main() {
  console.log("Testing bb.js 1.2.1 with full error details\n");

  try {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
    console.log("✓ Artifact loaded");

    const api = await Barretenberg.new({ threads: 1 });
    console.log("✓ Barretenberg API initialized");

    const backend = new UltraHonkBackend(artifact.bytecode, api);
    console.log("✓ UltraHonkBackend created");

    console.log("\nAttempting getVerificationKey()...");
    const vk = await backend.getVerificationKey();

    console.log(`\n✅ SUCCESS: VK size = ${vk.length} bytes`);

    await api.destroy();
  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    console.error("Stack:", err.stack);
    process.exit(1);
  }
}

main();
