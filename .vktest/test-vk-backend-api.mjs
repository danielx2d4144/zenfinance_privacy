#!/usr/bin/env node
/**
 * Test VK size using UltraHonkBackend.getVerificationKey() API
 * (older bb.js versions don't have api.circuitComputeVk)
 */
import { readFileSync } from "node:fs";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const ARTIFACT_PATH = "C:/Users/Hi/Desktop/team idea/code/circuits/supply_asset/target/supply_asset.json";

async function main() {
  const version = process.argv[2] || "unknown";
  console.log(`Testing bb.js version: ${version}`);

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));

  let api;
  try {
    api = await Barretenberg.new({ threads: 1 });
  } catch (err) {
    console.log(`Failed to init Barretenberg: ${err.message}`);
    process.exit(1);
  }

  let backend;
  try {
    backend = new UltraHonkBackend(artifact.bytecode, api);
  } catch (err) {
    console.log(`Failed to create UltraHonkBackend: ${err.message}`);
    await api.destroy();
    process.exit(1);
  }

  try {
    // Try the newer getVerificationKey({}) API first (with options object)
    const vkBytes = await backend.getVerificationKey({});
    console.log(`VK size: ${vkBytes.length} bytes (via getVerificationKey({}))`);
    await api.destroy();
    return;
  } catch (err) {
    // Fall back to older getVerificationKey() API (no args)
    try {
      const vkBytes = await backend.getVerificationKey();
      console.log(`VK size: ${vkBytes.length} bytes (via getVerificationKey())`);
      await api.destroy();
      return;
    } catch (err2) {
      console.log(`Both getVerificationKey APIs failed:`);
      console.log(`  With opts: ${err.message}`);
      console.log(`  No opts:   ${err2.message}`);
      await api.destroy();
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
