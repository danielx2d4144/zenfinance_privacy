// Stage D.2 — TypeScript mirror of `code/contracts/src/libraries/PoseidonIMT.sol`.
//
// Depth-20 binary IMT, Tornado-style filledSubtrees, 32-deep history
// ring. Empty-subtree convention: zeros[0] = 0 (the Field zero-leaf the
// circuits assume), zeros[d] = poseidon2Hash2(zeros[d-1], zeros[d-1]).
// The empty-tree root + the one-leaf-at-zero root are pinned against
// the same Noir vectors used by `PoseidonIMT.t.sol`.
//
// API:
//   const imt = new LocalIMT();
//   const { idx, siblings, indexBits, newRoot } = imt.insert(leafBigInt);
//   imt.currentRoot();         // bigint
//   imt.known(rootBigInt);     // boolean — checks the 32-slot history
//
// Day 14c Stage D.

import { poseidon2Hash2 } from "./poseidon2.ts";

export const TREE_DEPTH = 20;
export const ROOT_HISTORY_SIZE = 32;

export interface InsertResult {
  /** Leaf index this insert landed at (0-based). */
  idx: number;
  /** Sibling at each depth; siblings[0] is the leaf-level sibling. */
  siblings: bigint[];
  /** Path bits, LSB = leaf level (1 = current was right child). */
  indexBits: boolean[];
  /** Root after this insert. */
  newRoot: bigint;
}

export class LocalIMT {
  /** Current root (initially the depth-20 empty-tree root). */
  private root: bigint;
  /** Next leaf slot to fill; bumps after every insert. */
  private next = 0;
  /** Ring-buffer pointer for the history slot to write next. */
  private nextHistory = 0;
  /** zeros[d] = empty-subtree root at depth d. */
  private readonly zeros: bigint[];
  /** filledSubtrees[d] = latest left-child node cached at depth d. */
  private readonly filled: bigint[];
  /** Ring buffer of the last ROOT_HISTORY_SIZE roots. */
  private readonly history: bigint[];

  constructor() {
    this.zeros = new Array<bigint>(TREE_DEPTH);
    this.filled = new Array<bigint>(TREE_DEPTH);
    this.history = new Array<bigint>(ROOT_HISTORY_SIZE).fill(0n);

    let z = 0n;
    for (let d = 0; d < TREE_DEPTH; d++) {
      this.zeros[d] = z;
      this.filled[d] = z;
      z = poseidon2Hash2(z, z);
    }
    // `z` after the loop is the depth-20 empty-tree root.
    this.root = z;
  }

  /** Current root of the local tree. */
  currentRoot(): bigint {
    return this.root;
  }

  /** Number of leaves inserted so far. */
  nextLeafIndex(): number {
    return this.next;
  }

  /** Empty-subtree root at depth `d` (read-only). */
  zerosAt(d: number): bigint {
    if (d < 0 || d >= TREE_DEPTH) throw new Error("LocalIMT.zerosAt: depth OOR");
    return this.zeros[d];
  }

  /**
   * Insert `leaf` and return the sibling path + new root. Matches
   * `PoseidonIMT.insert` byte-for-byte: filledSubtrees[d] gets the
   * current node when we pass through as a left child; gets read when
   * we pass through as a right child.
   */
  insert(leaf: bigint): InsertResult {
    if (this.next >= 1 << TREE_DEPTH) {
      throw new Error("LocalIMT.insert: tree full");
    }
    const idx = this.next;
    const siblings: bigint[] = new Array(TREE_DEPTH);
    const indexBits: boolean[] = new Array(TREE_DEPTH);

    let cur = leaf;
    let walk = idx;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const bit = (walk & 1) === 1;
      indexBits[d] = bit;
      if (!bit) {
        // left child: sibling is the empty subtree at this depth.
        siblings[d] = this.zeros[d];
        this.filled[d] = cur;
        cur = poseidon2Hash2(cur, this.zeros[d]);
      } else {
        // right child: sibling is the cached left node.
        siblings[d] = this.filled[d];
        cur = poseidon2Hash2(this.filled[d], cur);
      }
      walk >>= 1;
    }

    this.next = idx + 1;
    this.root = cur;
    this.history[this.nextHistory % ROOT_HISTORY_SIZE] = cur;
    this.nextHistory += 1;

    return { idx, siblings, indexBits, newRoot: cur };
  }

  /**
   * Is `root` in the 32-deep history ring? Mirrors
   * `PoseidonIMT.known(bytes32)` (returns false for the zero value).
   */
  known(root: bigint): boolean {
    if (root === 0n) return false;
    for (let i = 0; i < ROOT_HISTORY_SIZE; i++) {
      if (this.history[i] === root) return true;
    }
    return false;
  }
}
