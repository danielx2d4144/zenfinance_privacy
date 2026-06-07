"use client";

import { useEffect, useState } from "react";

import { useSpendingKey } from "@/hooks/useSpendingKey";
import { useWallet } from "@/hooks/useWallet";

/**
 * Per S07 §3.5 + §4, the user's private balance is derived from a local
 * note store, NOT from the subgraph (queries would leak commitments to
 * the indexer). Day-14 will wire @aztec/bb.js + a real note-store; for
 * Day 13 we show the session-only commitment count derived from
 * spending-key presence + an in-memory counter that the DepositForm
 * bumps via a custom event.
 */
export function PrivateBalancePanel() {
  const { isConnected } = useWallet();
  const { spendingKey } = useSpendingKey();
  const [sessionDeposits, setSessionDeposits] = useState(0);

  useEffect(() => {
    function onDeposit() {
      setSessionDeposits((n) => n + 1);
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
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <h2 className="text-base font-semibold">Private balance</h2>
      <p className="mt-2 text-sm text-white/60">
        Derived from your local note store. Nothing here is fetched from the indexer.
      </p>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Spending key in this session</dt>
          <dd className="font-mono">{spendingKey ? "✓ derived" : "—"}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-white/60">Confirmed deposits in this session</dt>
          <dd className="font-mono">{sessionDeposits}</dd>
        </div>
      </dl>

      <p className="mt-5 text-xs text-white/40">
        Persistent note storage + per-asset balance ships in Day 14 alongside the
        browser prover.
      </p>
    </div>
  );
}
