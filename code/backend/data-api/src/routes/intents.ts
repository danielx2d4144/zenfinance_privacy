import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireApiKey } from "../auth.js";
import { getPool } from "../db.js";
import { claimIdempotency, persistIdempotencyBody } from "../idempotency.js";
import { handleBorrow } from "../intent/handlers/borrow.js";
import { handleConsolidateBalance } from "../intent/handlers/consolidate-balance.js";
import { handleDepositCollateral } from "../intent/handlers/deposit-collateral.js";
import { handleEntryDeposit } from "../intent/handlers/entry-deposit.js";
import { handleEntryWithdraw } from "../intent/handlers/entry-withdraw.js";
import { handleLiquidate } from "../intent/handlers/liquidate.js";
import { handleRepay } from "../intent/handlers/repay.js";
import { handleSupply } from "../intent/handlers/supply.js";
import { handleWithdrawCollateral } from "../intent/handlers/withdraw-collateral.js";
import { handleWithdrawSupply } from "../intent/handlers/withdraw-supply.js";
import {
  AnyIntent,
  ASSET_ID,
  BorrowIntent,
  ConsolidateBalanceIntent,
  DepositCollateralIntent,
  EntryDepositIntent,
  EntryWithdrawIntent,
  LiquidateIntent,
  RepayIntent,
  SupplyIntent,
  WithdrawCollateralIntent,
  WithdrawSupplyIntent,
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
    const idempotencyKey =
      typeof rawKey === "string" ? rawKey : Array.isArray(rawKey) ? rawKey[0] : undefined;

    const assetId =
      body.kind === "liquidate"
        ? ASSET_ID[body.collateralAsset]
        : ASSET_ID[body.asset as keyof typeof ASSET_ID];
    const amount = "amount" in body ? body.amount : null;

    let intentId: string;
    let responseBody: { intent_id: string; status: string; failure_reason: string | null };

    if (idempotencyKey) {
      // Atomic claim BEFORE we touch intents — race-safe.
      const proposed = randomUUID();
      const claim = await claimIdempotency(pool, {
        key: idempotencyKey,
        proposedIntentId: proposed,
        pendingBody: { intent_id: proposed, status: "received", failure_reason: null },
        pendingStatus: 202,
      });
      if (!claim.wonClaim) {
        const cached = claim.cached;
        if (cached) {
          reply.code(cached.responseStatus).send(cached.responseBody);
          return;
        }
        // Edge case: we lost but cached row vanished. Return the winning id
        // with a placeholder status so the caller can poll.
        reply.code(202).send({
          intent_id: claim.intentId,
          status: "received",
          failure_reason: null,
        });
        return;
      }
      const intent = await insertIntent(pool, {
        id: claim.intentId,
        accountAddress: ZERO_ADDRESS_BUF,
        kind: body.kind,
        assetId,
        amount,
      });
      intentId = intent.id;
      responseBody = intentResponse(intent);
      // Re-persist the body now that the intent row exists (mostly cosmetic
      // — the pending body already has the right shape).
      await persistIdempotencyBody(pool, idempotencyKey, responseBody, 202);
    } else {
      const intent = await insertIntent(pool, {
        accountAddress: ZERO_ADDRESS_BUF,
        kind: body.kind,
        assetId,
        amount,
      });
      intentId = intent.id;
      responseBody = intentResponse(intent);
    }

    void runHandler(body, intentId).catch((err) => app.log.error({ err }, "intent handler crash"));
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
  switch (body.kind) {
    case "entry_deposit":
      return handleEntryDeposit(pool, intent, EntryDepositIntent.parse(body));
    case "entry_withdraw":
      return handleEntryWithdraw(pool, intent, EntryWithdrawIntent.parse(body));
    case "supply":
      return handleSupply(pool, intent, SupplyIntent.parse(body));
    case "withdraw_supply":
      return handleWithdrawSupply(pool, intent, WithdrawSupplyIntent.parse(body));
    case "deposit_collateral":
      return handleDepositCollateral(pool, intent, DepositCollateralIntent.parse(body));
    case "withdraw_collateral":
      return handleWithdrawCollateral(pool, intent, WithdrawCollateralIntent.parse(body));
    case "borrow":
      return handleBorrow(pool, intent, BorrowIntent.parse(body));
    case "repay":
      return handleRepay(pool, intent, RepayIntent.parse(body));
    case "liquidate":
      return handleLiquidate(pool, intent, LiquidateIntent.parse(body));
    case "consolidate_balance":
      // ConsolidateBalanceIntent parsed only for shape validation; the
      // handler doesn't need the body since it's a Day-17 deferral.
      ConsolidateBalanceIntent.parse(body);
      return handleConsolidateBalance(pool, intent);
  }
}
