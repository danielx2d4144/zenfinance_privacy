/**
 * M3 Phase-0 gate: does the zkVerify aggregation path actually work on Horizen
 * testnet, and how long does it take?
 *
 * Everything downstream (the deploy, the un-stubbing of kurier-poll.ts, the
 * whole interaction model) assumes a proof submitted to Kurier with
 * `chainId = 2651420` eventually gets published to the Horizen aggregation
 * proxy under domain 175, and that `verifyProofAggregation` then returns true.
 * That has never been observed on Horizen — only on Base Sepolia (T-8.1).
 * This script observes it, or proves it doesn't happen.
 *
 * Unlike `e2e.ts` this does NOT consume on-chain: our ZkVerifier isn't deployed
 * to Horizen yet, and a read-only `verifyProofAggregation` on the proxy is the
 * exact predicate `ZkVerifier.verifyAndConsume` gates on anyway. So the receipt
 * stays unconsumed and remains usable by the Phase-1 deploy smoke test.
 *
 *   npm run probe:horizen -- --circuit=entry_deposit
 *
 * Emits a timing table (Queued → Valid → ... → Aggregated) so Phase 4 can
 * budget the UX against a measured number instead of a guess.
 */
import { createPublicClient, http, type Address, type Hex } from "viem";

import { KurierClient } from "../src/kurier/client.js";
import { CIRCUITS, type CircuitName } from "../src/circuits/registry.js";
import { submitAndWait } from "../src/pipeline/submit.js";
import type { JobState } from "../src/pipeline/types.js";
import { getConfig } from "../src/config.js";
import { log } from "../src/log.js";

const PROXY_ABI = [
  {
    type: "function",
    name: "verifyProofAggregation",
    stateMutability: "view",
    inputs: [
      { name: "domainId", type: "uint256" },
      { name: "aggregationId", type: "uint256" },
      { name: "leaf", type: "bytes32" },
      { name: "merklePath", type: "bytes32[]" },
      { name: "leafCount", type: "uint256" },
      { name: "leafIndex", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "AggregationPosted",
    inputs: [
      { name: "_domainId", type: "uint256", indexed: true },
      { name: "_aggregationId", type: "uint256", indexed: true },
      { name: "_proofsAggregation", type: "bytes32", indexed: false },
    ],
  },
] as const;

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

function parseTimeoutMinutes(): number {
  const arg = process.argv.find((a) => a.startsWith("--timeout-min="));
  const n = arg ? Number(arg.split("=")[1]) : 45;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad --timeout-min=${arg}`);
  return n;
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

async function main() {
  const circuit = parseCircuit();
  const timeoutMin = parseTimeoutMinutes();
  const cfg = getConfig();
  const client = new KurierClient();

  const chainId = cfg.HORIZEN_TESTNET_CHAIN_ID;
  const domainId = BigInt(cfg.ZKVERIFY_HORIZEN_DOMAIN_ID);
  const proxy = cfg.ZKVERIFY_PROXY_HORIZEN as Address;

  const publicClient = createPublicClient({
    transport: http(cfg.HORIZEN_TESTNET_HTTPS),
  });

  // Pre-flight: the proxy must have code, and we record where the chain head is
  // so we can bound the log scan for the AggregationPosted that carries us.
  const [code, startBlock, liveChainId] = await Promise.all([
    publicClient.getCode({ address: proxy }),
    publicClient.getBlockNumber(),
    publicClient.getChainId(),
  ]);
  if (!code || code === "0x") {
    throw new Error(`zkVerify proxy ${proxy} has no bytecode on ${cfg.HORIZEN_TESTNET_HTTPS}`);
  }
  if (liveChainId !== chainId) {
    throw new Error(`RPC reports chainId ${liveChainId}, expected ${chainId}`);
  }

  log.info(
    { circuit, chainId, domainId: domainId.toString(), proxy, startBlock: startBlock.toString(), timeoutMin },
    "probe-start",
  );

  // ------------------------------------------------------------ submit + time
  const t0 = Date.now();
  const marks: Array<{ status: string; atMs: number; sincePrevMs: number }> = [];
  let prevAt = t0;

  const receipt = await submitAndWait(client, circuit, {
    vkRegistered: true,
    chainId,
    poll: {
      intervalMs: 5_000,
      timeoutMs: timeoutMin * 60_000,
      onTransition: (_prev: JobState | null, next: JobState) => {
        const now = Date.now();
        marks.push({ status: next.status, atMs: now - t0, sincePrevMs: now - prevAt });
        prevAt = now;
        log.info({ status: next.status, elapsed: fmt(now - t0) }, "probe-transition");
      },
    },
  });

  const totalMs = Date.now() - t0;

  console.log("\n  Kurier status timeline (chainId " + chainId + ")");
  console.log("  " + "-".repeat(52));
  for (const m of marks) {
    console.log(
      `  ${m.status.padEnd(22)} +${fmt(m.atMs).padStart(8)}   (Δ ${fmt(m.sincePrevMs)})`,
    );
  }
  console.log("  " + "-".repeat(52));
  console.log(`  time to ${receipt.status}: ${fmt(totalMs)}\n`);

  log.info(
    {
      jobId: receipt.jobId,
      aggregationId: receipt.aggregationId,
      leaf: receipt.details.leaf,
      leafIndex: receipt.details.leafIndex,
      numberOfLeaves: receipt.details.numberOfLeaves,
      root: receipt.details.root,
      merklePathDepth: receipt.details.merkleProof.length,
    },
    "probe-aggregated",
  );

  // ------------------------------------------- did it land on the Horizen proxy?
  const endBlock = await publicClient.getBlockNumber();
  const posted = await publicClient
    .getLogs({
      address: proxy,
      event: PROXY_ABI[1],
      args: { _domainId: domainId, _aggregationId: BigInt(receipt.aggregationId) },
      fromBlock: startBlock,
      toBlock: endBlock,
    })
    .catch((err) => {
      log.warn({ err: String(err) }, "probe-getlogs-failed");
      return [];
    });

  if (posted.length > 0) {
    const ev = posted[0]!;
    log.info(
      {
        txHash: ev.transactionHash,
        blockNumber: ev.blockNumber?.toString(),
        root: (ev as unknown as { args: { _proofsAggregation: Hex } }).args._proofsAggregation,
        explorer: `${cfg.HORIZEN_EXPLORER}/tx/${ev.transactionHash}`,
      },
      "probe-aggregation-posted",
    );
  } else {
    log.warn(
      { fromBlock: startBlock.toString(), toBlock: endBlock.toString() },
      "probe-no-AggregationPosted-log-in-window — the receipt may still verify (published before we started watching)",
    );
  }

  // ------------------------------------------------ the predicate that matters
  const args = [
    domainId,
    BigInt(receipt.aggregationId),
    receipt.details.leaf as Hex,
    receipt.details.merkleProof as Hex[],
    BigInt(receipt.details.numberOfLeaves),
    BigInt(receipt.details.leafIndex),
  ] as const;

  const ok = (await publicClient.readContract({
    address: proxy,
    abi: PROXY_ABI,
    functionName: "verifyProofAggregation",
    args,
  })) as boolean;

  if (!ok) {
    // Control: if domain 175 is wrong, Base Sepolia's domain 2 is the other
    // candidate. Checking it turns "something is off" into a named cause.
    const controlArgs = [BigInt(cfg.ZKVERIFY_TESTNET_DOMAIN_ID), ...args.slice(1)] as unknown as typeof args;
    const control = await publicClient
      .readContract({
        address: proxy,
        abi: PROXY_ABI,
        functionName: "verifyProofAggregation",
        args: controlArgs,
      })
      .catch(() => false);
    log.error(
      { domainId: domainId.toString(), controlDomain: cfg.ZKVERIFY_TESTNET_DOMAIN_ID, controlResult: control },
      "probe-verify-FALSE",
    );
    throw new Error(
      `verifyProofAggregation returned false on ${proxy} for domain ${domainId}. ` +
        `Kurier said Aggregated but the destination chain does not have the root.`,
    );
  }

  console.log(`  PHASE 0 PASS — verifyProofAggregation() == true on Horizen testnet`);
  console.log(`  proxy       ${proxy}`);
  console.log(`  domain      ${domainId}`);
  console.log(`  aggregation ${receipt.aggregationId}  leaf ${receipt.details.leafIndex}/${receipt.details.numberOfLeaves}`);
  console.log(`  latency     ${fmt(totalMs)} to ${receipt.status}\n`);

  log.info({ circuit, totalMs, latency: fmt(totalMs) }, "PHASE-0 PASS");
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "probe-crash",
  );
  process.exitCode = 1;
});
