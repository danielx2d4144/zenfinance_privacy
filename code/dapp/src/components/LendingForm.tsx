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
  assetIdOf,
  balanceCommitment,
  balanceNullifier,
  positionCommitmentSingleAsset,
  positionNullifier,
  randomSalt,
  supplyCommitment,
  supplyNullifier,
  toHex32,
  ZERO_BYTES32,
} from "@/lib/witness.ts";
import type { LocalIMT } from "@/lib/imt.ts";

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
      const proof = await prove(kind, {
        witness: { asset, amount: amountUnits },
        publicInputs: [amountUnits],
      });

      setStage("submitting");
      const intent = buildIntent(kind, {
        asset,
        amountUnits,
        minHfBps,
        secretKey: secretKey!,
        spendingPubkey: spendingPubkey!,
        entryImt,
        supplyImt,
        positionImt,
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      });
      const accepted = await sdk.intents.create(intent.body, {
        idempotencyKey: `dapp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });

      setStage("aggregating");
      const final: IntentDetail = await sdk.intents.waitFor(accepted.intent_id, {
        deadlineMs: 6 * 60 * 1000,
        pollMs: 1000,
      });

      if (final.status === "confirmed") {
        // Mirror the on-chain insert(s) so the next intent's
        // rootAtProveTime is known() at the contract. Stage F will
        // replace this best-effort mirror with a subgraph-driven sync.
        for (const leaf of intent.leavesToInsert.entry) entryImt.insert(leaf);
        for (const leaf of intent.leavesToInsert.supply) supplyImt.insert(leaf);
        for (const leaf of intent.leavesToInsert.position) positionImt.insert(leaf);
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

interface BuiltIntent {
  body: AnyIntentInput;
  /**
   * Commitments the contract will insert when this intent confirms.
   * The dapp mirrors each into its LocalIMT so the next intent's
   * `rootAtProveTime` is `known()` on-chain.
   */
  leavesToInsert: {
    entry: bigint[];
    supply: bigint[];
    position: bigint[];
  };
}

function buildIntent(
  kind: LendingFormKind,
  args: {
    asset: AssetSymbol;
    amountUnits: string;
    minHfBps: string;
    secretKey: bigint;
    spendingPubkey: bigint;
    entryImt: LocalIMT;
    supplyImt: LocalIMT;
    positionImt: LocalIMT;
    proof: `0x${string}`;
    publicInputs: string[];
  },
): BuiltIntent {
  const hf = Number.parseInt(args.minHfBps || "0", 10);
  const proofBundle = { proof: args.proof, publicInputs: args.publicInputs };
  const sk = args.secretKey;
  const pk = args.spendingPubkey;
  const assetId = assetIdOf(args.asset);
  const amount = BigInt(args.amountUnits);

  // Fresh per-intent salts so commitments + nullifiers are unique.
  // Real production would derive salts deterministically from a HKDF
  // chain seeded by the secret key; Stage D uses CSPRNG salts because
  // the dapp does not yet persist a note ledger.
  const sIn = randomSalt();
  const sOut = randomSalt();
  const sPosOld = randomSalt();
  const sPosNew = randomSalt();

  // For ops that consume an existing position, the contract checks
  // `_imt.known(rootAtProveTime)` against the depth-20 history ring.
  // Empty history -> the dapp passes a real-history bytes32 only if
  // there's been at least one prior position insert; otherwise the
  // contract's conditional path (e.g. depositCollateral with
  // oldPositionNullifier == 0) accepts ZERO_BYTES32.
  const positionRoot =
    args.positionImt.nextLeafIndex() > 0
      ? toHex32(args.positionImt.currentRoot())
      : ZERO_BYTES32;
  const supplyRoot =
    args.supplyImt.nextLeafIndex() > 0
      ? toHex32(args.supplyImt.currentRoot())
      : ZERO_BYTES32;

  // Balance commitments bind to (assetId, amount, spending_pubkey, salt).
  // For the residual we use `amount: 0n` -- the circuit-side withdraw
  // path will compute the true residual at prove time; Stage D's value
  // is a placeholder that's still a valid Field element.
  const residualBalanceLeaf = balanceCommitment({
    assetId,
    amount: 0n,
    spendingPubkey: pk,
    salt: sOut,
  });
  const newBalanceLeaf = balanceCommitment({
    assetId,
    amount,
    spendingPubkey: pk,
    salt: sOut,
  });
  // Supply notes bind to the supply index at deposit time. For Stage D
  // the index is a placeholder; Stage E pulls the real index from
  // RateModel.state(assetId).supplyIndex via the data-api.
  const supplyLeaf = supplyCommitment({
    assetId,
    amount,
    supplyIndexAtDeposit: 0n,
    spendingPubkey: pk,
    salt: sOut,
  });
  // Position commitment: single-asset shape with `amount` going into
  // the relevant slot (collateral for deposit/withdraw_collateral,
  // debt for borrow/repay). Other 7 asset slots zero.
  const newPositionLeaf = positionCommitmentSingleAsset({
    spendingPubkey: pk,
    assetId,
    collateral:
      kind === "deposit_collateral" || kind === "withdraw_collateral"
        ? amount
        : 0n,
    debt: kind === "borrow" || kind === "repay" ? amount : 0n,
    borrowIndexAtUpdate: 0n,
    salt: sPosNew,
  });

  // Nullifiers.
  const balNul = balanceNullifier(sk, sIn);
  const supNul = supplyNullifier(sk, sPosOld);
  const posNul = positionNullifier(sk, sPosOld);

  switch (kind) {
    case "supply":
      return {
        body: {
          kind: "supply",
          asset: args.asset,
          amount: args.amountUnits,
          supplyCommitment: toHex32(supplyLeaf),
          balanceMove: {
            balanceNullifier: toHex32(balNul),
            residualBalanceCommitment: toHex32(residualBalanceLeaf),
          },
          proofBundle,
        },
        leavesToInsert: {
          entry: [residualBalanceLeaf],
          supply: [supplyLeaf],
          position: [],
        },
      };
    case "withdraw_supply":
      return {
        body: {
          kind: "withdraw_supply",
          asset: args.asset,
          amount: args.amountUnits,
          supplyNullifier: toHex32(supNul),
          newBalanceCommitment: toHex32(newBalanceLeaf),
          rootAtProveTime: supplyRoot,
          proofBundle,
        },
        leavesToInsert: {
          entry: [newBalanceLeaf],
          supply: [],
          position: [],
        },
      };
    case "deposit_collateral":
      return {
        body: {
          kind: "deposit_collateral",
          asset: args.asset,
          amount: args.amountUnits,
          balanceMove: {
            balanceNullifier: toHex32(balNul),
            residualBalanceCommitment: toHex32(residualBalanceLeaf),
          },
          positionMove: {
            oldPositionNullifier:
              args.positionImt.nextLeafIndex() > 0
                ? toHex32(posNul)
                : ZERO_BYTES32,
            newPositionCommitment: toHex32(newPositionLeaf),
            rootAtProveTime: positionRoot,
          },
          proofBundle,
        },
        leavesToInsert: {
          entry: [residualBalanceLeaf],
          supply: [],
          position: [newPositionLeaf],
        },
      };
    case "withdraw_collateral":
      return {
        body: {
          kind: "withdraw_collateral",
          asset: args.asset,
          amount: args.amountUnits,
          minHfBps: Number.isFinite(hf) ? hf : 0,
          newBalanceCommitment: toHex32(newBalanceLeaf),
          positionMove: {
            oldPositionNullifier: toHex32(posNul),
            newPositionCommitment: toHex32(newPositionLeaf),
            rootAtProveTime: positionRoot,
          },
          proofBundle,
        },
        leavesToInsert: {
          entry: [newBalanceLeaf],
          supply: [],
          position: [newPositionLeaf],
        },
      };
    case "borrow":
      return {
        body: {
          kind: "borrow",
          asset: args.asset,
          amount: args.amountUnits,
          minHfBps: Number.isFinite(hf) ? hf : 0,
          newBalanceCommitment: toHex32(newBalanceLeaf),
          positionMove: {
            oldPositionNullifier: toHex32(posNul),
            newPositionCommitment: toHex32(newPositionLeaf),
            rootAtProveTime: positionRoot,
          },
          proofBundle,
        },
        leavesToInsert: {
          entry: [newBalanceLeaf],
          supply: [],
          position: [newPositionLeaf],
        },
      };
    case "repay":
      return {
        body: {
          kind: "repay",
          asset: args.asset,
          amount: args.amountUnits,
          balanceMove: {
            balanceNullifier: toHex32(balNul),
            residualBalanceCommitment: toHex32(residualBalanceLeaf),
          },
          positionMove: {
            oldPositionNullifier: toHex32(posNul),
            newPositionCommitment: toHex32(newPositionLeaf),
            rootAtProveTime: positionRoot,
          },
          proofBundle,
        },
        leavesToInsert: {
          entry: [residualBalanceLeaf],
          supply: [],
          position: [newPositionLeaf],
        },
      };
  }
}
