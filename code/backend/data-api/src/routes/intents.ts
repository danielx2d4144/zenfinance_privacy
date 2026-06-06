import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireApiKey } from "../auth.js";
import { getPool } from "../db.js";
import { lookupIdempotency, recordIdempotency } from "../idempotency.js";
import { handleEntryDeposit } from "../intent/handlers/entry-deposit.js";
import { handleStubbedIntent } from "../intent/handlers/stub.js";
import {
  AnyIntent,
  ASSET_ID,
  EntryDepositIntent,
  type AnyIntentInput,
} from "../intent/schemas.js";
import { getIntent, getJobsForIntent, insertIntent } from "../intent/state.js";

const ZERO_ADDRESS_BUF = Buffer.alloc(20);

function intentResponse(intent: { id: string; status: string; failure_reason: string | null }) {
  return {
    intent_id: intent.id,
    status: intent.status,
    failure_reason: intent.failure_reason,
  };
}

export async function registerIntentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/v1/intents")) {
      await requireApiKey(req, reply);
    }
  });

  app.post("/v1/intents", async (req, reply) => {
    const parsed = AnyIntent.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Invalid intent body",
        retryable: false,
        details: parsed.error.issues,
      });
      return;
    }
    const body: AnyIntentInput = parsed.data;
    const pool = getPool();

    const rawKey = req.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" ? rawKey : Array.isArray(rawKey) ? rawKey[0] : undefined;

    if (idempotencyKey) {
      const hit = await lookupIdempotency(pool, idempotencyKey);
      if (hit) {
        reply.code(hit.responseStatus).send(hit.responseBody);
        return;
      }
    }

    const intent = await insertIntent(pool, {
      // Day-11 doesn't ship SIWE; the owner address comes from the request
      // body for action surface that needs it, but the deposit path doesn't.
      accountAddress: ZERO_ADDRESS_BUF,
      kind: body.kind,
      assetId: body.kind === "liquidate"
        ? ASSET_ID[body.collateralAsset]
        : ASSET_ID[body.asset as keyof typeof ASSET_ID],
      amount: "amount" in body ? body.amount : null,
    });

    // Kick off the handler asynchronously; the response is 202 + intent_id
    // so the caller polls /v1/intents/{id} for status transitions.
    void runHandler(body, intent.id).catch((err) => app.log.error({ err }, "intent handler crash"));

    const responseBody = intentResponse(intent);
    if (idempotencyKey) {
      await recordIdempotency(pool, {
        key: idempotencyKey,
        intentId: intent.id,
        responseBody,
        responseStatus: 202,
      });
    }
    reply.code(202).send(responseBody);
  });

  app.get("/v1/intents/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) {
      reply.code(400).send({ code: "VALIDATION_ERROR", message: "intent id must be a uuid", retryable: false });
      return;
    }
    const pool = getPool();
    const intent = await getIntent(pool, params.data.id);
    if (!intent) {
      reply.code(404).send({ code: "NOT_FOUND", message: "intent not found", retryable: false });
      return;
    }
    const jobs = await getJobsForIntent(pool, intent.id);
    reply.send({
      ...intentResponse(intent),
      created_at: intent.created_at,
      updated_at: intent.updated_at,
      jobs: jobs.map((j) => ({
        id: j.id,
        tx_hash: j.tx_hash ? `0x${j.tx_hash.toString("hex")}` : null,
        status_payload: j.status_payload,
        created_at: j.created_at,
        updated_at: j.updated_at,
      })),
    });
  });
}

async function runHandler(body: AnyIntentInput, intentId: string): Promise<void> {
  const pool = getPool();
  const intent = await getIntent(pool, intentId);
  if (!intent) return;
  if (body.kind === "entry_deposit") {
    await handleEntryDeposit(pool, intent, EntryDepositIntent.parse(body));
    return;
  }
  await handleStubbedIntent(pool, intent);
}
