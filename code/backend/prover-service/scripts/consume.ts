/**
 * Take an existing Kurier jobId, wait until it reaches AggregationPublished,
 * then call ZkVerifier.verifyAndConsume on-chain. Useful when you've already
 * paid for a Kurier submission and just need to drive it to a consume call
 * without re-submitting.
 *
 * Usage: npm run consume -- --jobId=<uuid> [--circuit=entry_deposit]
 */
import { KurierClient } from "../src/kurier/client.js";
import { CIRCUITS, type CircuitName } from "../src/circuits/registry.js";
import { classify } from "../src/pipeline/poll.js";
import { sleep } from "../src/kurier/retry.js";
import { consumeOnChain } from "../src/pipeline/consume.js";
import { getConfig } from "../src/config.js";
import { log } from "../src/log.js";

function parseArgs(): { jobId: string; circuit: CircuitName } {
  const jobArg = process.argv.find((a) => a.startsWith("--jobId="));
  const jobId = jobArg?.split("=")[1];
  if (!jobId) {
    throw new Error("Usage: npm run consume -- --jobId=<uuid> [--circuit=<name>]");
  }
  const cArg = process.argv.find((a) => a.startsWith("--circuit="));
  const circuit = (cArg?.split("=")[1] ?? "entry_deposit") as CircuitName;
  if (!CIRCUITS.some((c) => c.name === circuit)) {
    throw new Error(`Unknown circuit '${circuit}'`);
  }
  return { jobId, circuit };
}

async function main() {
  const { jobId, circuit } = parseArgs();
  const client = new KurierClient();
  const cfg = getConfig();

  log.info({ jobId, circuit }, "consume-only-start");

  const intervalMs = 15_000;
  const deadlineMs = Date.now() + 30 * 60_000;
  let lastStatus = "";

  while (Date.now() < deadlineMs) {
    let state;
    try {
      const res = await client.getJobStatus(jobId);
      state = classify(res);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        "consume-status-fetch-failed-will-retry",
      );
      await sleep(intervalMs);
      continue;
    }
    if (state.status !== lastStatus) {
      log.info({ jobId, status: state.status, kind: state.kind }, "kurier-status");
      lastStatus = state.status;
    }
    if (state.kind === "succeeded") {
      const receipt = {
        jobId,
        circuit,
        status: state.status,
        aggregationId: state.aggregationId,
        details: state.details,
      };
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
        "T-8.1 PASS",
      );
      return;
    }
    if (state.kind === "failed") {
      throw new Error(`Kurier job ${jobId} failed: ${state.error ?? "unknown"}`);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${jobId} to reach AggregationPublished`);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "consume-only-crash",
  );
  process.exitCode = 1;
});
