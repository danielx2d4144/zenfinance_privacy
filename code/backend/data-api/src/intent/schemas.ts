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
});

export const SupplyIntent = z.object({
  kind: z.literal("supply"),
  asset: AssetSymbol,
  amount: DecimalAmount,
});

export const WithdrawSupplyIntent = z.object({
  kind: z.literal("withdraw_supply"),
  asset: AssetSymbol,
  amount: DecimalAmount,
});

export const DepositCollateralIntent = z.object({
  kind: z.literal("deposit_collateral"),
  asset: AssetSymbol,
  amount: DecimalAmount,
});

export const WithdrawCollateralIntent = z.object({
  kind: z.literal("withdraw_collateral"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  minHfBps: z.number().int().min(0).max(100_000).optional(),
});

export const BorrowIntent = z.object({
  kind: z.literal("borrow"),
  asset: AssetSymbol,
  amount: DecimalAmount,
  minHfBps: z.number().int().min(0).max(100_000).optional(),
});

export const RepayIntent = z.object({
  kind: z.literal("repay"),
  asset: AssetSymbol,
  amount: DecimalAmount,
});

export const LiquidateIntent = z.object({
  kind: z.literal("liquidate"),
  targetCommitment: Bytes32,
  collateralAsset: AssetSymbol,
  debtAsset: AssetSymbol,
  debtToCover: DecimalAmount,
});

export const ConsolidateBalanceIntent = z.object({
  kind: z.literal("consolidate_balance"),
  asset: AssetSymbol,
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

/** Day-N at which each non-entry-deposit intent kind becomes live. */
export const NOT_IMPLEMENTED_UNTIL: Record<Exclude<IntentKind, "entry_deposit">, number> = {
  entry_withdraw: 13,
  supply: 13,
  withdraw_supply: 13,
  deposit_collateral: 13,
  withdraw_collateral: 13,
  borrow: 13,
  repay: 13,
  liquidate: 13,
  consolidate_balance: 13,
};

/** Symbol → on-chain assetId (per AssetRegistry). */
export const ASSET_ID: Record<z.infer<typeof AssetSymbol>, number> = {
  USDC: 0,
  cbBTC: 1,
  WETH: 2,
  ZEN: 3,
};
