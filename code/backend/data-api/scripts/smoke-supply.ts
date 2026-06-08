/**
 * Day-14b T-14b.1 smoke test (script form).
 *
 * Submits a `supply` intent through the SDK against a live data-API +
 * Anvil stack. Logs every intent status transition until terminal,
 * prints tx hash if confirmed.
 *
 * Honest about scope: the proof bytes are synthetic (the dapp's
 * Day-14 worker), the nullifier/commitment values are keccak-derived
 * placeholders, and the mock proxy bypasses real verification. We're
 * exercising the relayer-side leg end-to-end on Anvil so the dapp
 * has confidence the chain section moves state when buttons get
 * clicked.
 *
 * Usage (from data-api root):
 *   npx tsx scripts/smoke-supply.ts
 */
import { randomBytes } from "node:crypto";

import { LendingSdk } from "@lending/sdk-ts";

const API = process.env.API_BASE_URL ?? "http://127.0.0.1:8787";
const KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";

function hex(n: number): `0x${string}` {
  return `0x${randomBytes(n).toString("hex")}`;
}

async function main() {
  const sdk = new LendingSdk({ baseUrl: API, apiKey: KEY });

  const intent = await sdk.intents.create(
    {
      kind: "supply",
      asset: "USDC",
      amount: "100000",
      supplyCommitment: hex(32),
      balanceMove: {
        balanceNullifier: hex(32),
        residualBalanceCommitment: hex(32),
      },
      proofBundle: {
        proof: hex(440),
        publicInputs: ["100000"],
      },
    },
    { idempotencyKey: `smoke-${hex(8).slice(2)}` },
  );

  console.log(JSON.stringify({ stage: "accepted", ...intent }));

  const final = await sdk.intents.waitFor(intent.intent_id, {
    deadlineMs: 60_000,
    pollMs: 500,
  });

  console.log(
    JSON.stringify({
      stage: "terminal",
      status: final.status,
      failure_reason: final.failure_reason,
      txHash: final.jobs?.[0]?.tx_hash ?? null,
      gasUsed: (final.jobs?.[0]?.status_payload as { gasUsed?: string } | undefined)?.gasUsed ?? null,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
