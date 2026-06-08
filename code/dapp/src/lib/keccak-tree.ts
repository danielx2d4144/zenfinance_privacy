import { keccak256, encodePacked, type Hex } from "viem";

/**
 * Local mirror of `PrivacyEntry._insertCommitment` (`code/contracts/src/PrivacyEntry.sol:233`)
 * and the same recipe in the shielded pools.
 *
 * On-chain today:
 *   newRoot = keccak256(abi.encodePacked(prevRoot, commitment, nextLeafIndex))
 *
 * TODO(day-14c): Day 6's deferred Pedersen swap replaces this with the
 * circuit-side Pedersen Merkle. Once that swap ships, this whole file
 * goes away — circuits compute the on-chain root directly.
 *
 * Until then, the dapp tracks notes created during the session and
 * recomputes the contract's root locally so:
 *   1. The intent body's `rootAtProveTime` matches the contract's
 *      `_knownRoot` lookup.
 *   2. The (placeholder) "I really own this envelope" proof shape can
 *      be filled with consistent values, even if not cryptographically
 *      bound to a Pedersen tree.
 */

export interface NoteLeaf {
  /** Commitment hex (32 bytes, `0x...`). */
  commitment: Hex;
  /** Insertion index — 0-based, matches contract's _nextLeafIndex AT insertion. */
  index: number;
}

const ZERO_ROOT: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Reconstruct the contract's `_currentRoot` after a sequence of inserts.
 * `notes` are in insertion order starting from leafIndex 0.
 */
export function computeRoot(notes: NoteLeaf[]): Hex {
  let root: Hex = ZERO_ROOT;
  for (const note of notes) {
    root = keccak256(
      encodePacked(["bytes32", "bytes32", "uint32"], [root, note.commitment, note.index]),
    );
  }
  return root;
}

/**
 * Project the root forward by inserting one more commitment without
 * mutating the input list — useful for predicting `rootAtProveTime`
 * the dapp will see as `_currentRoot` after its own deposit lands.
 */
export function projectRoot(notes: NoteLeaf[], next: NoteLeaf): Hex {
  return computeRoot([...notes, next]);
}
