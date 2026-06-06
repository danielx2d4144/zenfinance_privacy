/**
 * T-11.1 — POST /intents/{deposit kind}; poll until terminal state.
 *
 * Exercises the full lifecycle against the local Anvil chain:
 *   1) POST a fresh entry_deposit intent (random commitment).
 *   2) Receive 202 + UUID intent_id.
 *   3) Poll GET /v1/intents/{id} until status is `confirmed`.
 *   4) Assert the job row carries a tx hash and a positive gasUsed.
 *
 * Status path: received → proving → userop_pending → confirmed.
 * Failure path would terminate at `failed`; the test rejects on that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";

import { buildApp } from "../src/server";
import { getConfig } from "../src/config";
import { closePool, getPool } from "../src/db";

let app: FastifyInstance;
let apiKey: string;

beforeAll(async () => {
  apiKey = getConfig().API_KEY;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

interface IntentEnvelope {
  intent_id: string;
  status: string;
  failure_reason: string | null;
  jobs?: { tx_hash: string | null; status_payload: { txHash?: string; gasUsed?: string } }[];
}

async function poll(id: string, deadlineMs = 30_000): Promise<IntentEnvelope> {
  const start = Date.now();
  let last: IntentEnvelope | null = null;
  while (Date.now() - start < deadlineMs) {
    const r = await app.inject({
      method: "GET",
      url: `/v1/intents/${id}`,
      headers: { "x-api-key": apiKey },
    });
    expect(r.statusCode).toBe(200);
    last = r.json() as IntentEnvelope;
    if (last.status === "confirmed" || last.status === "failed") return last;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`intent ${id} did not terminate within ${deadlineMs}ms; last status=${last?.status}`);
}

describe("T-11.1 — entry_deposit intent reaches confirmed", () => {
  it("submits and finalises against local Anvil", async () => {
    const commitment = `0x${randomBytes(32).toString("hex")}`;
    const body = {
      kind: "entry_deposit",
      asset: "USDC",
      amount: "1234567",
      commitment,
    };

    const post = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      payload: body,
    });
    expect(post.statusCode).toBe(202);
    const envelope = post.json() as IntentEnvelope;
    expect(envelope.intent_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.status).toBe("received");

    const final = await poll(envelope.intent_id);
    if (final.status !== "confirmed") {
      // eslint-disable-next-line no-console
      console.error("final intent:", JSON.stringify(final, null, 2));
    }
    expect(final.status).toBe("confirmed");
    expect(final.jobs?.length).toBeGreaterThan(0);
    expect(final.jobs?.[0]?.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(final.jobs?.[0]?.status_payload?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(final.jobs?.[0]?.status_payload?.gasUsed ?? "0")).toBeGreaterThan(0n);
  }, 60_000);

  it("rejects missing X-API-Key with 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { "content-type": "application/json" },
      payload: { kind: "entry_deposit", asset: "USDC", amount: "1", commitment: `0x${"00".repeat(32)}` },
    });
    expect(r.statusCode).toBe(401);
    const body = r.json() as { code: string };
    expect(body.code).toBe("AUTH_INVALID");
  });
});

// Touch getPool so the post-test pool close has something to close.
void getPool();
