/**
 * Day-8 acceptance smoke test.
 *
 * Picks the Day-4 `entry_deposit` proof on disk, submits it through Kurier,
 * polls until the job reaches a terminal state, and prints the aggregation
 * receipt. On success the receipt is the exact tuple a consumer contract
 * feeds to `IVerifyProofAggregation` on the destination chain.
 *
 * Pass `--circuit=<name>` to smoke a different circuit.
 */
import { KurierClient } from "../src/kurier/client.js";
import { CIRCUITS, type CircuitName } from "../src/circuits/registry.js";
import { submitAndWait } from "../src/pipeline/submit.js";
import { getConfig } from "../src/config.js";
import { log } from "../src/log.js";

function parseCircuit(): CircuitName {
  const arg = process.argv.find((a) => a.startsWith("--circuit="));
  const name = arg?.split("=")[1] ?? "entry_deposit";
  if (!CIRCUITS.some((c) => c.name === name)) {
    throw new Error(`Unknown circuit '${name}'. Known: ${CIRCUITS.map((c) => c.name).join(", ")}`);
  }
  return name as CircuitName;
}

async function main() {
  const circuit = parseCircuit();
  const client = new KurierClient();

  const targetChainId = getConfig().KURIER_TARGET_CHAIN_ID;
  log.info({ circuit, targetChainId }, "smoke-start");
  const receipt = await submitAndWait(client, circuit, {
    vkRegistered: true,
    chainId: targetChainId,
    poll: { intervalMs: 5_000, timeoutMs: 25 * 60_000 },
  });

  log.info(
    {
      circuit: receipt.circuit,
      jobId: receipt.jobId,
      status: receipt.status,
      aggregationId: receipt.aggregationId,
      root: receipt.details.root,
      leaf: receipt.details.leaf,
      leafIndex: receipt.details.leafIndex,
      numberOfLeaves: receipt.details.numberOfLeaves,
      merkleProofDepth: receipt.details.merkleProof.length,
      receiptBlockHash: receipt.details.receiptBlockHash,
    },
    "smoke-receipt",
  );
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "smoke-crash",
  );
  process.exitCode = 1;
});
