import type { Pool } from "pg";
import type { z } from "zod";

import { getChainClients } from "../../chain/anvil.js";
import { ASSET_ID, type SupplyIntent } from "../schemas.js";
import type { IntentRow } from "../state.js";
import { SHIELDED_SUPPLY_POOL_ABI } from "./pool-abis.js";
import { verifyAndCall } from "./verify-and-call.js";

export async function handleSupply(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof SupplyIntent>,
): Promise<void> {
  const { shieldedSupplyPool } = getChainClients();
  await verifyAndCall({
    pool,
    intent,
    circuit: "supply_asset",
    proof: body.proofBundle.proof as `0x${string}`,
    publicInputs: body.proofBundle.publicInputs,
    target: shieldedSupplyPool,
    targetAbi: SHIELDED_SUPPLY_POOL_ABI,
    targetFunction: "supplyAsset",
    targetArgs: [
      ASSET_ID[body.asset],
      body.balanceMove.balanceNullifier,
      body.balanceMove.residualBalanceCommitment,
      body.supplyCommitment,
      BigInt(body.amount),
    ],
  });
}
