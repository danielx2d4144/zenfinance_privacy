import { Aggregation } from "../../generated/schema";
import { ProofConsumed } from "../../generated/ZkVerifier/ZkVerifier";
import { aggregationId } from "../utils/ids";

/** Map IZkVerifier.CircuitId (uint8) to the schema's CircuitId enum string. */
function circuitIdString(circuit: i32): string {
  if (circuit == 0) return "ENTRY_DEPOSIT";
  if (circuit == 1) return "ENTRY_WITHDRAW";
  if (circuit == 2) return "SUPPLY_ASSET";
  if (circuit == 3) return "WITHDRAW_SUPPLY";
  if (circuit == 4) return "DEPOSIT_COLLATERAL";
  if (circuit == 5) return "WITHDRAW_COLLATERAL";
  if (circuit == 6) return "BORROW";
  if (circuit == 7) return "REPAY";
  if (circuit == 8) return "LIQUIDATE";
  if (circuit == 9) return "CONSOLIDATE_BALANCE";
  return "COMPUTE_TRIGGERS";
}

export function handleProofConsumed(event: ProofConsumed): void {
  const id = aggregationId(event.params.domainId, event.params.aggregationId, event.params.leafIndex);
  const a = new Aggregation(id);
  a.domainId = event.params.domainId.toI32();
  a.aggregationId = event.params.aggregationId;
  a.leafIndex = event.params.leafIndex;
  a.circuit = circuitIdString(event.params.circuitId);
  a.postedAt = event.block.timestamp;
  a.consumedTx = event.transaction.hash;
  a.blockNumber = event.block.number;
  a.save();
}
