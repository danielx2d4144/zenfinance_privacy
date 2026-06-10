"use client";

import { useMemo, useState } from "react";

import { useProver } from "@/hooks/useProver";
import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";
import { toUnits } from "@/lib/units";

import { AssetSelector, ASSET_DECIMALS, type AssetSymbol } from "./AssetSelector";
import { ConnectGate } from "./ConnectGate";
import { ProofProgressModal, type ProofStage } from "./ProofProgressModal";

import { LocalIMT } from "@/lib/imt.ts";
import {
  assetIdOf,
  balanceCommitment,
  balanceNullifier,
  positionCommitment,
  positionNullifier,
  randomSalt,
  supplyCommitment,
  supplyNullifier,
  toHex32,
  ZERO_BYTES32,
} from "@/lib/witness.ts";
import {
  computeAccrualHints,
  readChainSnapshot,
  MAX_ASSETS,
} from "@/lib/chain-reader.ts";
import {
  emptyPositionPreimage,
  type BalanceNotePreimage,
  type NoteStore,
  type PositionPreimage,
  type SupplyNotePreimage,
} from "@/lib/note-store.ts";
import {
  buildBorrowWitness,
  buildDepositCollateralWitness,
  buildRepayWitness,
  buildSupplyWitness,
  buildWithdrawCollateralWitness,
  buildWithdrawSupplyWitness,
  type WitnessMap,
} from "@/lib/prover/witnesses";
import type { CircuitKind } from "@/lib/prover/types";

import { LendingSdk, type AnyIntentInput, type IntentDetail } from "@lending/sdk-ts";

export type LendingFormKind =
  | "supply"
  | "withdraw_supply"
  | "deposit_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay";

const COPY: Record<LendingFormKind, { title: string; verb: string; subtitle: string; usesHfFloor: boolean }> = {
  supply: {
    title: "Supply",
    verb: "Supply",
    subtitle: "Deposit an asset from PrivacyEntry balance into the supply pool to earn yield.",
    usesHfFloor: false,
  },
  withdraw_supply: {
    title: "Withdraw supply",
    verb: "Withdraw",
    subtitle: "Pull a supplied position back to PrivacyEntry balance.",
    usesHfFloor: false,
  },
  deposit_collateral: {
    title: "Deposit collateral",
    verb: "Deposit",
    subtitle: "Move an asset from PrivacyEntry balance into the position pool as collateral.",
    usesHfFloor: false,
  },
  withdraw_collateral: {
    title: "Withdraw collateral",
    verb: "Withdraw",
    subtitle: "Withdraw collateral subject to the position's HF floor.",
    usesHfFloor: true,
  },
  borrow: {
    title: "Borrow",
    verb: "Borrow",
    subtitle: "Borrow against your collateral; respects the policy HF floor.",
    usesHfFloor: true,
  },
  repay: {
    title: "Repay",
    verb: "Repay",
    subtitle: "Repay debt for the named asset.",
    usesHfFloor: false,
  },
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export function LendingForm({ kind }: { kind: LendingFormKind }) {
  const { isConnected, isCorrectChain, defaultChain, switchToDefault, switchStatus } = useWallet();
  const {
    secretKey,
    spendingPubkey,
    entryImt,
    supplyImt,
    positionImt,
    noteStore,
  } = useSpendingKey();
  const { tier, isProving, prove } = useProver();

  const [asset, setAsset] = useState<AssetSymbol>("USDC");
  const [amount, setAmount] = useState("100");
  const [minHfBps, setMinHfBps] = useState("12000");

  const [stage, setStage] = useState<ProofStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const sdk = useMemo(() => new LendingSdk({ baseUrl: API_BASE, apiKey: API_KEY }), []);
  const copy = COPY[kind];

  if (!isConnected) return <ConnectGate message="Connect a wallet to continue." />;
  if (!isCorrectChain)
    return (
      <ConnectGate message={`Switch to ${defaultChain.name} to continue.`}>
        <button
          type="button"
          onClick={() => switchToDefault()}
          disabled={switchStatus === "pending"}
          className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-50"
        >
          {switchStatus === "pending" ? "Switching…" : `Switch to ${defaultChain.name}`}
        </button>
      </ConnectGate>
    );
  if (!secretKey || !spendingPubkey)
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm">
        <p className="text-amber-100/90">
          Spending key not derived yet. Visit the PrivacyEntry page and click
          “Sign to derive spending key” first.
        </p>
      </div>
    );

  const isBusy =
    stage === "proving" ||
    stage === "submitting" ||
    stage === "aggregating" ||
    stage === "posting";

  const closeModal = () => {
    setStage("idle");
    setErrorMessage(null);
    setTxHash(null);
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setStage("proving");
    setErrorMessage(null);
    setTxHash(null);

    try {
      const amountUnits = toUnits(amount, ASSET_DECIMALS[asset]);
      const built = await prepareIntent(kind, {
        asset,
        amountUnits,
        minHfBps,
        secretKey: secretKey!,
        spendingPubkey: spendingPubkey!,
        entryImt,
        supplyImt,
        positionImt,
        noteStore,
      });

      const proofResult = await prove(built.proveKind, {
        witnessMap: built.witnessMap,
        publicInputs: built.publicInputs,
      });

      setStage("submitting");
      const body = built.bodyBuilder({
        proof: proofResult.proof,
        publicInputs: proofResult.publicInputs.length > 0
          ? proofResult.publicInputs
          : built.publicInputs,
      });

      const accepted = await sdk.intents.create(body, {
        idempotencyKey: `dapp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });

      setStage("aggregating");
      const final: IntentDetail = await sdk.intents.waitFor(accepted.intent_id, {
        deadlineMs: 6 * 60 * 1000,
        pollMs: 1000,
      });

      if (final.status === "confirmed") {
        built.onConfirmed();
        setStage("posting");
        setTxHash(final.jobs?.[0]?.tx_hash ?? null);
        await new Promise((res) => setTimeout(res, 250));
        setStage("confirmed");
      } else {
        setStage("failed");
        setErrorMessage(final.failure_reason ?? "unknown failure");
      }
    } catch (err) {
      setStage("failed");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} className="rounded-lg border border-white/10 bg-white/5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm text-white/60">{copy.subtitle}</p>
          </div>
          <span
            className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/60"
            title="Device tier from S17 §3 — high tier proves in-browser; low tier routes through server-assist."
          >
            prover: {tier}
          </span>
        </header>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AssetSelector value={asset} onChange={setAsset} disabled={isBusy} />
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-white/60">
              Amount ({asset})
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isBusy}
              className="mt-2 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
            />
          </label>
        </div>

        {copy.usesHfFloor ? (
          <label className="mt-4 block">
            <span className="block text-xs font-medium uppercase tracking-wide text-white/60">
              Min health factor (bps, 0-100000)
            </span>
            <input
              inputMode="numeric"
              value={minHfBps}
              onChange={(e) => setMinHfBps(e.target.value)}
              disabled={isBusy}
              className="mt-2 w-40 rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
            />
            <span className="mt-1 block text-xs text-white/40">
              12000 ≈ HF 1.20. Tx reverts if the resulting HF dips below this.
            </span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={isBusy || !amount}
          className="mt-5 rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {isProving ? "Proving…" : isBusy ? `${copy.verb}ing…` : copy.verb}
        </button>
      </form>

      <ProofProgressModal
        stage={stage}
        errorMessage={errorMessage ?? undefined}
        txHash={txHash}
        onClose={closeModal}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Intent + witness preparation
// ---------------------------------------------------------------------------

interface PreparedIntent {
  /** Circuit kind for the prover. */
  proveKind: CircuitKind;
  /** Witness map handed to Noir.js. */
  witnessMap: WitnessMap;
  /** Public inputs in the order the circuit declares them (for the SDK body). */
  publicInputs: string[];
  /** Build the intent body once a proof has come back. */
  bodyBuilder: (proof: { proof: `0x${string}`; publicInputs: string[] }) => AnyIntentInput;
  /** Side-effect to run once the relayer reports `confirmed`. */
  onConfirmed: () => void;
}

interface PrepArgs {
  asset: AssetSymbol;
  amountUnits: string;
  minHfBps: string;
  secretKey: bigint;
  spendingPubkey: bigint;
  entryImt: LocalIMT;
  supplyImt: LocalIMT;
  positionImt: LocalIMT;
  noteStore: NoteStore;
}

async function prepareIntent(
  kind: LendingFormKind,
  args: PrepArgs,
): Promise<PreparedIntent> {
  const hf = Number.parseInt(args.minHfBps || "0", 10);
  const sk = args.secretKey;
  const pk = args.spendingPubkey;
  const assetId = assetIdOf(args.asset);
  const slot = Number(assetId);
  if (slot >= MAX_ASSETS) {
    throw new Error(`unknown asset slot ${slot}`);
  }
  const amount = BigInt(args.amountUnits);

  switch (kind) {
    case "supply":
      return prepareSupply({ ...args, hf, sk, pk, assetId, slot, amount });
    case "withdraw_supply":
      return prepareWithdrawSupply({ ...args, hf, sk, pk, assetId, slot, amount });
    case "deposit_collateral":
      return prepareDepositCollateral({ ...args, hf, sk, pk, assetId, slot, amount });
    case "withdraw_collateral":
      return prepareWithdrawCollateral({ ...args, hf, sk, pk, assetId, slot, amount });
    case "borrow":
      return prepareBorrow({ ...args, hf, sk, pk, assetId, slot, amount });
    case "repay":
      return prepareRepay({ ...args, hf, sk, pk, assetId, slot, amount });
  }
}

type Prep = PrepArgs & {
  hf: number;
  sk: bigint;
  pk: bigint;
  assetId: bigint;
  slot: number;
  amount: bigint;
};

// ---- supply ---------------------------------------------------------------

async function prepareSupply(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const supplyIndexNow = snapshot.supplyIndices[p.slot] || 1_000_000_000_000_000_000_000_000_000n;

  const oldBalance = mustGetBalanceFor(p.noteStore, p.assetId);
  const newBalanceSalt = randomSalt();
  const newSupplySalt = randomSalt();
  const residualAmount = oldBalance.amount >= p.amount ? oldBalance.amount - p.amount : 0n;

  const residualLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: residualAmount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const supplyLeaf = supplyCommitment({
    assetId: p.assetId,
    amount: p.amount,
    supplyIndexAtDeposit: supplyIndexNow,
    spendingPubkey: p.pk,
    salt: newSupplySalt,
  });
  const oldBalanceCommitment = balanceCommitment({
    assetId: oldBalance.assetId,
    amount: oldBalance.amount,
    spendingPubkey: p.pk,
    salt: oldBalance.salt,
  });
  const balanceNul = balanceNullifier(p.sk, oldBalance.salt);

  const balanceInsert = p.entryImt.proofFor(oldBalance.leafIdx);
  const rootBalance = p.entryImt.currentRoot();

  const witness = buildSupplyWitness({
    assetId: p.assetId,
    rootBalance,
    balanceNullifier: balanceNul,
    residualBalanceCommitment: residualLeaf,
    supplyCommitment: supplyLeaf,
    amount: p.amount,
    supplyIndexNow,
    secretKey: p.sk,
    oldBalance,
    newBalanceSalt,
    newSupplySalt,
    balanceInsert: {
      idx: oldBalance.leafIdx,
      siblings: balanceInsert.siblings,
      indexBits: balanceInsert.indexBits,
      newRoot: rootBalance,
    },
  });

  void oldBalanceCommitment;

  const onConfirmed = () => {
    const oldLeaf = p.entryImt.leafAt(oldBalance.leafIdx);
    if (oldLeaf !== undefined) p.noteStore.forget(oldLeaf);
    const residualResult = p.entryImt.insert(residualLeaf);
    const supplyResult = p.supplyImt.insert(supplyLeaf);
    p.noteStore.register(residualLeaf, {
      kind: "balance",
      leafIdx: residualResult.idx,
      assetId: p.assetId,
      amount: residualAmount,
      salt: newBalanceSalt,
    });
    p.noteStore.register(supplyLeaf, {
      kind: "supply",
      leafIdx: supplyResult.idx,
      assetId: p.assetId,
      amount: p.amount,
      supplyIndexAtDeposit: supplyIndexNow,
      salt: newSupplySalt,
    });
  };

  return {
    proveKind: "supply",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_balance",
      "balance_nullifier_pub",
      "residual_balance_commitment",
      "supply_commitment_pub",
      "amount",
      "supply_index_now",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "supply",
      asset: p.asset,
      amount: p.amountUnits,
      supplyCommitment: toHex32(supplyLeaf),
      balanceMove: {
        balanceNullifier: toHex32(balanceNul),
        residualBalanceCommitment: toHex32(residualLeaf),
      },
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---- withdraw_supply ------------------------------------------------------

async function prepareWithdrawSupply(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const supplyIndexNow = snapshot.supplyIndices[p.slot] || 1_000_000_000_000_000_000_000_000_000n;

  const oldSupply = mustGetSupplyFor(p.noteStore, p.assetId);
  const newBalanceSalt = randomSalt();

  const newBalanceLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: p.amount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const supplyNul = supplyNullifier(p.sk, oldSupply.salt);

  const supplyProof = p.supplyImt.proofFor(oldSupply.leafIdx);
  const rootSupply = p.supplyImt.currentRoot();

  const witness = buildWithdrawSupplyWitness({
    assetId: p.assetId,
    rootSupply,
    supplyNullifier: supplyNul,
    newBalanceCommitment: newBalanceLeaf,
    amount: p.amount,
    supplyIndexNow,
    secretKey: p.sk,
    oldSupply,
    newBalanceSalt,
    supplyInsert: {
      idx: oldSupply.leafIdx,
      siblings: supplyProof.siblings,
      indexBits: supplyProof.indexBits,
      newRoot: rootSupply,
    },
  });

  const onConfirmed = () => {
    const oldLeaf = p.supplyImt.leafAt(oldSupply.leafIdx);
    if (oldLeaf !== undefined) p.noteStore.forget(oldLeaf);
    const balanceResult = p.entryImt.insert(newBalanceLeaf);
    p.noteStore.register(newBalanceLeaf, {
      kind: "balance",
      leafIdx: balanceResult.idx,
      assetId: p.assetId,
      amount: p.amount,
      salt: newBalanceSalt,
    });
  };

  return {
    proveKind: "withdraw_supply",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_supply",
      "supply_nullifier_pub",
      "new_balance_commitment",
      "amount",
      "supply_index_now",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "withdraw_supply",
      asset: p.asset,
      amount: p.amountUnits,
      supplyNullifier: toHex32(supplyNul),
      newBalanceCommitment: toHex32(newBalanceLeaf),
      rootAtProveTime: toHex32(rootSupply),
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---- deposit_collateral ---------------------------------------------------

async function prepareDepositCollateral(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const oldBalance = mustGetBalanceFor(p.noteStore, p.assetId);
  const newBalanceSalt = randomSalt();
  const newPositionSalt = randomSalt();

  const residualAmount = oldBalance.amount >= p.amount ? oldBalance.amount - p.amount : 0n;
  const residualLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: residualAmount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const balanceNul = balanceNullifier(p.sk, oldBalance.salt);

  const balanceProof = p.entryImt.proofFor(oldBalance.leafIdx);
  const rootBalance = p.entryImt.currentRoot();

  // Position: first-time path uses empty preimage, idx 0 / proof-of-empty.
  const existingPosition = p.noteStore.latest("position");
  const createNew = !existingPosition;
  const oldPosition: PositionPreimage = createNew
    ? emptyPositionPreimage(0, p.pk, randomSalt())
    : (existingPosition.preimage as PositionPreimage);
  const positionNul = positionNullifier(p.sk, oldPosition.salt);

  const positionProof = createNew
    ? {
        siblings: Array.from({ length: 20 }, (_, d) => p.positionImt.zerosAt(d)),
        indexBits: new Array(20).fill(false),
      }
    : p.positionImt.proofFor(oldPosition.leafIdx);
  const rootPosition = p.positionImt.currentRoot();

  const newCollaterals = [...oldPosition.collaterals];
  newCollaterals[p.slot] = (newCollaterals[p.slot] ?? 0n) + p.amount;
  const newPosition: PositionPreimage = {
    kind: "position",
    leafIdx: -1, // filled after insert
    spendingPubkey: p.pk,
    collaterals: newCollaterals,
    debts: [...oldPosition.debts],
    borrowIndicesAtUpdate: [...oldPosition.borrowIndicesAtUpdate],
    salt: newPositionSalt,
  };
  const newPositionLeaf = positionCommitment({
    spendingPubkey: p.pk,
    collaterals: newPosition.collaterals,
    debts: newPosition.debts,
    borrowIndicesAtUpdate: newPosition.borrowIndicesAtUpdate,
    salt: newPositionSalt,
  });

  const witness = buildDepositCollateralWitness({
    assetId: p.assetId,
    rootBalance,
    rootPosition,
    balanceNullifier: balanceNul,
    positionNullifier: createNew ? 0n : positionNul,
    residualBalanceCommitment: residualLeaf,
    newPositionCommitment: newPositionLeaf,
    amount: p.amount,
    createNew,
    secretKey: p.sk,
    oldBalance,
    newBalanceSalt,
    oldPosition,
    oldPositionSpendingPubkey: oldPosition.spendingPubkey,
    newPositionSalt,
    balanceInsert: {
      idx: oldBalance.leafIdx,
      siblings: balanceProof.siblings,
      indexBits: balanceProof.indexBits,
      newRoot: rootBalance,
    },
    positionInsert: {
      idx: oldPosition.leafIdx,
      siblings: positionProof.siblings,
      indexBits: positionProof.indexBits,
      newRoot: rootPosition,
    },
  });

  const onConfirmed = () => {
    const balanceResult = p.entryImt.insert(residualLeaf);
    const positionResult = p.positionImt.insert(newPositionLeaf);
    p.noteStore.register(residualLeaf, {
      kind: "balance",
      leafIdx: balanceResult.idx,
      assetId: p.assetId,
      amount: residualAmount,
      salt: newBalanceSalt,
    });
    newPosition.leafIdx = positionResult.idx;
    p.noteStore.register(newPositionLeaf, newPosition);
  };

  return {
    proveKind: "deposit_collateral",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_balance",
      "root_position",
      "balance_nullifier_pub",
      "position_nullifier_pub",
      "residual_balance_commitment",
      "new_position_commitment",
      "amount",
      "create_new",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "deposit_collateral",
      asset: p.asset,
      amount: p.amountUnits,
      balanceMove: {
        balanceNullifier: toHex32(balanceNul),
        residualBalanceCommitment: toHex32(residualLeaf),
      },
      positionMove: {
        oldPositionNullifier: createNew ? ZERO_BYTES32 : toHex32(positionNul),
        newPositionCommitment: toHex32(newPositionLeaf),
        rootAtProveTime: createNew ? ZERO_BYTES32 : toHex32(rootPosition),
      },
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---- withdraw_collateral --------------------------------------------------

async function prepareWithdrawCollateral(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const oldPosition = mustGetPosition(p.noteStore);
  const newBalanceSalt = randomSalt();
  const newPositionSalt = randomSalt();

  const newBalanceLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: p.amount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const positionNul = positionNullifier(p.sk, oldPosition.salt);

  const newCollaterals = [...oldPosition.collaterals];
  newCollaterals[p.slot] = newCollaterals[p.slot] >= p.amount ? newCollaterals[p.slot] - p.amount : 0n;
  const newPosition: PositionPreimage = {
    kind: "position",
    leafIdx: -1,
    spendingPubkey: p.pk,
    collaterals: newCollaterals,
    debts: [...oldPosition.debts],
    borrowIndicesAtUpdate: [...oldPosition.borrowIndicesAtUpdate],
    salt: newPositionSalt,
  };
  const newPositionLeaf = positionCommitment({
    spendingPubkey: p.pk,
    collaterals: newPosition.collaterals,
    debts: newPosition.debts,
    borrowIndicesAtUpdate: newPosition.borrowIndicesAtUpdate,
    salt: newPositionSalt,
  });

  const positionProof = p.positionImt.proofFor(oldPosition.leafIdx);
  const rootPosition = p.positionImt.currentRoot();

  const { accruedDebts, remainders } = computeAccrualHints(
    oldPosition.debts,
    snapshot.borrowIndices,
    oldPosition.borrowIndicesAtUpdate,
  );

  const witness = buildWithdrawCollateralWitness({
    assetId: p.assetId,
    rootPosition,
    oldPositionNullifier: positionNul,
    newPositionCommitment: newPositionLeaf,
    newBalanceCommitment: newBalanceLeaf,
    amount: p.amount,
    snapshot,
    secretKey: p.sk,
    oldPosition,
    oldPositionSpendingPubkey: oldPosition.spendingPubkey,
    newPositionSalt,
    newBalanceSalt,
    positionInsert: {
      idx: oldPosition.leafIdx,
      siblings: positionProof.siblings,
      indexBits: positionProof.indexBits,
      newRoot: rootPosition,
    },
    accruedDebts,
    accrualRemainders: remainders,
  });

  const onConfirmed = () => {
    const balanceResult = p.entryImt.insert(newBalanceLeaf);
    const positionResult = p.positionImt.insert(newPositionLeaf);
    p.noteStore.register(newBalanceLeaf, {
      kind: "balance",
      leafIdx: balanceResult.idx,
      assetId: p.assetId,
      amount: p.amount,
      salt: newBalanceSalt,
    });
    newPosition.leafIdx = positionResult.idx;
    p.noteStore.register(newPositionLeaf, newPosition);
  };

  return {
    proveKind: "withdraw_collateral",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_position",
      "old_position_nullifier_pub",
      "new_position_commitment",
      "new_balance_commitment",
      "amount",
      "current_prices",
      "current_borrow_indices",
      "lt_bps",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "withdraw_collateral",
      asset: p.asset,
      amount: p.amountUnits,
      minHfBps: Number.isFinite(p.hf) ? p.hf : 0,
      newBalanceCommitment: toHex32(newBalanceLeaf),
      positionMove: {
        oldPositionNullifier: toHex32(positionNul),
        newPositionCommitment: toHex32(newPositionLeaf),
        rootAtProveTime: toHex32(rootPosition),
      },
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---- borrow ---------------------------------------------------------------

async function prepareBorrow(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const oldPosition = mustGetPosition(p.noteStore);
  const newBalanceSalt = randomSalt();
  const newPositionSalt = randomSalt();

  const newBalanceLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: p.amount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const positionNul = positionNullifier(p.sk, oldPosition.salt);

  const newDebts = [...oldPosition.debts];
  newDebts[p.slot] = (newDebts[p.slot] ?? 0n) + p.amount;
  const newIndices = [...oldPosition.borrowIndicesAtUpdate];
  newIndices[p.slot] = snapshot.borrowIndices[p.slot];
  const newPosition: PositionPreimage = {
    kind: "position",
    leafIdx: -1,
    spendingPubkey: p.pk,
    collaterals: [...oldPosition.collaterals],
    debts: newDebts,
    borrowIndicesAtUpdate: newIndices,
    salt: newPositionSalt,
  };
  const newPositionLeaf = positionCommitment({
    spendingPubkey: p.pk,
    collaterals: newPosition.collaterals,
    debts: newPosition.debts,
    borrowIndicesAtUpdate: newPosition.borrowIndicesAtUpdate,
    salt: newPositionSalt,
  });

  const positionProof = p.positionImt.proofFor(oldPosition.leafIdx);
  const rootPosition = p.positionImt.currentRoot();

  const { accruedDebts, remainders } = computeAccrualHints(
    oldPosition.debts,
    snapshot.borrowIndices,
    oldPosition.borrowIndicesAtUpdate,
  );

  const witness = buildBorrowWitness({
    assetId: p.assetId,
    rootPosition,
    oldPositionNullifier: positionNul,
    newPositionCommitment: newPositionLeaf,
    newBalanceCommitment: newBalanceLeaf,
    amount: p.amount,
    snapshot,
    secretKey: p.sk,
    oldPosition,
    oldPositionSpendingPubkey: oldPosition.spendingPubkey,
    newPositionSalt,
    newBalanceSalt,
    positionInsert: {
      idx: oldPosition.leafIdx,
      siblings: positionProof.siblings,
      indexBits: positionProof.indexBits,
      newRoot: rootPosition,
    },
    accruedDebts,
    accrualRemainders: remainders,
  });

  const onConfirmed = () => {
    const balanceResult = p.entryImt.insert(newBalanceLeaf);
    const positionResult = p.positionImt.insert(newPositionLeaf);
    p.noteStore.register(newBalanceLeaf, {
      kind: "balance",
      leafIdx: balanceResult.idx,
      assetId: p.assetId,
      amount: p.amount,
      salt: newBalanceSalt,
    });
    newPosition.leafIdx = positionResult.idx;
    p.noteStore.register(newPositionLeaf, newPosition);
  };

  return {
    proveKind: "borrow",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_position",
      "old_position_nullifier_pub",
      "new_position_commitment",
      "new_balance_commitment",
      "amount",
      "current_prices",
      "current_borrow_indices",
      "ltv_bps",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "borrow",
      asset: p.asset,
      amount: p.amountUnits,
      minHfBps: Number.isFinite(p.hf) ? p.hf : 0,
      newBalanceCommitment: toHex32(newBalanceLeaf),
      positionMove: {
        oldPositionNullifier: toHex32(positionNul),
        newPositionCommitment: toHex32(newPositionLeaf),
        rootAtProveTime: toHex32(rootPosition),
      },
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---- repay ----------------------------------------------------------------

async function prepareRepay(p: Prep): Promise<PreparedIntent> {
  const snapshot = await readChainSnapshot();
  const oldBalance = mustGetBalanceFor(p.noteStore, p.assetId);
  const oldPosition = mustGetPosition(p.noteStore);
  const newBalanceSalt = randomSalt();
  const newPositionSalt = randomSalt();

  const residualAmount = oldBalance.amount >= p.amount ? oldBalance.amount - p.amount : 0n;
  const residualLeaf = balanceCommitment({
    assetId: p.assetId,
    amount: residualAmount,
    spendingPubkey: p.pk,
    salt: newBalanceSalt,
  });
  const balanceNul = balanceNullifier(p.sk, oldBalance.salt);
  const positionNul = positionNullifier(p.sk, oldPosition.salt);

  const newDebts = [...oldPosition.debts];
  newDebts[p.slot] = newDebts[p.slot] >= p.amount ? newDebts[p.slot] - p.amount : 0n;
  const newIndices = [...oldPosition.borrowIndicesAtUpdate];
  newIndices[p.slot] = snapshot.borrowIndices[p.slot];
  const newPosition: PositionPreimage = {
    kind: "position",
    leafIdx: -1,
    spendingPubkey: p.pk,
    collaterals: [...oldPosition.collaterals],
    debts: newDebts,
    borrowIndicesAtUpdate: newIndices,
    salt: newPositionSalt,
  };
  const newPositionLeaf = positionCommitment({
    spendingPubkey: p.pk,
    collaterals: newPosition.collaterals,
    debts: newPosition.debts,
    borrowIndicesAtUpdate: newPosition.borrowIndicesAtUpdate,
    salt: newPositionSalt,
  });

  const balanceProof = p.entryImt.proofFor(oldBalance.leafIdx);
  const positionProof = p.positionImt.proofFor(oldPosition.leafIdx);
  const rootBalance = p.entryImt.currentRoot();
  const rootPosition = p.positionImt.currentRoot();

  const { accruedDebts, remainders } = computeAccrualHints(
    oldPosition.debts,
    snapshot.borrowIndices,
    oldPosition.borrowIndicesAtUpdate,
  );

  const witness = buildRepayWitness({
    assetId: p.assetId,
    rootBalance,
    rootPosition,
    balanceNullifier: balanceNul,
    positionNullifier: positionNul,
    residualBalanceCommitment: residualLeaf,
    newPositionCommitment: newPositionLeaf,
    amount: p.amount,
    snapshot,
    secretKey: p.sk,
    oldBalance,
    newBalanceSalt,
    oldPosition,
    oldPositionSpendingPubkey: oldPosition.spendingPubkey,
    newPositionSalt,
    balanceInsert: {
      idx: oldBalance.leafIdx,
      siblings: balanceProof.siblings,
      indexBits: balanceProof.indexBits,
      newRoot: rootBalance,
    },
    positionInsert: {
      idx: oldPosition.leafIdx,
      siblings: positionProof.siblings,
      indexBits: positionProof.indexBits,
      newRoot: rootPosition,
    },
    accruedDebts,
    accrualRemainders: remainders,
  });

  const onConfirmed = () => {
    const balanceResult = p.entryImt.insert(residualLeaf);
    const positionResult = p.positionImt.insert(newPositionLeaf);
    p.noteStore.register(residualLeaf, {
      kind: "balance",
      leafIdx: balanceResult.idx,
      assetId: p.assetId,
      amount: residualAmount,
      salt: newBalanceSalt,
    });
    newPosition.leafIdx = positionResult.idx;
    p.noteStore.register(newPositionLeaf, newPosition);
  };

  return {
    proveKind: "repay",
    witnessMap: witness,
    publicInputs: extractPublicInputs(witness, [
      "asset_id",
      "root_balance",
      "root_position",
      "balance_nullifier_pub",
      "position_nullifier_pub",
      "residual_balance_commitment",
      "new_position_commitment",
      "amount",
      "current_borrow_indices",
    ]),
    bodyBuilder: ({ proof, publicInputs }) => ({
      kind: "repay",
      asset: p.asset,
      amount: p.amountUnits,
      balanceMove: {
        balanceNullifier: toHex32(balanceNul),
        residualBalanceCommitment: toHex32(residualLeaf),
      },
      positionMove: {
        oldPositionNullifier: toHex32(positionNul),
        newPositionCommitment: toHex32(newPositionLeaf),
        rootAtProveTime: toHex32(rootPosition),
      },
      proofBundle: { proof, publicInputs },
    }),
    onConfirmed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPublicInputs(witness: WitnessMap, names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = witness[n];
    if (Array.isArray(v)) {
      out.push(...v);
    } else if (typeof v === "string") {
      out.push(v);
    } else {
      // Struct-shaped public inputs aren't part of the lending
      // circuits' public surface; this guard exists only to keep TS
      // honest about the WitnessValue union.
      throw new Error(`extractPublicInputs: "${n}" is a struct, not a public field`);
    }
  }
  return out;
}

function mustGetBalanceFor(store: NoteStore, assetId: bigint): BalanceNotePreimage {
  for (const [, preimage] of store.iter("balance")) {
    if (preimage.kind === "balance" && preimage.assetId === assetId && preimage.amount > 0n) {
      return preimage;
    }
  }
  throw new Error(
    `No spendable balance note for asset ${assetId}. Deposit on the home page first, then come back.`,
  );
}

function mustGetSupplyFor(store: NoteStore, assetId: bigint): SupplyNotePreimage {
  for (const [, preimage] of store.iter("supply")) {
    if (preimage.kind === "supply" && preimage.assetId === assetId && preimage.amount > 0n) {
      return preimage;
    }
  }
  throw new Error(
    `No spendable supply note for asset ${assetId}. Supply on the /supply page first.`,
  );
}

function mustGetPosition(store: NoteStore): PositionPreimage {
  const latest = store.latest("position");
  if (!latest || latest.preimage.kind !== "position") {
    throw new Error(
      "No active position yet. Deposit collateral on /collateral first to open one.",
    );
  }
  return latest.preimage as PositionPreimage;
}
