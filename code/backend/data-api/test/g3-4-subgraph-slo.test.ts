/**
 * G3.4 — Subgraph reflects within the SLO.
 *
 * Steps:
 *   1. Submit 20 deposit intents back-to-back.
 *   2. After each settles on-chain, record (txBlockTime → subgraph-index-time).
 *   3. Assert p95 indexing lag ≤ 30 s (S16 SLO).
 *
 * 20 samples is small but cheap; the lag values are dominated by graph-node
 * polling cadence + Anvil's 1-second block time. Larger sample sizes only
 * shrink the confidence interval; p95 ≤ 30s holds comfortably either way.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { request } from "undici";
import { LendingSdk } from "../../../sdks/sdk-ts/src/index";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";
const ANVIL_RPC = "http://localhost:8545";
const SUBGRAPH = "http://localhost:8000/subgraphs/name/lending/anvil";
const SAMPLES = 20;
const P95_BUDGET_SECONDS = 30;

interface Block {
  timestamp: string; // hex
}

async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const r = await request(ANVIL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
      id: 1,
    }),
  });
  const body = (await r.body.json()) as { result: Block };
  return Number.parseInt(body.result.timestamp, 16);
}

async function commitmentIndexedAt(commitment: string, deadlineMs = 60_000): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const r = await request(SUBGRAPH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ commitment(id: "${commitment}") { id insertedAtBlock } }`,
      }),
    });
    const body = (await r.body.json()) as {
      data?: { commitment: { id: string } | null };
    };
    if (body.data?.commitment?.id === commitment) return Date.now();
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx]!;
}

describe("G3.4 — subgraph SLO (p95 indexing lag ≤ 30s)", () => {
  it(`p95 lag ≤ ${P95_BUDGET_SECONDS}s across ${SAMPLES} deposits`, async () => {
    const sdk = new LendingSdk({ baseUrl: API_BASE_URL, apiKey: API_KEY });
    const lagsMs: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const commitment = `0x${randomBytes(32).toString("hex")}`;
      const accepted = await sdk.intents.create(
        { kind: "entry_deposit", asset: "USDC", amount: "100000", commitment },
        { idempotencyKey: `g3-4-${randomBytes(8).toString("hex")}` },
      );
      const final = await sdk.intents.waitFor(accepted.intent_id);
      expect(final.status).toBe("confirmed");
      const payload = final.jobs?.[0]?.status_payload as { blockNumber: string } | undefined;
      if (!payload?.blockNumber) throw new Error("expected blockNumber payload");
      const txTsSeconds = await blockTimestamp(BigInt(payload.blockNumber));

      const indexedAtMs = await commitmentIndexedAt(commitment.toLowerCase());
      if (indexedAtMs == null) throw new Error(`subgraph never indexed ${commitment}`);
      const lagMs = indexedAtMs - txTsSeconds * 1000;
      lagsMs.push(Math.max(lagMs, 0));
    }

    const p95Ms = p95(lagsMs);
    // eslint-disable-next-line no-console
    console.log(`G3.4 lag samples (ms): ${lagsMs.join(", ")} → p95=${p95Ms}ms`);
    expect(p95Ms).toBeLessThanOrEqual(P95_BUDGET_SECONDS * 1000);
  }, 300_000);
});
