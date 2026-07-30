"use client";

import { useMemo, useState } from "react";

import { useProver } from "@/hooks/useProver";
import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";

import { ConnectGate } from "./ConnectGate";

import {
  assetIdOf,
  balanceCommitment,
  randomSalt,
  toHex32,
} from "@/lib/witness";
import { buildEntryDepositWitness } from "@/lib/prover/witnesses";
import { encryptMemo, NoteType } from "@/lib/memo-crypto";

import { LendingSdk, type IntentDetail } from "@lending/sdk-ts";

/**
 * Day-13 PrivacyEntry deposit screen. Day 14c-E swap: commitment is now
 * a REAL Poseidon2 balance-note hash (`lib_common::balance_commitment`)
 * proved by the in-browser bb.js UltraHonkBackend against the
 * entry_deposit circuit.
 *
 * Submission goes through the data-API; the dapp never speaks to the
 * chain directly -- that's the relayer's job (S13 §3 / I-OPS-3).
 */

type DepositState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "pending"; intentId: string; commitment: string }
  | { phase: "confirmed"; intentId: string; commitment: string; txHash: string | null }
  | { phase: "failed"; intentId?: string; reason: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export function DepositForm() {
  const { isConnected, isCorrectChain, defaultChain, switchToDefault, switchStatus } = useWallet();
  const {
    unlocked,
    secretKey,
    spendingPubkey,
    viewingKey,
    entryImt,
    noteStore,
    vault,
    storageUnavailable,
    tabRole,
    derive,
    isDeriving,
    error: keyError,
  } = useSpendingKey();
  const { prove } = useProver();

  const [amount, setAmount] = useState("100");
  const [state, setState] = useState<DepositState>({ phase: "idle" });
  const [riskAccepted, setRiskAccepted] = useState(false);

  const sdk = useMemo(
    () => new LendingSdk({ baseUrl: API_BASE, apiKey: API_KEY }),
    [],
  );

  if (!isConnected) {
    return <ConnectGate message="Connect a wallet to deposit." />;
  }
  if (!isCorrectChain) {
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
  }

  if (!unlocked) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/70">
          Unlock your private balances
        </h3>
        <p className="mt-2 text-sm text-white/60">
          One typed-data signature derives your session keys (spending, viewing,
          storage). Keys never leave this tab; only ciphertext is stored on this
          device. First unlock asks for a second signature to verify your wallet
          signs deterministically.
        </p>
        {keyError ? <p className="mt-3 text-sm text-red-300">{keyError}</p> : null}
        <button
          type="button"
          onClick={() => void derive()}
          disabled={isDeriving}
          className="mt-4 rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {isDeriving ? "Awaiting signature…" : "Sign to unlock"}
        </button>
      </div>
    );
  }

  if (tabRole.role === "reader") {
    return (
      <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-6 text-sm">
        <p className="font-semibold text-amber-200">Read-only tab</p>
        <p className="mt-2 text-amber-100/70">
          ZenFinance is active in another tab. To avoid double-spending your
          notes, deposits and other transactions run only there — close it to
          make this tab the active one.
        </p>
      </div>
    );
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!secretKey || !spendingPubkey || !viewingKey) {
      setState({ phase: "failed", reason: "session keys not derived" });
      return;
    }
    if (storageUnavailable && !riskAccepted) {
      setState({
        phase: "failed",
        reason: "Storage is unavailable — confirm the risk checkbox to deposit anyway.",
      });
      return;
    }
    setState({ phase: "submitting" });
    try {
      const amountUnits = toUnits(amount, 6); // USDC has 6 decimals
      const amountField = BigInt(amountUnits);
      const assetId = assetIdOf("USDC");
      const salt = randomSalt();
      const commitmentBig = balanceCommitment({
        assetId,
        amount: amountField,
        spendingPubkey,
        salt,
      });
      const commitment = toHex32(commitmentBig);

      // ADR-002: the note's secrets, encrypted to our viewing key, ride
      // the deposit so ANY device can recover this note from chain data.
      const memoBytes = await encryptMemo({
        viewingKey,
        commitment: commitment as `0x${string}`,
        secrets: { noteType: NoteType.Balance, assetId, amount: amountField, salt },
      });
      const encryptedMemo = `0x${Array.from(memoBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

      // WAL: persist the pending record BEFORE the intent leaves this
      // tab, so a crash at any later point is recoverable on unlock.
      await vault?.putPending({
        id: commitment,
        createdAtMs: Date.now(),
        flow: "deposit",
        expectedNotes: [
          [commitment, { kind: "balance", leafIdx: -1, assetId, amount: amountField, salt }],
        ],
        spendsLeaves: [],
      });

      // Real bb.js entry_deposit proof against the depth-20 IMT.
      const witness = buildEntryDepositWitness({
        assetId,
        amount: amountField,
        commitment: commitmentBig,
        spendingPubkey,
        salt,
      });
      const proof = await prove("entry_deposit", {
        witnessMap: witness,
        publicInputs: [
          toHex32(assetId),
          toHex32(amountField),
          toHex32(commitmentBig),
        ],
      });

      // Day 14c-E note: the entry_deposit intent body doesn't yet
      // carry a proofBundle field at the SDK / data-api layer (Day-13
      // schema landed before lending handlers). We still PROVE in the
      // worker so the witness exercises the real Poseidon2 path, but
      // the proof bytes are not posted on this intent kind. Wiring the
      // entry_deposit proof through to ZkVerifier.verifyAndConsume is
      // a small data-api follow-up.
      void proof;

      const accepted = await sdk.intents.create(
        {
          kind: "entry_deposit",
          asset: "USDC",
          amount: amountUnits,
          commitment,
          encryptedMemo,
        },
        { idempotencyKey: `dapp-${commitment.slice(2, 18)}` },
      );
      setState({ phase: "pending", intentId: accepted.intent_id, commitment });
      await vault?.updatePending({
        id: commitment,
        createdAtMs: Date.now(),
        flow: "deposit",
        txHash: accepted.intent_id, // relayer-side handle until tx hash arrives
        expectedNotes: [
          [commitment, { kind: "balance", leafIdx: -1, assetId, amount: amountField, salt }],
        ],
        spendsLeaves: [],
      });

      const final: IntentDetail = await sdk.intents.waitFor(accepted.intent_id, {
        deadlineMs: 90_000,
        pollMs: 500,
      });
      if (final.status === "confirmed") {
        // Mirror the on-chain insert + remember the preimage so a
        // follow-up supply / deposit_collateral / repay can spend it.
        // register() write-throughs to the encrypted vault (M2.6).
        const result = entryImt.insert(commitmentBig);
        noteStore.register(commitmentBig, {
          kind: "balance",
          leafIdx: result.idx,
          assetId,
          amount: amountField,
          salt,
        });
        await vault?.deletePending(commitment);
        const txHash = final.jobs?.[0]?.tx_hash ?? null;
        setState({ phase: "confirmed", intentId: accepted.intent_id, commitment, txHash });
        window.dispatchEvent(new CustomEvent("lending:deposit-confirmed"));
      } else {
        // Definite relayer-reported failure: the tx never landed, the
        // WAL record has nothing to recover — drop it.
        await vault?.deletePending(commitment);
        setState({
          phase: "failed",
          intentId: accepted.intent_id,
          reason: final.failure_reason ?? "unknown failure",
        });
      }
    } catch (err) {
      // Crash/network path: KEEP the WAL record — reconciliation on next
      // unlock decides promote vs drop against chain data.
      const reason = err instanceof Error ? err.message : String(err);
      setState({ phase: "failed", reason });
    }
  };

  const isBusy = state.phase === "submitting" || state.phase === "pending";

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-white/10 bg-white/5 p-6">
      <h2 className="text-base font-semibold">Deposit to PrivacyEntry</h2>
      <p className="mt-1 text-sm text-white/60">
        Move USDC into PrivacyEntry custody. Generates a balance commitment client-side
        and submits as an <code className="font-mono text-white/80">entry_deposit</code> intent.
      </p>

      {storageUnavailable ? (
        <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-200">
            Local note storage is unavailable ({storageUnavailable}).
          </p>
          <p className="mt-1 text-amber-100/70">
            Your notes can still be recovered from chain data with your wallet
            signature, but this browser won&apos;t remember them between visits
            (private mode?). Recovery scans can take a while.
          </p>
          <label className="mt-2 flex items-start gap-2 text-amber-100/80">
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
              className="mt-0.5"
            />
            I understand — deposit without local persistence.
          </label>
        </div>
      ) : null}

      <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-white/60">
        Amount (USDC)
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isBusy}
          className="w-40 rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
        />
        <span className="text-sm text-white/50">USDC (6 decimals)</span>
      </div>

      <button
        type="submit"
        disabled={isBusy || !amount}
        className="mt-5 rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {state.phase === "submitting"
          ? "Submitting intent…"
          : state.phase === "pending"
            ? "Awaiting on-chain confirmation…"
            : "Deposit"}
      </button>

      <StatusPanel state={state} />
    </form>
  );
}

function StatusPanel({ state }: { state: DepositState }) {
  if (state.phase === "idle") return null;
  if (state.phase === "submitting") {
    return <p className="mt-4 text-sm text-white/60">Building commitment + submitting…</p>;
  }
  if (state.phase === "pending") {
    return (
      <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-500/10 p-3 text-sm">
        <p className="text-amber-200">Intent {short(state.intentId)} accepted.</p>
        <p className="mt-1 text-amber-100/70">
          commitment <span className="font-mono">{short(state.commitment, 10)}</span> — waiting for relayer + chain.
        </p>
      </div>
    );
  }
  if (state.phase === "confirmed") {
    return (
      <div className="mt-4 rounded-md border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm">
        <p className="text-emerald-200">Deposit confirmed on-chain.</p>
        <p className="mt-1 text-emerald-100/70">
          intent <span className="font-mono">{short(state.intentId)}</span>
        </p>
        <p className="mt-1 text-emerald-100/70">
          commitment <span className="font-mono">{short(state.commitment, 10)}</span>
        </p>
        {state.txHash ? (
          <p className="mt-1 text-emerald-100/70">
            tx <span className="font-mono">{short(state.txHash, 10)}</span>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm">
      <p className="text-red-200">Deposit failed.</p>
      {state.intentId ? (
        <p className="mt-1 text-red-100/70">intent <span className="font-mono">{short(state.intentId)}</span></p>
      ) : null}
      <p className="mt-1 break-all text-red-100/70">{state.reason}</p>
    </div>
  );
}

function short(value: string, head = 8): string {
  if (value.length <= head * 2 + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-head)}`;
}

// randomCommitment was removed in Day 14c-E: commitments now come from
// `balanceCommitment(...)` over the user's spending_pubkey + a real salt.

function toUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}
