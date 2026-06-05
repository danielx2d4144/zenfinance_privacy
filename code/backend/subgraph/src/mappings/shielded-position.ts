import { BigInt } from "@graphprotocol/graph-ts";
import {
  PositionUpdated,
  CollateralDeposited,
  CollateralWithdrawn,
  Borrowed,
  Repaid,
} from "../../generated/ShieldedPositionPool/ShieldedPositionPool";
import { Commitment } from "../../generated/schema";
import { commitmentId } from "../utils/ids";
import { getOrCreateMarket, recomputeUtilization } from "../utils/market";

export function handlePositionUpdated(event: PositionUpdated): void {
  // New position commitment lands as a leaf; old nullifier marks the previous
  // commitment as spent if we have it indexed.
  const newId = commitmentId(event.params.newCommitment);
  let c = Commitment.load(newId);
  if (c == null) {
    c = new Commitment(newId);
    c.pool = "POSITION";
    c.market = null;
    c.leafIndex = event.params.leafIndex;
    c.insertedAt = event.block.timestamp;
    c.insertedAtBlock = event.block.number;
    c.insertedAtTx = event.transaction.hash;
    c.spent = false;
    c.spentAt = null;
    c.spentBy = null;
    c.save();
  }
  // Mark old commitment spent by its nullifier (if we previously indexed it).
  // Day-10 caveat: positions don't expose the (nullifier -> commitment) link
  // directly on the event surface; downstream may join via the prover's
  // intent log. We still mark the new leaf and leave old spent state for the
  // attestation pipeline to set later.
}

export function handleCollateralDeposited(event: CollateralDeposited): void {
  // Reserve-side: this only changes pool-internal totals (no Market field in
  // S06 §3 mirrors per-asset collateral); CollateralDeposited stays a pure
  // analytics surface for the REST layer.
  // Wired to keep the manifest's event coverage complete.
}

export function handleCollateralWithdrawn(_event: CollateralWithdrawn): void {
  // See handleCollateralDeposited.
}

export function handleBorrowed(event: Borrowed): void {
  const m = getOrCreateMarket(event.params.assetId);
  m.totalBorrow = m.totalBorrow.plus(event.params.amount);
  m.utilizationBps = recomputeUtilization(m);
  m.save();
}

export function handleRepaid(event: Repaid): void {
  const m = getOrCreateMarket(event.params.assetId);
  if (m.totalBorrow.ge(event.params.amount)) {
    m.totalBorrow = m.totalBorrow.minus(event.params.amount);
  } else {
    m.totalBorrow = BigInt.zero();
  }
  m.utilizationBps = recomputeUtilization(m);
  m.save();
}
