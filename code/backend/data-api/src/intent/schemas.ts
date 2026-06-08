import { z } from "zod";

/**
 * Schemas for the 10 intent kinds (S13 §6). Each carries a `kind`
 * discriminator so a single POST /intents endpoint can accept the lot.
 *
 * `asset` is the symbol — the server maps it to an assetId via the
 * AssetRegistry. `amount` is a decimal string so big-integer values fit
 * without precision loss across JSON.
 */

const AssetSymbol = z.enum(["USDC", "cbBTC", "WETH", "ZEN"]);
const DecimalAmount = z.string().regex(/^\d+$/, "amount must be a non-negative integer string");
const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const HexBlob = z.string().regex(/^0x[a-fA-F0-9]+$/, "proof must be 0x-prefixed hex");

/**
 * ProofBundle — every non-deposit intent kind submits one. The dapp
 * computes the proof in a Web Worker via @aztec/bb.js; the handler
 * forwards it to Kurier for aggregation, then submits the aggregated
 * attestation to the corresponding pool contract.
 *
 * `publicInputs` mirrors the values the verifier expects. Order matters
 * — the verifier checks them positionally.
 */
const ProofBundle = z.object({
  proof: HexBlob,
  publicInputs: z.array(z.string()),
});

/**
 * On-chain call args. Each non-deposit intent kind also carries the
 * nullifiers + commitments + root the dapp computed when building the
 * witness; the handler relays these into the pool contract method.
 * Backed by the keccak-mirror local note state in the dapp until Day
 * 14c does the contract-side Pedersen swap.
 */
const BalanceMove = z.object({
  balanceNullifier: Bytes32,
  residualBalanceCommitment: Bytes32,
});

const PositionMove = z.object({
  oldPositionNullifier: Bytes32,
  newPositionCommitment: Bytes32,
  rootAtProveTime: Bytes32,
});

export const EntryDepositIntent = z.object({
  kind: z.literal("entry_deposit"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  commitment: Bytes32,
});

export const EntryWithdrawIntent = z.object({
  kind: z.literal("entry_withdraw"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  recipient: Address,
  nullifier: Bytes32,
  newCommitment: Bytes32,
  rootAtProveTime: Bytes32,
  proofBundle: ProofBundle,
});

export const SupplyIntent = z.object({
  kind: z.literal("supply"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  supplyCommitment: Bytes32,
  balanceMove: BalanceMove,
  proofBundle: ProofBundle,
});

export const WithdrawSupplyIntent = z.object({
  kind: z.literal("withdraw_supply"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  supplyNullifier: Bytes32,
  newBalanceCommitment: Bytes32,
  rootAtProveTime: Bytes32,
  proofBundle: ProofBundle,
});

export const DepositCollateralIntent = z.object({
  kind: z.literal("deposit_collateral"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  balanceMove: BalanceMove,
  positionMove: PositionMove,
  proofBundle: ProofBundle,
});

export const WithdrawCollateralIntent = z.object({
  kind: z.literal("withdraw_collateral"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  minHfBps: z.number().int().min(0).max(100_000).optional(),
  newBalanceCommitment: Bytes32,
  positionMove: PositionMove,
  proofBundle: ProofBundle,
});

export const BorrowIntent = z.object({
  kind: z.literal("borrow"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  minHfBps: z.number().int().min(0).max(100_000).optional(),
  newBalanceCommitment: Bytes32,
  positionMove: PositionMove,
  proofBundle: ProofBundle,
});

export const RepayIntent = z.object({
  kind: z.literal("repay"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  balanceMove: BalanceMove,
  positionMove: PositionMove,
  proofBundle: ProofBundle,
});

export const LiquidateIntent = z.object({
  kind: z.literal("liquidate"),
  targetCommitment: Bytes32,
  residualCommitment: Bytes32,
  liquidatorBalanceCommitment: Bytes32,
  collateralAsset: AssetSymbol,
  debtAsset: AssetSymbol,
  debtToCover: DecimalAmount,
  currentHealthFactorBps: z.number().int().min(0).max(10_000),
  proofBundle: ProofBundle,
});

export const ConsolidateBalanceIntent = z.object({
  kind: z.literal("consolidate_balance"),
  asset: AssetSymbol,
  proofBundle: ProofBundle,
});

export const AnyIntent = z.discriminatedUnion("kind", [
  EntryDepositIntent,
  EntryWithdrawIntent,
  SupplyIntent,
  WithdrawSupplyIntent,
  DepositCollateralIntent,
  WithdrawCollateralIntent,
  BorrowIntent,
  RepayIntent,
  LiquidateIntent,
  ConsolidateBalanceIntent,
]);

export type AnyIntentInput = z.infer<typeof AnyIntent>;
export type IntentKind = AnyIntentInput["kind"];

/** Day-N at which each non-entry-deposit intent kind becomes live.
 *  Day 14b is the inserted day that wires the 9 lending handlers through
 *  Kurier + zkVerify; see `design-v2/roadmap/code_roadmap.md` Day-14b. */
export const NOT_IMPLEMENTED_UNTIL: Record<Exclude<IntentKind, "entry_deposit">, string> = {
  entry_withdraw: "14b",
  supply: "14b",
  withdraw_supply: "14b",
  deposit_collateral: "14b",
  withdraw_collateral: "14b",
  borrow: "14b",
  repay: "14b",
  liquidate: "14b",
  consolidate_balance: "14b",
};

/** Symbol → on-chain assetId (per AssetRegistry). */
export const ASSET_ID: Record<z.infer<typeof AssetSymbol>, number> = {
  USDC: 0,
  cbBTC: 1,
  WETH: 2,
  ZEN: 3,
};
