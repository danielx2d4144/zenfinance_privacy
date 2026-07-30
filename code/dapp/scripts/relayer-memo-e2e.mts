/**
 * M2 close-out: memo deposit through the FULL relayer path.
 *
 *   dapp-side key derivation + memo encryption
 *     → POST /v1/intents (entry_deposit + encryptedMemo)
 *       → data-api relayer calls the 4-arg deposit overload
 *         → poll until confirmed
 *           → recovery scan finds the note from chain data alone.
 *
 * Run: npx tsx scripts/relayer-memo-e2e.mts   (stack must be up)
 */
import { createPublicClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  keyDerivationTypedData,
  sessionKeysFromSignature,
} from "../src/lib/key-derivation.ts";
import { encryptMemo, NoteType } from "../src/lib/memo-crypto.ts";
import { balanceCommitment, spendingPubkeyOf } from "../src/lib/witness.ts";
import { bigIntToHex32 } from "../src/lib/poseidon2.ts";
import { makeFetchLogs } from "../src/lib/recovery-adapter.ts";
import { RecoveryScanner, recoverNotes } from "../src/lib/recovery-scan.ts";

const API = "http://127.0.0.1:8787";
const API_KEY = "day11-local-test-api-key-please-rotate";
const RPC = "http://127.0.0.1:8545";
const PRIVACY_ENTRY = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address;
const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const account = privateKeyToAccount(ANVIL_KEY_0);
const client = createPublicClient({ chain: foundry, transport: http(RPC) });

// 1. Unlock ceremony
const bind = { address: account.address, chainId: foundry.id, privacyEntry: PRIVACY_ENTRY };
const sig = await account.signTypedData(keyDerivationTypedData(bind));
const keys = sessionKeysFromSignature(sig, bind);
const pubkey = spendingPubkeyOf(keys.spendingKey);

// 2. Note + memo
const amount = 777_000_000n; // 777 USDC
const salt = BigInt(`0x${crypto.getRandomValues(new Uint8Array(31)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`);
const commitment = bigIntToHex32(
  balanceCommitment({ assetId: 0n, amount, spendingPubkey: pubkey, salt }),
) as `0x${string}`;
const memo = await encryptMemo({
  viewingKey: keys.viewingKey,
  commitment,
  secrets: { noteType: NoteType.Balance, assetId: 0n, amount, salt },
});
const encryptedMemo = `0x${Buffer.from(memo).toString("hex")}`;

// 3. Submit intent through the REST API (relayer path)
const res = await fetch(`${API}/v1/intents`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": API_KEY,
    "Idempotency-Key": `memo-e2e-${commitment.slice(2, 18)}`,
  },
  body: JSON.stringify({
    kind: "entry_deposit",
    asset: "USDC",
    amount: amount.toString(),
    commitment,
    encryptedMemo,
  }),
});
if (res.status !== 202) {
  console.error("FAIL: intent rejected", res.status, await res.text());
  process.exit(1);
}
const { intent_id } = (await res.json()) as { intent_id: string };
console.log("intent accepted:", intent_id);

// 4. Poll to confirmed
let status = "";
for (let i = 0; i < 60; i++) {
  const poll = await fetch(`${API}/v1/intents/${intent_id}`, {
    headers: { "x-api-key": API_KEY },
  });
  const detail = (await poll.json()) as { status: string; failure_reason?: string };
  status = detail.status;
  if (status === "confirmed") break;
  if (status === "failed") {
    console.error("FAIL: intent failed:", detail.failure_reason);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (status !== "confirmed") {
  console.error("FAIL: intent never confirmed (last:", status, ")");
  process.exit(1);
}
console.log("intent confirmed on-chain via relayer");

// 5. Recovery from chain data alone
const scanner = new RecoveryScanner({
  fetchLogs: makeFetchLogs({ client, privacyEntry: PRIVACY_ENTRY }),
  scanFloor: 0n,
});
const view = await scanner.syncTo(await client.getBlockNumber());
const { notes } = await recoverNotes({
  view,
  viewingKey: keys.viewingKey,
  spendingKey: keys.spendingKey,
});
const found = notes.find((n) => n.leafHex === commitment.toLowerCase());
if (!found || found.preimage.amount !== amount || found.preimage.salt !== salt || found.spent) {
  console.error("FAIL: note not recovered correctly", found);
  process.exit(1);
}
console.log(
  `PASS: relayer memo deposit recovered — leafIdx=${found.preimage.leafIdx}, amount=${found.preimage.amount}, spent=${found.spent}`,
);
