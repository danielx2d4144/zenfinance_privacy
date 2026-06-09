// Stage D.3 -- real Poseidon2 witness derivations matching
// `code/circuits/lib_common/src/lib.nr`.
//
// All commitments + nullifiers are computed exactly the way the
// circuits compute them, so the leaf the dapp inserts into its
// LocalIMT (and submits as part of an intent) is the same Field
// element the in-circuit `merkle_root` / nullifier checks reproduce
// once Stage E enables real bb.js proving.
//
// Day 14c Stage D. Note: positions in this scaffold occupy a single
// asset slot at index 0; the other MAX_ASSETS-1 slots are zero. That
// matches what a fresh deposit/borrow/etc. looks like before any
// other-asset activity. The shape (TAG | spending_pubkey | 8 collats |
// 8 debts | 8 indices | salt) stays exactly as `position_commitment`
// expects -- so once a user has multi-asset state, the same builder
// can take a real Position struct from the note store.

import type { Hex } from "viem";

import {
  BN254_FR,
  bigIntToHex32,
  hex32ToBigInt,
  poseidon2Hash,
} from "./poseidon2.ts";

// Domain-separation tags from lib_common::lib.nr.
const TAG_BALANCE_NOTE = 1n;
const TAG_SUPPLY_NOTE = 2n;
const TAG_POSITION_NOTE = 3n;
const TAG_SPENDING_PUBKEY = 10n;
const TAG_BALANCE_NULLIFIER = 21n;
const TAG_SUPPLY_NULLIFIER = 22n;
const TAG_POSITION_NULLIFIER = 23n;

export const MAX_ASSETS = 8;

// Stable AssetSymbol -> assetId mapping. Matches the ordering the
// backend handlers + AssetRegistry use on-chain. AssetSymbol "USDC"
// is asset 0, "cbBTC" is 1, etc. -- if the on-chain registry adds
// or reorders assets, update both sides together.
const ASSET_ID: Record<string, bigint> = {
  USDC: 0n,
  cbBTC: 1n,
  WETH: 2n,
  ZEN: 3n,
};

/** Convert an AssetSymbol to its Field-element assetId. */
export function assetIdOf(asset: string): bigint {
  const id = ASSET_ID[asset];
  if (id === undefined) throw new Error(`witness: unknown asset "${asset}"`);
  return id;
}

/** Generate a 254-ish-bit random salt inside the BN254 scalar field. */
export function randomSalt(): bigint {
  // 32 random bytes; reduce mod p. Bias from non-uniform reduction is
  // negligible for a per-note salt (the field is ~248 bits "wide" and
  // we only need uniqueness, not unbiased uniformity).
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let acc = 0n;
  for (let i = 0; i < bytes.length; i++) acc = (acc << 8n) | BigInt(bytes[i]);
  return acc % BN254_FR;
}

/** spending_pubkey_of(secret_key) == h([TAG_SPENDING_PUBKEY, secret_key]). */
export function spendingPubkeyOf(secretKey: bigint): bigint {
  return poseidon2Hash([TAG_SPENDING_PUBKEY, secretKey]);
}

// --- commitments ----------------------------------------------------------

/**
 * balance_commitment(BalanceNote) per lib_common::lib.nr:79.
 * Layout: h([TAG_BALANCE_NOTE, asset_id, amount, spending_pubkey, salt]).
 */
export function balanceCommitment(args: {
  assetId: bigint;
  amount: bigint;
  spendingPubkey: bigint;
  salt: bigint;
}): bigint {
  return poseidon2Hash([
    TAG_BALANCE_NOTE,
    args.assetId,
    args.amount,
    args.spendingPubkey,
    args.salt,
  ]);
}

/**
 * supply_commitment(SupplyNote) per lib_common::lib.nr:83.
 * Layout: h([TAG_SUPPLY_NOTE, asset_id, amount, supply_index_at_deposit,
 *           spending_pubkey, salt]).
 */
export function supplyCommitment(args: {
  assetId: bigint;
  amount: bigint;
  supplyIndexAtDeposit: bigint;
  spendingPubkey: bigint;
  salt: bigint;
}): bigint {
  return poseidon2Hash([
    TAG_SUPPLY_NOTE,
    args.assetId,
    args.amount,
    args.supplyIndexAtDeposit,
    args.spendingPubkey,
    args.salt,
  ]);
}

/**
 * position_commitment(Position) per lib_common::lib.nr:96.
 * 27-element buffer: TAG | spending_pubkey | collaterals[8] | debts[8] |
 *                    borrow_indices_at_update[8] | salt.
 */
export function positionCommitment(args: {
  spendingPubkey: bigint;
  collaterals: bigint[];
  debts: bigint[];
  borrowIndicesAtUpdate: bigint[];
  salt: bigint;
}): bigint {
  if (
    args.collaterals.length !== MAX_ASSETS ||
    args.debts.length !== MAX_ASSETS ||
    args.borrowIndicesAtUpdate.length !== MAX_ASSETS
  ) {
    throw new Error(
      `positionCommitment: expected ${MAX_ASSETS}-element arrays`,
    );
  }
  const buf: bigint[] = new Array(27);
  buf[0] = TAG_POSITION_NOTE;
  buf[1] = args.spendingPubkey;
  for (let i = 0; i < MAX_ASSETS; i++) {
    buf[2 + i] = args.collaterals[i];
    buf[2 + MAX_ASSETS + i] = args.debts[i];
    buf[2 + 2 * MAX_ASSETS + i] = args.borrowIndicesAtUpdate[i];
  }
  buf[26] = args.salt;
  return poseidon2Hash(buf);
}

/**
 * Convenience: build a Position with a single populated asset slot
 * (matching what depositCollateral / withdrawCollateral / borrow / repay
 * looks like before any other-asset activity).
 */
export function positionCommitmentSingleAsset(args: {
  spendingPubkey: bigint;
  assetId: bigint;
  collateral: bigint;
  debt: bigint;
  borrowIndexAtUpdate: bigint;
  salt: bigint;
}): bigint {
  const collats = new Array<bigint>(MAX_ASSETS).fill(0n);
  const debts = new Array<bigint>(MAX_ASSETS).fill(0n);
  const indices = new Array<bigint>(MAX_ASSETS).fill(0n);
  const slot = Number(args.assetId);
  if (slot < 0 || slot >= MAX_ASSETS) {
    throw new Error(`positionCommitmentSingleAsset: assetId ${slot} OOR`);
  }
  collats[slot] = args.collateral;
  debts[slot] = args.debt;
  indices[slot] = args.borrowIndexAtUpdate;
  return positionCommitment({
    spendingPubkey: args.spendingPubkey,
    collaterals: collats,
    debts,
    borrowIndicesAtUpdate: indices,
    salt: args.salt,
  });
}

// --- nullifiers -----------------------------------------------------------

/** balance_nullifier(secret_key, salt) per lib_common::lib.nr:115. */
export function balanceNullifier(secretKey: bigint, salt: bigint): bigint {
  return poseidon2Hash([TAG_BALANCE_NULLIFIER, secretKey, salt]);
}

/** supply_nullifier(secret_key, salt) per lib_common::lib.nr:119. */
export function supplyNullifier(secretKey: bigint, salt: bigint): bigint {
  return poseidon2Hash([TAG_SUPPLY_NULLIFIER, secretKey, salt]);
}

/** position_nullifier(secret_key, salt) per lib_common::lib.nr:123. */
export function positionNullifier(secretKey: bigint, salt: bigint): bigint {
  return poseidon2Hash([TAG_POSITION_NULLIFIER, secretKey, salt]);
}

// --- hex / bytes32 boundary ----------------------------------------------

/** Hex 0x-prefixed 32-byte representation (used by the intent SDK). */
export function toHex32(x: bigint): Hex {
  return bigIntToHex32(x);
}

/** Decode a 0x-prefixed 32-byte hex string into a Field-element bigint. */
export function fromHex32(h: Hex | string): bigint {
  return hex32ToBigInt(h as string);
}

export const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// Re-export for downstream call sites.
export { BN254_FR };
