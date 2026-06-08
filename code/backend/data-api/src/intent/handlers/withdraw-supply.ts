import type { Pool } from "pg";
import type { z } from "zod";

import { getChainClients } from "../../chain/anvil.js";
import { ASSET_ID, type WithdrawSupplyIntent } from "../schemas.js";
import type { IntentRow } from "../state.js";
import { SHIELDED_SUPPLY_POOL_ABI } from "./pool-abis.js";
import { verifyAndCall } from "./verify-and-call.js";

export async function handleWithdrawSupply(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof WithdrawSupplyIntent>,
): Promise<void> {
  const { shieldedSupplyPool } = getChainClients();
  await verifyAndCall({
    pool,
    intent,
    circuit: "withdraw_supply",
    proof: body.proofBundle.proof as `0x${string}`,
    publicInputs: body.proofBundle.publicInputs,
    target: shieldedSupplyPool,
    targetAbi: SHIELDED_SUPPLY_POOL_ABI,
    targetFunction: "withdrawSupply",
    targetArgs: [
      ASSET_ID[body.asset],
      body.supplyNullifier,
      body.newBalanceCommitment,
      BigInt(body.amount),
      body.rootAtProveTime,
    ],
    rootArgIndex: 4,
  });
}
