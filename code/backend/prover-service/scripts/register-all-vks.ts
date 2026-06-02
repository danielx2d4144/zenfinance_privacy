/**
 * One-shot: register every circuit's vk with Kurier and persist the returned
 * (Substrate-pallet) vkHash next to the circuit artifacts.
 *
 * Run once per Kurier project / environment. Idempotent: re-registering the
 * same vk returns the same Kurier vkHash.
 *
 * Note: the vkHash returned by Kurier is NOT the same value as the on-chain
 * Pedersen `vkHash` in `VkRegistry.sol`. They are two different hash functions
 * over the same verification key. The Kurier value goes into Kurier's
 * `submit-proof.proofData.vk` payload; the Pedersen value stays on chain.
 */
import { KurierClient } from "../src/kurier/client.js";
import { KurierError } from "../src/kurier/errors.js";
import { CIRCUITS, type CircuitName } from "../src/circuits/registry.js";
import { readPinnedVkHash, readVkBytes } from "../src/circuits/vk-loader.js";
import { writeKurierVkHash } from "../src/circuits/kurier-vk-store.js";
import { log } from "../src/log.js";

interface Outcome {
  circuit: CircuitName;
  ok: boolean;
  pedersenVkHash: string;
  kurierVkHash?: string;
  error?: string;
}

async function registerOne(client: KurierClient, circuit: CircuitName): Promise<Outcome> {
  const pedersenVkHash = await readPinnedVkHash(circuit);
  try {
    const vk = await readVkBytes(circuit);
    const res = await client.registerVk({
      proofType: "ultrahonk",
      proofOptions: { variant: "ZK", version: "V3_0" },
      vk,
    });
    await writeKurierVkHash(circuit, res.vkHash);
    return {
      circuit,
      ok: true,
      pedersenVkHash,
      kurierVkHash: res.vkHash,
    };
  } catch (err) {
    return {
      circuit,
      ok: false,
      pedersenVkHash,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      ...(err instanceof KurierError && err.body ? { responseBody: err.body } : {}),
    };
  }
}

async function main() {
  const client = new KurierClient();
  log.info({ count: CIRCUITS.length }, "register-vks-start");

  const results: Outcome[] = [];
  for (const { name } of CIRCUITS) {
    const r = await registerOne(client, name);
    log.info(
      {
        circuit: r.circuit,
        ok: r.ok,
        pedersenVkHash: r.pedersenVkHash,
        kurierVkHash: r.kurierVkHash,
        error: r.error,
      },
      "register-vk-result",
    );
    results.push(r);
  }

  const failures = results.filter((r) => !r.ok);
  log.info(
    { total: results.length, ok: results.length - failures.length, failed: failures.length },
    "register-vks-done",
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "register-vks-crash",
  );
  process.exitCode = 1;
});
