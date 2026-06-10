// Stage E.2 -- session-only note store.
//
// Each commitment leaf in PrivacyEntry / ShieldedSupplyPool /
// ShieldedPositionPool is the Poseidon2 hash of a structured preimage
// (BalanceNote / SupplyNote / Position). Circuits that consume a note
// (entry_withdraw, supply, withdraw_supply, deposit_collateral,
// withdraw_collateral, borrow, repay) need the preimage as PRIVATE
// witness so they can prove "I know the secret data this commitment
// commits to".
//
// This file stores those preimages in process memory only -- never
// localStorage, never IndexedDB, never IPFS. Cleared on disconnect,
// chain switch, or tab close. The full Day-17 deliverable adds
// encrypted IndexedDB persistence + Pinata/Filebase backup + recovery
// from wallet signature alone; for Stage E we just need the session
// to keep its preimages alive between an `insert` and the next
// circuit-bound spend.
//
// Lookup key: the leaf as a hex32 string (lower-case 0x-prefixed) so
// it round-trips bigint <-> on-chain bytes32 without loss.

import { bigIntToHex32 } from "./poseidon2.ts";
import type { Hex } from "viem";

export type NoteKind = "balance" | "supply" | "position";

/** Preimage of a BalanceNote (PrivacyEntry leaves). */
export interface BalanceNotePreimage {
  kind: "balance";
  /** Leaf index in PrivacyEntry's IMT. Required for proofFor() at spend time. */
  leafIdx: number;
  assetId: bigint;
  amount: bigint;
  salt: bigint;
}

/** Preimage of a SupplyNote (ShieldedSupplyPool leaves). */
export interface SupplyNotePreimage {
  kind: "supply";
  leafIdx: number;
  assetId: bigint;
  amount: bigint;
  supplyIndexAtDeposit: bigint;
  salt: bigint;
}

/** Preimage of a Position (ShieldedPositionPool leaves). */
export interface PositionPreimage {
  kind: "position";
  leafIdx: number;
  /** spending_pubkey captured at the time the position was sealed.
   *  Lets a spend reproduce the exact `Position` struct the circuit
   *  hashes even if the user later rotates their spending key. */
  spendingPubkey: bigint;
  collaterals: bigint[]; // length 8
  debts: bigint[]; // length 8
  borrowIndicesAtUpdate: bigint[]; // length 8
  salt: bigint;
}

export type NotePreimage =
  | BalanceNotePreimage
  | SupplyNotePreimage
  | PositionPreimage;

/**
 * Session-only note store. Backed by a plain Map so reads are O(1)
 * and there's no async surface to coordinate with React renders.
 * Instances are owned by `useSpendingKey` (alongside the LocalIMTs)
 * so they share the same lifecycle: created on key derivation,
 * thrown away on `clear()`.
 */
export class NoteStore {
  private readonly notes = new Map<string, NotePreimage>();
  /** Track insert order per kind so callers can `iter("position")` etc. */
  private readonly byKind: Record<NoteKind, Set<string>> = {
    balance: new Set(),
    supply: new Set(),
    position: new Set(),
  };

  /** Register the preimage of a freshly-inserted leaf. */
  register(leaf: bigint, preimage: NotePreimage): void {
    const key = bigIntToHex32(leaf);
    this.notes.set(key, preimage);
    this.byKind[preimage.kind].add(key);
  }

  /** Same as `register`, but accepts a hex32 directly. */
  registerHex(leafHex: Hex | string, preimage: NotePreimage): void {
    const key = normaliseHex(leafHex);
    this.notes.set(key, preimage);
    this.byKind[preimage.kind].add(key);
  }

  /** Mark a note as spent (forget its preimage). */
  forget(leaf: bigint | Hex | string): void {
    const key =
      typeof leaf === "bigint" ? bigIntToHex32(leaf) : normaliseHex(leaf);
    const preimage = this.notes.get(key);
    this.notes.delete(key);
    if (preimage) this.byKind[preimage.kind].delete(key);
  }

  /** Read the preimage of a leaf; returns undefined if unknown. */
  get(leaf: bigint | Hex | string): NotePreimage | undefined {
    const key =
      typeof leaf === "bigint" ? bigIntToHex32(leaf) : normaliseHex(leaf);
    return this.notes.get(key);
  }

  /** Typed convenience accessors -- enforce the discriminant at the boundary. */
  getBalance(leaf: bigint): BalanceNotePreimage | undefined {
    const p = this.get(leaf);
    return p?.kind === "balance" ? p : undefined;
  }

  getSupply(leaf: bigint): SupplyNotePreimage | undefined {
    const p = this.get(leaf);
    return p?.kind === "supply" ? p : undefined;
  }

  getPosition(leaf: bigint): PositionPreimage | undefined {
    const p = this.get(leaf);
    return p?.kind === "position" ? p : undefined;
  }

  /** Iterate all preimages of a given kind in insertion order. */
  *iter(kind: NoteKind): Generator<[string, NotePreimage]> {
    for (const key of this.byKind[kind]) {
      const preimage = this.notes.get(key);
      if (preimage) yield [key, preimage];
    }
  }

  /** Return the most recent leaf of the given kind, or undefined. */
  latest(kind: NoteKind): { leaf: string; preimage: NotePreimage } | undefined {
    let latest: { leaf: string; preimage: NotePreimage } | undefined;
    for (const [leaf, preimage] of this.iter(kind)) {
      latest = { leaf, preimage };
    }
    return latest;
  }

  /** Number of remembered preimages of a given kind. */
  size(kind: NoteKind): number {
    return this.byKind[kind].size;
  }

  /** Drop every preimage (called by `useSpendingKey.clear`). */
  reset(): void {
    this.notes.clear();
    this.byKind.balance.clear();
    this.byKind.supply.clear();
    this.byKind.position.clear();
  }
}

/** Build an empty (all-zero) Position struct -- the starting state for
 *  a fresh user before any depositCollateral has landed. The circuits'
 *  `depositCollateral` path accepts this via the `create_new` public
 *  switch; older callers just see all-zero collaterals/debts. */
export function emptyPositionPreimage(
  leafIdx: number,
  spendingPubkey: bigint,
  salt: bigint,
): PositionPreimage {
  return {
    kind: "position",
    leafIdx,
    spendingPubkey,
    collaterals: new Array(8).fill(0n),
    debts: new Array(8).fill(0n),
    borrowIndicesAtUpdate: new Array(8).fill(0n),
    salt,
  };
}

function normaliseHex(h: Hex | string): string {
  const s = typeof h === "string" ? h : (h as string);
  return s.toLowerCase().startsWith("0x") ? s.toLowerCase() : `0x${s.toLowerCase()}`;
}
