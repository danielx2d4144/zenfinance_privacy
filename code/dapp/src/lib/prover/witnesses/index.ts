// Stage E.4 -- per-circuit witness builders.
//
// Each builder takes structured TypeScript inputs and produces the
// flat record bb.js's UltraHonkBackend.generateProof expects: a map
// from parameter name to either a hex32 string (for `field` inputs)
// or an array of hex32 strings (for `array` inputs). Struct inputs
// are flattened in the SAME order the Noir parameter declares
// (lib_common::lib.nr -- Position is `{ spending_pubkey, collaterals,
// debts, borrow_indices_at_update, salt }`).
//
// Builders match the ABI surveyed in Stage E.0; the parameter names
// and ordering here are load-bearing because bb.js takes the witness
// map by name. If a circuit's `main()` signature changes upstream,
// these builders need updating in lockstep.
//
// All Field inputs are normalised through bigIntToHex32 so the worker
// passes 0x-prefixed 32-byte hex to bb.js; that matches what the bb.js
// 3.x line accepts on the wire.

import { bigIntToHex32 } from "../../poseidon2.ts";
import type { InsertResult } from "../../imt.ts";
import type {
  BalanceNotePreimage,
  PositionPreimage,
  SupplyNotePreimage,
} from "../../note-store.ts";
import type { ChainSnapshot } from "../../chain-reader.ts";

export type Hex32 = `0x${string}`;
/**
 * Flat field/array/struct inputs Noir.js expects on `.execute()`.
 * Top-level keys mirror the circuit's `main()` parameter names; struct
 * inputs nest as records of `{fieldName: Hex32 | Hex32[]}`.
 */
export type WitnessValue = Hex32 | Hex32[] | Record<string, Hex32 | Hex32[]>;
export type WitnessMap = Record<string, WitnessValue>;

function f(x: bigint): Hex32 {
  return bigIntToHex32(x) as Hex32;
}
function fArr(xs: bigint[]): Hex32[] {
  return xs.map(f);
}
function bool(b: boolean): Hex32 {
  return f(b ? 1n : 0n);
}

// --- entry_deposit -------------------------------------------------------

export interface EntryDepositInputs {
  assetId: bigint;
  amount: bigint;
  commitment: bigint;
  spendingPubkey: bigint;
  salt: bigint;
}

export function buildEntryDepositWitness(i: EntryDepositInputs): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    amount: f(i.amount),
    commitment: f(i.commitment),
    // private
    spending_pubkey: f(i.spendingPubkey),
    salt: f(i.salt),
  };
}

// --- entry_withdraw ------------------------------------------------------

export interface EntryWithdrawInputs {
  assetId: bigint;
  root: bigint;
  nullifier: bigint;
  residualCommitment: bigint;
  amount: bigint;
  secretKey: bigint;
  oldNote: BalanceNotePreimage;
  newSalt: bigint;
  insert: InsertResult;
}

export function buildEntryWithdrawWitness(i: EntryWithdrawInputs): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root: f(i.root),
    nullifier: f(i.nullifier),
    residual_commitment: f(i.residualCommitment),
    amount: f(i.amount),
    // private
    secret_key: f(i.secretKey),
    old_amount: f(i.oldNote.amount),
    old_salt: f(i.oldNote.salt),
    new_salt: f(i.newSalt),
    merkle_siblings: fArr(i.insert.siblings),
    merkle_index_bits: i.insert.indexBits.map(bool),
  };
}

// --- supply_asset --------------------------------------------------------

export interface SupplyAssetInputs {
  assetId: bigint;
  rootBalance: bigint;
  balanceNullifier: bigint;
  residualBalanceCommitment: bigint;
  supplyCommitment: bigint;
  amount: bigint;
  supplyIndexNow: bigint;
  secretKey: bigint;
  oldBalance: BalanceNotePreimage;
  newBalanceSalt: bigint;
  newSupplySalt: bigint;
  balanceInsert: InsertResult;
}

export function buildSupplyWitness(i: SupplyAssetInputs): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_balance: f(i.rootBalance),
    balance_nullifier_pub: f(i.balanceNullifier),
    residual_balance_commitment: f(i.residualBalanceCommitment),
    supply_commitment_pub: f(i.supplyCommitment),
    amount: f(i.amount),
    supply_index_now: f(i.supplyIndexNow),
    // private
    secret_key: f(i.secretKey),
    old_balance_amount: f(i.oldBalance.amount),
    old_balance_salt: f(i.oldBalance.salt),
    new_balance_salt: f(i.newBalanceSalt),
    new_supply_salt: f(i.newSupplySalt),
    balance_siblings: fArr(i.balanceInsert.siblings),
    balance_index_bits: i.balanceInsert.indexBits.map(bool),
  };
}

// --- withdraw_supply -----------------------------------------------------

export interface WithdrawSupplyInputs {
  assetId: bigint;
  rootSupply: bigint;
  supplyNullifier: bigint;
  newBalanceCommitment: bigint;
  amount: bigint;
  supplyIndexNow: bigint;
  secretKey: bigint;
  oldSupply: SupplyNotePreimage;
  newBalanceSalt: bigint;
  supplyInsert: InsertResult;
}

export function buildWithdrawSupplyWitness(
  i: WithdrawSupplyInputs,
): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_supply: f(i.rootSupply),
    supply_nullifier_pub: f(i.supplyNullifier),
    new_balance_commitment: f(i.newBalanceCommitment),
    amount: f(i.amount),
    supply_index_now: f(i.supplyIndexNow),
    // private
    secret_key: f(i.secretKey),
    note_amount: f(i.oldSupply.amount),
    idx_at_deposit: f(i.oldSupply.supplyIndexAtDeposit),
    old_supply_salt: f(i.oldSupply.salt),
    new_balance_salt: f(i.newBalanceSalt),
    supply_siblings: fArr(i.supplyInsert.siblings),
    supply_index_bits: i.supplyInsert.indexBits.map(bool),
  };
}

// --- deposit_collateral --------------------------------------------------

export interface DepositCollateralInputs {
  assetId: bigint;
  rootBalance: bigint;
  rootPosition: bigint;
  balanceNullifier: bigint;
  positionNullifier: bigint;
  residualBalanceCommitment: bigint;
  newPositionCommitment: bigint;
  amount: bigint;
  /** 1 when creating a brand-new position; 0 when updating one. */
  createNew: boolean;
  secretKey: bigint;
  oldBalance: BalanceNotePreimage;
  newBalanceSalt: bigint;
  oldPosition: PositionPreimage;
  /** spending_pubkey snapshot embedded in the Position struct.
   *  Stored alongside the position preimage in the note store so a
   *  spending-key derivation refresh doesn't break the witness. */
  oldPositionSpendingPubkey: bigint;
  newPositionSalt: bigint;
  balanceInsert: InsertResult;
  positionInsert: InsertResult;
}

export function buildDepositCollateralWitness(
  i: DepositCollateralInputs,
): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_balance: f(i.rootBalance),
    root_position: f(i.rootPosition),
    balance_nullifier_pub: f(i.balanceNullifier),
    position_nullifier_pub: f(i.positionNullifier),
    residual_balance_commitment: f(i.residualBalanceCommitment),
    new_position_commitment: f(i.newPositionCommitment),
    amount: f(i.amount),
    create_new: bool(i.createNew),
    // private
    secret_key: f(i.secretKey),
    old_balance_amount: f(i.oldBalance.amount),
    old_balance_salt: f(i.oldBalance.salt),
    new_balance_salt: f(i.newBalanceSalt),
    // Position struct flattened in lib_common::Position field order.
    old_position: flattenPosition(i.oldPosition, i.oldPositionSpendingPubkey),
    new_position_salt: f(i.newPositionSalt),
    balance_siblings: fArr(i.balanceInsert.siblings),
    balance_index_bits: i.balanceInsert.indexBits.map(bool),
    position_siblings: fArr(i.positionInsert.siblings),
    position_index_bits: i.positionInsert.indexBits.map(bool),
  };
}

// --- withdraw_collateral -------------------------------------------------

export interface WithdrawCollateralInputs {
  assetId: bigint;
  rootPosition: bigint;
  oldPositionNullifier: bigint;
  newPositionCommitment: bigint;
  newBalanceCommitment: bigint;
  amount: bigint;
  snapshot: ChainSnapshot;
  secretKey: bigint;
  oldPosition: PositionPreimage;
  oldPositionSpendingPubkey: bigint;
  newPositionSalt: bigint;
  newBalanceSalt: bigint;
  positionInsert: InsertResult;
  accruedDebts: bigint[];
  accrualRemainders: bigint[];
}

export function buildWithdrawCollateralWitness(
  i: WithdrawCollateralInputs,
): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_position: f(i.rootPosition),
    old_position_nullifier_pub: f(i.oldPositionNullifier),
    new_position_commitment: f(i.newPositionCommitment),
    new_balance_commitment: f(i.newBalanceCommitment),
    amount: f(i.amount),
    current_prices: fArr(i.snapshot.prices),
    current_borrow_indices: fArr(i.snapshot.borrowIndices),
    lt_bps: fArr(i.snapshot.ltBps),
    // private
    secret_key: f(i.secretKey),
    old_position: flattenPosition(i.oldPosition, i.oldPositionSpendingPubkey),
    new_position_salt: f(i.newPositionSalt),
    new_balance_salt: f(i.newBalanceSalt),
    merkle_siblings: fArr(i.positionInsert.siblings),
    merkle_index_bits: i.positionInsert.indexBits.map(bool),
    accrued_debts: fArr(i.accruedDebts),
    accrual_remainders: fArr(i.accrualRemainders),
  };
}

// --- borrow --------------------------------------------------------------

export interface BorrowInputs {
  assetId: bigint;
  rootPosition: bigint;
  oldPositionNullifier: bigint;
  newPositionCommitment: bigint;
  newBalanceCommitment: bigint;
  amount: bigint;
  snapshot: ChainSnapshot;
  secretKey: bigint;
  oldPosition: PositionPreimage;
  oldPositionSpendingPubkey: bigint;
  newPositionSalt: bigint;
  newBalanceSalt: bigint;
  positionInsert: InsertResult;
  accruedDebts: bigint[];
  accrualRemainders: bigint[];
}

export function buildBorrowWitness(i: BorrowInputs): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_position: f(i.rootPosition),
    old_position_nullifier_pub: f(i.oldPositionNullifier),
    new_position_commitment: f(i.newPositionCommitment),
    new_balance_commitment: f(i.newBalanceCommitment),
    amount: f(i.amount),
    current_prices: fArr(i.snapshot.prices),
    current_borrow_indices: fArr(i.snapshot.borrowIndices),
    ltv_bps: fArr(i.snapshot.ltvBps),
    // private
    secret_key: f(i.secretKey),
    old_position: flattenPosition(i.oldPosition, i.oldPositionSpendingPubkey),
    new_position_salt: f(i.newPositionSalt),
    new_balance_salt: f(i.newBalanceSalt),
    merkle_siblings: fArr(i.positionInsert.siblings),
    merkle_index_bits: i.positionInsert.indexBits.map(bool),
    accrued_debts: fArr(i.accruedDebts),
    accrual_remainders: fArr(i.accrualRemainders),
  };
}

// --- repay ---------------------------------------------------------------

export interface RepayInputs {
  assetId: bigint;
  rootBalance: bigint;
  rootPosition: bigint;
  balanceNullifier: bigint;
  positionNullifier: bigint;
  residualBalanceCommitment: bigint;
  newPositionCommitment: bigint;
  amount: bigint;
  snapshot: ChainSnapshot;
  secretKey: bigint;
  oldBalance: BalanceNotePreimage;
  newBalanceSalt: bigint;
  oldPosition: PositionPreimage;
  oldPositionSpendingPubkey: bigint;
  newPositionSalt: bigint;
  balanceInsert: InsertResult;
  positionInsert: InsertResult;
  accruedDebts: bigint[];
  accrualRemainders: bigint[];
}

export function buildRepayWitness(i: RepayInputs): WitnessMap {
  return {
    // public
    asset_id: f(i.assetId),
    root_balance: f(i.rootBalance),
    root_position: f(i.rootPosition),
    balance_nullifier_pub: f(i.balanceNullifier),
    position_nullifier_pub: f(i.positionNullifier),
    residual_balance_commitment: f(i.residualBalanceCommitment),
    new_position_commitment: f(i.newPositionCommitment),
    amount: f(i.amount),
    current_borrow_indices: fArr(i.snapshot.borrowIndices),
    // private
    secret_key: f(i.secretKey),
    old_balance_amount: f(i.oldBalance.amount),
    old_balance_salt: f(i.oldBalance.salt),
    new_balance_salt: f(i.newBalanceSalt),
    old_position: flattenPosition(i.oldPosition, i.oldPositionSpendingPubkey),
    new_position_salt: f(i.newPositionSalt),
    balance_siblings: fArr(i.balanceInsert.siblings),
    balance_index_bits: i.balanceInsert.indexBits.map(bool),
    position_siblings: fArr(i.positionInsert.siblings),
    position_index_bits: i.positionInsert.indexBits.map(bool),
    accrued_debts: fArr(i.accruedDebts),
    accrual_remainders: fArr(i.accrualRemainders),
  };
}

// --- shared helpers ------------------------------------------------------

/**
 * Flatten a Position struct in the same field order
 * `lib_common::Position` declares (spending_pubkey, collaterals[8],
 * debts[8], borrow_indices_at_update[8], salt). bb.js expects
 * struct-typed witness inputs as a single object with named members.
 */
function flattenPosition(
  p: PositionPreimage,
  spendingPubkey: bigint,
): Record<string, Hex32 | Hex32[]> {
  return {
    spending_pubkey: f(spendingPubkey),
    collaterals: fArr(p.collaterals),
    debts: fArr(p.debts),
    borrow_indices_at_update: fArr(p.borrowIndicesAtUpdate),
    salt: f(p.salt),
  };
}
