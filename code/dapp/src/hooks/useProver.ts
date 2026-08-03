"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createProver,
  detectDeviceTier,
  proverTierWarning,
  type DeviceTier,
} from "@/lib/prover";
import type { CircuitKind, Proof, ProveInput, Prover } from "@/lib/prover/types";

/**
 * Owns the per-session Prover. The hook is the only place the rest of
 * the app touches the prover; the worker is constructed lazily on
 * first prove() call so we don't spin up workers for users who never
 * trigger a lending flow.
 *
 * `tier` is advisory now — every device proves in the browser. It only drives
 * `tierWarning`, so a weak device is told the truth up front instead of being
 * quietly handed a fake proof.
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
      proverRef.current = createProver();
    }
    return proverRef.current;
  }, []);

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

  const tierWarning = useMemo(() => proverTierWarning(tier), [tier]);

  return useMemo(
    () => ({ tier, tierWarning, isProving, lastDurationMs, prove }),
    [tier, tierWarning, isProving, lastDurationMs, prove],
  );
}
