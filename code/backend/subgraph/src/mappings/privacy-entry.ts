import { BigInt } from "@graphprotocol/graph-ts";
import {
  Deposited,
  Withdrawn,
  BalanceSpent,
  BalanceCredited,
} from "../../generated/PrivacyEntry/PrivacyEntry";
import { Commitment } from "../../generated/schema";
import { commitmentId } from "../utils/ids";

/** Spec note: PrivacyEntry doesn't carry a leafIndex on Deposited (nextLeaf
 * is read separately). We index the inserted commitment and let downstream
 * REST consumers derive ordering from insertedAtBlock + tx/logIndex. */

export function handleDeposited(event: Deposited): void {
  const id = commitmentId(event.params.commitment);
  let c = Commitment.load(id);
  if (c == null) {
    c = new Commitment(id);
    c.pool = "ENTRY";
    // PrivacyEntry insertions don't carry an assetId — leave market null and
    // let the SUPPLY / POSITION pool insertions populate market binding.
    c.market = null;
    c.leafIndex = -1;
    c.insertedAt = event.block.timestamp;
    c.insertedAtBlock = event.block.number;
    c.insertedAtTx = event.transaction.hash;
    c.spent = false;
    c.spentAt = null;
    c.spentBy = null;
  }
  c.save();
}

export function handleBalanceCredited(event: BalanceCredited): void {
  // Same effect as Deposited from an indexer POV: a commitment shows up.
  const id = commitmentId(event.params.commitment);
  let c = Commitment.load(id);
  if (c == null) {
    c = new Commitment(id);
    c.pool = "ENTRY";
    c.market = null;
    c.leafIndex = -1;
    c.insertedAt = event.block.timestamp;
    c.insertedAtBlock = event.block.number;
    c.insertedAtTx = event.transaction.hash;
    c.spent = false;
    c.spentAt = null;
    c.spentBy = null;
  }
  c.save();
}

export function handleBalanceSpent(event: BalanceSpent): void {
  // BalanceSpent's parameter is a nullifier — not a commitment. Mark the
  // commitment(s) it consumed as spent by their nullifier. PrivacyEntry's
  // current event surface doesn't link nullifier -> commitment directly,
  // so we record the nullifier as an audit row for the REST layer to join.
  // Future improvement: PrivacyEntry could emit (nullifier, commitment).
  const _nf = event.params.nullifier;
  // No-op for Day-10; nullifier indexing entity arrives Day-11.
  // Keeping the handler wired ensures the manifest stays exhaustive.
  log_noop(event.block.number);
}

export function handleWithdrawn(event: Withdrawn): void {
  // Withdrawn carries a nullifier (spending) and an amount. Same caveat as
  // BalanceSpent: the link to a specific commitment isn't emitted, so we
  // leave Commitment.spent state alone for Day-10.
  const _nf = event.params.nullifier;
  log_noop(event.block.number);
}

/** No-op helper that AssemblyScript still type-checks. */
function log_noop(_n: BigInt): void { }
