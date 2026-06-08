"use client";

import { useMemo, useState } from "react";

import { useProver } from "@/hooks/useProver";
import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";
import { toUnits } from "@/lib/units";

import { AssetSelector, ASSET_DECIMALS, type AssetSymbol } from "./AssetSelector";
import { ConnectGate } from "./ConnectGate";
import { ProofProgressModal, type ProofStage } from "./ProofProgressModal";

import {
  balanceCommitment,
  balanceNullifier,
  positionCommitment,
  positionNullifier,
  slotFor,
  supplyCommitment,
  supplyNullifier,
  zeroBytes32,
} from "@/lib/witness";

import { LendingSdk, type AnyIntentInput, type IntentDetail } from "@lending/sdk-ts";

const DUMMY_ROOT = zeroBytes32();

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
  const { spendingKey } = useSpendingKey();
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
  if (!spendingKey)
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
      const proof = await prove(kind, {
        witness: { asset, amount: amountUnits },
        publicInputs: [amountUnits],
      });

      setStage("submitting");
      const body = buildIntent(kind, {
        asset,
        amountUnits,
        minHfBps,
        spendingKey: spendingKey!,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
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

function buildIntent(
  kind: LendingFormKind,
  args: {
    asset: AssetSymbol;
    amountUnits: string;
    minHfBps: string;
    spendingKey: Uint8Array;
    proof: `0x${string}`;
    publicInputs: string[];
  },
): AnyIntentInput {
  const hf = Number.parseInt(args.minHfBps || "0", 10);
  const proofBundle = { proof: args.proof, publicInputs: args.publicInputs };
  const sk = args.spendingKey;
  const slot = slotFor(kind);
  const slotNew = slotFor(`${kind}-new`);

  switch (kind) {
    case "supply":
      return {
        kind: "supply",
        asset: args.asset,
        amount: args.amountUnits,
        supplyCommitment: supplyCommitment(sk, slotNew),
        balanceMove: {
          balanceNullifier: balanceNullifier(sk, slot),
          residualBalanceCommitment: balanceCommitment(sk, slotNew),
        },
        proofBundle,
      };
    case "withdraw_supply":
      return {
        kind: "withdraw_supply",
        asset: args.asset,
        amount: args.amountUnits,
        supplyNullifier: supplyNullifier(sk, slot),
        newBalanceCommitment: balanceCommitment(sk, slotNew),
        rootAtProveTime: DUMMY_ROOT,
        proofBundle,
      };
    case "deposit_collateral":
      return {
        kind: "deposit_collateral",
        asset: args.asset,
        amount: args.amountUnits,
        balanceMove: {
          balanceNullifier: balanceNullifier(sk, slot),
          residualBalanceCommitment: balanceCommitment(sk, slotNew),
        },
        positionMove: {
          oldPositionNullifier: positionNullifier(sk, slot),
          newPositionCommitment: positionCommitment(sk, slotNew),
          rootAtProveTime: DUMMY_ROOT,
        },
        proofBundle,
      };
    case "withdraw_collateral":
      return {
        kind: "withdraw_collateral",
        asset: args.asset,
        amount: args.amountUnits,
        minHfBps: Number.isFinite(hf) ? hf : 0,
        newBalanceCommitment: balanceCommitment(sk, slotNew),
        positionMove: {
          oldPositionNullifier: positionNullifier(sk, slot),
          newPositionCommitment: positionCommitment(sk, slotNew),
          rootAtProveTime: DUMMY_ROOT,
        },
        proofBundle,
      };
    case "borrow":
      return {
        kind: "borrow",
        asset: args.asset,
        amount: args.amountUnits,
        minHfBps: Number.isFinite(hf) ? hf : 0,
        newBalanceCommitment: balanceCommitment(sk, slotNew),
        positionMove: {
          oldPositionNullifier: positionNullifier(sk, slot),
          newPositionCommitment: positionCommitment(sk, slotNew),
          rootAtProveTime: DUMMY_ROOT,
        },
        proofBundle,
      };
    case "repay":
      return {
        kind: "repay",
        asset: args.asset,
        amount: args.amountUnits,
        balanceMove: {
          balanceNullifier: balanceNullifier(sk, slot),
          residualBalanceCommitment: balanceCommitment(sk, slotNew),
        },
        positionMove: {
          oldPositionNullifier: positionNullifier(sk, slot),
          newPositionCommitment: positionCommitment(sk, slotNew),
          rootAtProveTime: DUMMY_ROOT,
        },
        proofBundle,
      };
  }
}
