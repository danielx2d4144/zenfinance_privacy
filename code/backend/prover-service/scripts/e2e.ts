/**
 * Day-8 T-8.1 acceptance: end-to-end proof → aggregation → on-chain consume.
 *
 *   1. Submit the named circuit's proof to Kurier.
 *   2. Poll until Kurier reaches `Aggregated`.
 *   3. Call `ZkVerifier.verifyAndConsume` on Base Sepolia with the receipt.
 *   4. Assert `ProofConsumed` was emitted.
 *
 * Each circuit's `(domainId, aggregationId, leafIndex)` tuple is single-use
 * on-chain (anti-replay). To re-run this script with the same circuit you
 * need to regenerate the proof (yields a new aggregation slot).
 */
import { KurierClient } from "../src/kurier/client.js";
import { CIRCUITS, type CircuitName } from "../src/circuits/registry.js";
import { submitAndWait } from "../src/pipeline/submit.js";
import { consumeOnChain } from "../src/pipeline/consume.js";
import { getConfig } from "../src/config.js";
import { log } from "../src/log.js";

function parseCircuit(): CircuitName {
  const arg = process.argv.find((a) => a.startsWith("--circuit="));
  const name = arg?.split("=")[1] ?? "entry_deposit";
  if (!CIRCUITS.some((c) => c.name === name)) {
    throw new Error(
      `Unknown circuit '${name}'. Known: ${CIRCUITS.map((c) => c.name).join(", ")}`,
    );
  }
  return name as CircuitName;
}

async function main() {
  const circuit = parseCircuit();
  const cfg = getConfig();
  const client = new KurierClient();

  log.info(
    { circuit, targetChainId: cfg.BASE_SEPOLIA_CHAIN_ID },
    "e2e-start",
  );

  const receipt = await submitAndWait(client, circuit, {
    vkRegistered: true,
    chainId: cfg.BASE_SEPOLIA_CHAIN_ID,
    poll: { intervalMs: 5_000, timeoutMs: 25 * 60_000 },
  });

  log.info(
    {
      jobId: receipt.jobId,
      aggregationId: receipt.aggregationId,
      leaf: receipt.details.leaf,
      leafIndex: receipt.details.leafIndex,
      numberOfLeaves: receipt.details.numberOfLeaves,
      root: receipt.details.root,
    },
    "e2e-aggregated",
  );

  const onChain = await consumeOnChain(receipt);

  log.info(
    {
      txHash: onChain.txHash,
      blockNumber: onChain.blockNumber.toString(),
      gasUsed: onChain.gasUsed.toString(),
      circuitId: onChain.circuitId,
      domainId: onChain.domainId.toString(),
      aggregationId: onChain.aggregationId.toString(),
      leafIndex: onChain.leafIndex.toString(),
      explorer: `${cfg.BASE_SEPOLIA_EXPLORER}/tx/${onChain.txHash}`,
    },
    "e2e-consumed",
  );

  log.info({ circuit }, "T-8.1 PASS");
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "e2e-crash",
  );
  process.exitCode = 1;
});
