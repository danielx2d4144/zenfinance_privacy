"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createProverForTier, detectDeviceTier, type DeviceTier } from "@/lib/prover";
import type { CircuitKind, Proof, ProveInput, Prover } from "@/lib/prover/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

/**
 * Owns the per-session Prover. The hook is the only place the rest of
 * the app touches the prover; the worker is constructed lazily on
 * first prove() call so we don't spin up workers for users who never
 * trigger a lending flow.
 */
export function useProver() {
  const [tier, setTier] = useState<DeviceTier>("high");
  const [isProving, setIsProving] = useState(false);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);
  const proverRef = useRef<Prover | null>(null);

  useEffect(() => {
    setTier(detectDeviceTier());
    return () => {
      proverRef.current?.terminate();
      proverRef.current = null;
    };
  }, []);

  const ensureProver = useCallback((): Prover => {
    if (!proverRef.current) {
      proverRef.current = createProverForTier({
        tier,
        baseUrl: API_BASE_URL,
        apiKey: API_KEY,
      });
    }
    return proverRef.current;
  }, [tier]);

  const prove = useCallback(
    async (kind: CircuitKind, input: ProveInput): Promise<Proof> => {
      setIsProving(true);
      try {
        const p = ensureProver();
        const proof = await p.prove(kind, input);
        setLastDurationMs(proof.durationMs);
        return proof;
      } finally {
        setIsProving(false);
      }
    },
    [ensureProver],
  );

  return useMemo(
    () => ({ tier, isProving, lastDurationMs, prove }),
    [tier, isProving, lastDurationMs, prove],
  );
}
