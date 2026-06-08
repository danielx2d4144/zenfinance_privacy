import type { Pool } from "pg";
import type { z } from "zod";

import { getChainClients } from "../../chain/anvil.js";
import { ASSET_ID, type LiquidateIntent } from "../schemas.js";
import type { IntentRow } from "../state.js";
import { LIQUIDATION_BOARD_ABI } from "./pool-abis.js";
import { verifyAndCall } from "./verify-and-call.js";

export async function handleLiquidate(
  pool: Pool,
  intent: IntentRow,
  body: z.infer<typeof LiquidateIntent>,
): Promise<void> {
  const { liquidationBoard } = getChainClients();
  // newTriggers is an empty array for Day-14b; Day-15 (liquidator
  // board) wires real trigger updates.
  const newTriggers: readonly { assetId: number; triggerPrice1e8: bigint }[] = [];

  await verifyAndCall({
    pool,
    intent,
    circuit: "liquidate",
    proof: body.proofBundle.proof as `0x${string}`,
    publicInputs: body.proofBundle.publicInputs,
    target: liquidationBoard,
    targetAbi: LIQUIDATION_BOARD_ABI,
    targetFunction: "liquidate",
    targetArgs: [
      body.targetCommitment,
      body.residualCommitment,
      body.liquidatorBalanceCommitment,
      ASSET_ID[body.collateralAsset],
      ASSET_ID[body.debtAsset],
      BigInt(body.debtToCover),
      body.currentHealthFactorBps,
      newTriggers,
    ],
  });
}
