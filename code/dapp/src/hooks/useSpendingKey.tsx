"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LocalIMT } from "@/lib/imt.ts";
import { spendingPubkeyOf } from "@/lib/witness.ts";
import { deriveSpendingKey } from "@/lib/spending-key.ts";

import { useWallet } from "./useWallet.ts";

/**
 * Spending-key + LocalIMT state holder.
 *
 * React state only -- never localStorage, sessionStorage, or IndexedDB.
 * Per I-CRYPTO-1, the key must vanish when the user closes the tab.
 * T-13.2 verifies this. Day 14c Stage D additionally hosts the dapp's
 * mirror of the three on-chain Poseidon2 IMTs (PrivacyEntry,
 * ShieldedSupplyPool, ShieldedPositionPool) so `rootAtProveTime` in
 * each intent matches the contract's `known()` lookup. The IMTs are
 * session-only mirrors -- they reset on disconnect or `clear()` and
 * must be re-synced from chain state (subgraph) on every load. The
 * sync path lands in Stage F; for Day 14c they start empty.
 */

type SpendingKeyContextValue = {
  /** Raw HKDF output (32 bytes). Backward-compat for DepositForm. */
  spendingKey: Uint8Array | null;
  /** Field-reduced secret_key (bigint < BN254_FR). Day 14c Stage D. */
  secretKey: bigint | null;
  /** Cached spending_pubkey = h([TAG_SPENDING_PUBKEY, secret_key]). */
  spendingPubkey: bigint | null;
  /** Local mirror of PrivacyEntry's Poseidon2 IMT. */
  entryImt: LocalIMT;
  /** Local mirror of ShieldedSupplyPool's Poseidon2 IMT. */
  supplyImt: LocalIMT;
  /** Local mirror of ShieldedPositionPool's Poseidon2 IMT. */
  positionImt: LocalIMT;
  isDeriving: boolean;
  error: string | null;
  derive: () => Promise<void>;
  clear: () => void;
};

const SpendingKeyContext = createContext<SpendingKeyContextValue | null>(null);

export function SpendingKeyProvider({ children }: { children: ReactNode }) {
  const { address, signMessageAsync } = useWallet();
  const [spendingKey, setSpendingKey] = useState<Uint8Array | null>(null);
  const [secretKey, setSecretKey] = useState<bigint | null>(null);
  const [spendingPubkey, setSpendingPubkey] = useState<bigint | null>(null);
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so the IMT instances survive re-renders without forcing a
  // new tree each time. On clear() we drop these too.
  const entryImtRef = useRef<LocalIMT>(new LocalIMT());
  const supplyImtRef = useRef<LocalIMT>(new LocalIMT());
  const positionImtRef = useRef<LocalIMT>(new LocalIMT());

  const derive = useCallback(async () => {
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    setIsDeriving(true);
    setError(null);
    try {
      const derived = await deriveSpendingKey({
        address,
        signMessage: (message) => signMessageAsync({ message }),
      });
      setSpendingKey(derived.bytes);
      setSecretKey(derived.secretKey);
      setSpendingPubkey(spendingPubkeyOf(derived.secretKey));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDeriving(false);
    }
  }, [address, signMessageAsync]);

  const clear = useCallback(() => {
    setSpendingKey(null);
    setSecretKey(null);
    setSpendingPubkey(null);
    setError(null);
    entryImtRef.current = new LocalIMT();
    supplyImtRef.current = new LocalIMT();
    positionImtRef.current = new LocalIMT();
  }, []);

  const value = useMemo(
    () => ({
      spendingKey,
      secretKey,
      spendingPubkey,
      entryImt: entryImtRef.current,
      supplyImt: supplyImtRef.current,
      positionImt: positionImtRef.current,
      isDeriving,
      error,
      derive,
      clear,
    }),
    [spendingKey, secretKey, spendingPubkey, isDeriving, error, derive, clear],
  );

  return <SpendingKeyContext.Provider value={value}>{children}</SpendingKeyContext.Provider>;
}

export function useSpendingKey(): SpendingKeyContextValue {
  const ctx = useContext(SpendingKeyContext);
  if (!ctx) {
    throw new Error("useSpendingKey must be used inside <SpendingKeyProvider>");
  }
  return ctx;
}
