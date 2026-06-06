/**
 * G3.1 — SDK-TS submits a deposit intent against the API; subgraph reflects.
 *
 * Steps (per system_check.md):
 *   1. SDK calls POST /v1/intents (entry_deposit).
 *   2. SDK polls until terminal state CONFIRMED.
 *   3. Query the local subgraph at /subgraphs/name/lending/anvil and assert
 *      the new Commitment id (== the deposit commitment) is indexed.
 *
 * Reads + writes the same Anvil chain the Day-10 docker stack runs.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { request } from "undici";
import { LendingSdk } from "../../../sdks/sdk-ts/src/index";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";
const SUBGRAPH = "http://localhost:8000/subgraphs/name/lending/anvil";

async function waitForCommitment(commitment: string, deadlineMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const r = await request(SUBGRAPH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ commitment(id: "${commitment}") { id pool } }`,
      }),
    });
    const body = (await r.body.json()) as {
      data?: { commitment: { id: string; pool: string } | null };
    };
    if (body.data?.commitment?.id === commitment) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

describe("G3.1 — SDK-TS deposit reflects in subgraph", () => {
  it("submits via SDK, confirms on-chain, subgraph indexes the commitment", async () => {
    const sdk = new LendingSdk({ baseUrl: API_BASE_URL, apiKey: API_KEY });
    const commitment = `0x${randomBytes(32).toString("hex")}`;

    const accepted = await sdk.intents.create(
      { kind: "entry_deposit", asset: "USDC", amount: "100000", commitment },
      { idempotencyKey: `g3-1-${randomBytes(8).toString("hex")}` },
    );
    const final = await sdk.intents.waitFor(accepted.intent_id);
    expect(final.status).toBe("confirmed");

    const indexed = await waitForCommitment(commitment.toLowerCase());
    expect(indexed, `subgraph did not index ${commitment}`).toBe(true);
  }, 90_000);
});
