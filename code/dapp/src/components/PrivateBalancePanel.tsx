"use client";

import { useEffect, useState } from "react";

import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";

/**
 * Per S07 §3.5 + §4, the user's private balance is derived from a local
 * note store, NOT from the subgraph (queries would leak commitments to
 * the indexer). M2.6: the store is hydrated from the encrypted vault on
 * unlock and reconciled against chain data by the background recovery
 * scan (WAL promote + memo trial-decryption) — this panel surfaces that
 * pipeline's status.
 */
export function PrivateBalancePanel() {
  const { isConnected } = useWallet();
  const { unlocked, noteStore, recovery, storageUnavailable, tabRole } = useSpendingKey();
  const [, setTick] = useState(0);

  useEffect(() => {
    function onDeposit() {
      setTick((n) => n + 1);
    }
    window.addEventListener("lending:deposit-confirmed", onDeposit);
    return () => window.removeEventListener("lending:deposit-confirmed", onDeposit);
  }, []);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6">
        <h2 className="text-base font-semibold">Private balance</h2>
        <p className="mt-2 text-sm text-white/60">Connect to view.</p>
      </div>
    );
  }

  const balanceNotes = unlocked ? noteStore.size("balance") : 0;
  const supplyNotes = unlocked ? noteStore.size("supply") : 0;
  const positions = unlocked ? noteStore.size("position") : 0;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <h2 className="text-base font-semibold">Private balance</h2>
      <p className="mt-2 text-sm text-white/60">
        Derived from your local note store. Nothing here is fetched from the indexer.
      </p>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Session</dt>
          <dd className="font-mono">{unlocked ? "✓ unlocked" : "locked"}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Balance notes</dt>
          <dd className="font-mono">{balanceNotes}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Supply notes / positions</dt>
          <dd className="font-mono">
            {supplyNotes} / {positions}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Tab role</dt>
          <dd className="font-mono">{tabRole.role}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Chain sync</dt>
          <dd className="font-mono">
            {recovery.status === "idle" && "—"}
            {recovery.status === "scanning" &&
              `scanning ${recovery.scannedTo}/${recovery.head}`}
            {recovery.status === "done" &&
              `✓ synced (${recovery.recovered} recovered, ${recovery.walPromoted} WAL)`}
            {recovery.status === "error" && "⚠ interrupted"}
          </dd>
        </div>
      </dl>

      {recovery.status === "error" ? (
        <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-500/10 p-2 text-xs text-amber-200">
          Recovery scan was interrupted ({recovery.message}). Balances shown may be
          incomplete — the scan resumes on the next unlock.
        </p>
      ) : null}
      {storageUnavailable ? (
        <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-500/10 p-2 text-xs text-amber-200">
          Local storage unavailable ({storageUnavailable}) — notes will be recovered
          from chain data on each visit.
        </p>
      ) : null}
    </div>
  );
}
