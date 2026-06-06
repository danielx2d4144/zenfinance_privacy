/**
 * Day-12 SDK-TS deposit example.
 *
 * Submits an entry_deposit intent and polls until the protocol confirms it.
 * Mirrors T-12.1: "run `sdk-ts/examples/deposit.ts` against the running
 * API server; observe deposit succeeds".
 *
 * Usage:
 *   API_BASE_URL=http://localhost:8787 \
 *   API_KEY=day11-local-test-api-key-please-rotate \
 *   npm run example:deposit
 */
import { randomBytes } from "node:crypto";
import { LendingSdk } from "../src/index.js";

const BASE = process.env.API_BASE_URL ?? "http://localhost:8787";
const KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";

async function main() {
  const sdk = new LendingSdk({ baseUrl: BASE, apiKey: KEY });
  const commitment = `0x${randomBytes(32).toString("hex")}`;

  const accepted = await sdk.intents.create(
    {
      kind: "entry_deposit",
      asset: "USDC",
      amount: "100000",
      commitment,
    },
    { idempotencyKey: `sdk-ts-example-${randomBytes(8).toString("hex")}` },
  );
  console.log(JSON.stringify({ stage: "accepted", intent_id: accepted.intent_id, status: accepted.status }));

  const final = await sdk.intents.waitFor(accepted.intent_id);
  const job = final.jobs?.[0];
  console.log(JSON.stringify({
    stage: "terminal",
    status: final.status,
    intent_id: final.intent_id,
    failure_reason: final.failure_reason,
    txHash: job?.tx_hash,
    gasUsed: (job?.status_payload as { gasUsed?: string } | undefined)?.gasUsed,
  }));

  if (final.status !== "confirmed") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
