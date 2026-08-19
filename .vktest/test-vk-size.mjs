#!/usr/bin/env node
/**
 * Test VK size for different bb.js versions
 * Usage: node test-vk-size.mjs <bb.js-version>
 */
import { readFileSync } from "node:fs";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const ARTIFACT_PATH = "C:/Users/Hi/Desktop/team idea/code/circuits/supply_asset/target/supply_asset.json";

async function main() {
  const version = process.argv[2] || "unknown";
  console.log(`Testing bb.js version: ${version}`);

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
  const api = await Barretenberg.new({ threads: 1 });
  const backend = new UltraHonkBackend(artifact.bytecode, api);

  const vkResult = await api.circuitComputeVk({
    circuit: {
      name: "circuit",
      bytecode: backend.acirUncompressedBytecode,
    },
    settings: {
      ipaAccumulation: false,
      oracleHashType: "poseidon2",
      disableZk: false,
      optimizedSolidityVerifier: false,
    },
  });

  console.log(`VK size: ${vkResult.bytes.length} bytes`);
  console.log(`VK hash: 0x${Buffer.from(vkResult.hash).toString("hex")}`);

  await api.destroy();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
