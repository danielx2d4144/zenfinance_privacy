import type { Pool } from "pg";
import type { z } from "zod";

import { getChainClients } from "../../chain/anvil.js";
import { ASSET_ID, type BorrowIntent } from "../schemas.js";
import type { IntentRow } from "../state.js";
import { SHIELDED_POSITION_POOL_ABI } from "./pool-abis.js";
import { verifyAndCall } from "./verify-and-call.js";

export async function handleBorrow(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof BorrowIntent>,
): Promise<void> {
  const { shieldedPositionPool } = getChainClients();
  await verifyAndCall({
    pool,
    intent,
    circuit: "borrow",
    proof: body.proofBundle.proof as `0x${string}`,
    publicInputs: body.proofBundle.publicInputs,
    target: shieldedPositionPool,
    targetAbi: SHIELDED_POSITION_POOL_ABI,
    targetFunction: "borrow",
    targetArgs: [
      ASSET_ID[body.asset],
      body.positionMove.oldPositionNullifier,
      body.positionMove.newPositionCommitment,
      body.newBalanceCommitment,
      BigInt(body.amount),
      body.positionMove.rootAtProveTime,
    ],
    rootArgIndex: 5,
  });
}
