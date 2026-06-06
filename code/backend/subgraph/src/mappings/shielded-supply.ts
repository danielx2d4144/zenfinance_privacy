import { BigInt } from "@graphprotocol/graph-ts";
import {
  SupplyDeposited,
  SupplyWithdrawn,
} from "../../generated/ShieldedSupplyPool/ShieldedSupplyPool";
import { Commitment, Market } from "../../generated/schema";
import { commitmentId, marketIdFromAssetId } from "../utils/ids";
import { getOrCreateMarket } from "../utils/market";

export function handleSupplyDeposited(event: SupplyDeposited): void {
  // Index the new supply commitment.
  const id = commitmentId(event.params.supplyCommitment);
  let c = Commitment.load(id);
  if (c == null) {
    c = new Commitment(id);
    c.pool = "SUPPLY";
    c.market = marketIdFromAssetId(event.params.assetId);
    c.leafIndex = event.params.leafIndex.toI32();
    c.insertedAt = event.block.timestamp;
    c.insertedAtBlock = event.block.number;
    c.insertedAtTx = event.transaction.hash;
    c.spent = false;
    c.spentAt = null;
    c.spentBy = null;
    c.save();
  }
  // Roll up totals on the Market for utilisation math.
  const m = getOrCreateMarket(event.params.assetId);
  m.totalSupply = m.totalSupply.plus(event.params.amount);
  m.save();
}

export function handleSupplyWithdrawn(event: SupplyWithdrawn): void {
  // Mark the spent commitment if we can find it (matched by nullifier is not
  // possible without a (nullifier -> commitment) link; record on Market only).
  const m = getOrCreateMarket(event.params.assetId);
  if (m.totalSupply.ge(event.params.amount)) {
    m.totalSupply = m.totalSupply.minus(event.params.amount);
  } else {
    // Defensive: if a SupplyWithdrawn lands without a matching deposit being
    // indexed yet (re-org boundary), don't underflow. Settle at zero.
    m.totalSupply = BigInt.zero();
  }
  m.save();
}
