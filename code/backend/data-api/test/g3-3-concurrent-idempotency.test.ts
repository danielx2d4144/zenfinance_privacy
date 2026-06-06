/**
 * G3.3 — Idempotency under concurrent submissions.
 *
 * Steps: submit 10 identical intents in parallel with the same
 * Idempotency-Key.
 * Observe: all 10 responses share the same intent_id (I-REPLAY-3 holds).
 *
 * Spec also calls for "exactly one on-chain tx". The current API spawns
 * the handler from the FIRST winning POST; subsequent POSTs return the
 * cached envelope without firing a new handler. So we assert (a) one
 * intent_id, (b) exactly one final job row carrying the tx hash.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { LendingSdk } from "../../../sdks/sdk-ts/src/index";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";

describe("G3.3 — concurrent idempotent submissions", () => {
  it("10 parallel POSTs with the same key share intent_id and produce one tx", async () => {
    const sdk = new LendingSdk({ baseUrl: API_BASE_URL, apiKey: API_KEY });
    const commitment = `0x${randomBytes(32).toString("hex")}`;
    const key = `g3-3-${randomBytes(8).toString("hex")}`;
    const body = { kind: "entry_deposit", asset: "USDC", amount: "100000", commitment } as const;

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => sdk.intents.create(body, { idempotencyKey: key })),
    );
    const intentIds = new Set(responses.map((r) => r.intent_id));
    expect(intentIds.size).toBe(1);

    const intentId = [...intentIds][0]!;
    const final = await sdk.intents.waitFor(intentId);
    expect(final.status).toBe("confirmed");
    expect(final.jobs?.length).toBe(1);
    expect(final.jobs?.[0]?.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 60_000);
});
