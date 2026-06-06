/**
 * T-11.2 — Same Idempotency-Key + same body returns the same intent_id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";

import { buildApp } from "../src/server";
import { getConfig } from "../src/config";
import { closePool } from "../src/db";

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

describe("T-11.2 — Idempotency-Key replay returns same intent", () => {
  it("two POSTs with the same key resolve to the same intent_id", async () => {
    const commitment = `0x${randomBytes(32).toString("hex")}`;
    const body = {
      kind: "entry_deposit",
      asset: "USDC",
      amount: "100",
      commitment,
    };
    const key = `t11-2-${randomBytes(8).toString("hex")}`;

    const first = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { "x-api-key": apiKey, "content-type": "application/json", "idempotency-key": key },
      payload: body,
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { "x-api-key": apiKey, "content-type": "application/json", "idempotency-key": key },
      payload: body,
    });
    expect(second.statusCode).toBe(202);

    const a = first.json() as { intent_id: string };
    const b = second.json() as { intent_id: string };
    expect(a.intent_id).toBe(b.intent_id);
  });
});
