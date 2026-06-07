"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { deriveSpendingKey } from "@/lib/spending-key";

import { useWallet } from "./useWallet";

/**
 * Spending-key state holder. React state only — never localStorage,
 * never sessionStorage, never IndexedDB. Per I-CRYPTO-1, the key must
 * vanish when the user closes the tab. T-13.2 verifies this.
 *
 * Reset on disconnect or chain switch out of the supported set to
 * prevent a stale key being used against the wrong account.
 */

type SpendingKeyContextValue = {
  spendingKey: Uint8Array | null;
  isDeriving: boolean;
  error: string | null;
  derive: () => Promise<void>;
  clear: () => void;
};

const SpendingKeyContext = createContext<SpendingKeyContextValue | null>(null);

export function SpendingKeyProvider({ children }: { children: ReactNode }) {
  const { address, signMessageAsync } = useWallet();
  const [spendingKey, setSpendingKey] = useState<Uint8Array | null>(null);
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derive = useCallback(async () => {
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    setIsDeriving(true);
    setError(null);
    try {
      const key = await deriveSpendingKey({
        address,
        signMessage: (message) => signMessageAsync({ message }),
      });
      setSpendingKey(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDeriving(false);
    }
  }, [address, signMessageAsync]);

  const clear = useCallback(() => {
    setSpendingKey(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ spendingKey, isDeriving, error, derive, clear }),
    [spendingKey, isDeriving, error, derive, clear],
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
