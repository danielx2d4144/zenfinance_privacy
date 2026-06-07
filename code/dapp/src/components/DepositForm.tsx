"use client";

import { useMemo, useState } from "react";

import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";
import { bytesToHex } from "@/lib/spending-key";

import { ConnectGate } from "./ConnectGate";

import { LendingSdk, type IntentDetail } from "@lending/sdk-ts";

/**
 * Day-13 PrivacyEntry deposit screen. The commitment is a placeholder
 * (random 32 bytes for now); Day 14 wires it to a real Pedersen note
 * commitment computed in a Web Worker with @aztec/bb.js.
 *
 * Submission goes through the data-API; the dapp never speaks to the
 * chain directly — that's the relayer's job (S13 §3 / I-OPS-3).
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
  const { spendingKey, derive, isDeriving, error: keyError } = useSpendingKey();

  const [amount, setAmount] = useState("100");
  const [state, setState] = useState<DepositState>({ phase: "idle" });

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

  if (!spendingKey) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/70">
          One-time spending-key derivation
        </h3>
        <p className="mt-2 text-sm text-white/60">
          We need your wallet signature to derive the secret that controls your private
          balance. The key lives only in this tab — close it and the key is gone.
        </p>
        {keyError ? <p className="mt-3 text-sm text-red-300">{keyError}</p> : null}
        <button
          type="button"
          onClick={() => void derive()}
          disabled={isDeriving}
          className="mt-4 rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {isDeriving ? "Awaiting signature…" : "Sign to derive spending key"}
        </button>
      </div>
    );
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setState({ phase: "submitting" });
    try {
      const commitment = randomCommitment();
      const amountUnits = toUnits(amount, 6); // USDC has 6 decimals
      const accepted = await sdk.intents.create(
        {
          kind: "entry_deposit",
          asset: "USDC",
          amount: amountUnits,
          commitment,
        },
        { idempotencyKey: `dapp-${commitment.slice(2, 18)}` },
      );
      setState({ phase: "pending", intentId: accepted.intent_id, commitment });

      const final: IntentDetail = await sdk.intents.waitFor(accepted.intent_id, {
        deadlineMs: 90_000,
        pollMs: 500,
      });
      if (final.status === "confirmed") {
        const txHash = final.jobs?.[0]?.tx_hash ?? null;
        setState({ phase: "confirmed", intentId: accepted.intent_id, commitment, txHash });
        window.dispatchEvent(new CustomEvent("lending:deposit-confirmed"));
      } else {
        setState({
          phase: "failed",
          intentId: accepted.intent_id,
          reason: final.failure_reason ?? "unknown failure",
        });
      }
    } catch (err) {
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

function randomCommitment(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${bytesToHex(bytes)}`;
}

function toUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}
