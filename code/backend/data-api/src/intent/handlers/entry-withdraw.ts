import type { Pool } from "pg";
import type { z } from "zod";

import { getChainClients } from "../../chain/anvil.js";
import { type EntryWithdrawIntent } from "../schemas.js";
import { getCircuit } from "../vk-registry.js";
import type { IntentRow } from "../state.js";
import { PRIVACY_ENTRY_WITHDRAW_ABI } from "./pool-abis.js";
import { verifyAndCall } from "./verify-and-call.js";

export async function handleEntryWithdraw(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof EntryWithdrawIntent>,
): Promise<void> {
  const { privacyEntry, mockUsdc } = getChainClients();
  const circuit = getCircuit("entry_withdraw");

  await verifyAndCall({
    pool,
    intent,
    circuit: "entry_withdraw",
    proof: body.proofBundle.proof as `0x${string}`,
    publicInputs: body.proofBundle.publicInputs,
    target: privacyEntry,
    targetAbi: PRIVACY_ENTRY_WITHDRAW_ABI,
    targetFunction: "withdraw",
    targetArgs: [
      body.nullifier,
      body.newCommitment,
      // Day-14b ships only USDC withdrawals through this handler; other
      // assets land when AssetRegistry resolution is wired into the
      // dapp's asset selector.
      mockUsdc,
      body.recipient,
      BigInt(body.amount),
      body.rootAtProveTime,
      circuit.vkHash,
    ],
    rootArgIndex: 5,
  });
}
