"use client";

import { useEffect, useMemo, useState } from "react";

export type ProofStage =
  | "idle"
  | "proving"
  | "submitting"
  | "aggregating"
  | "posting"
  | "confirmed"
  | "failed";

/**
 * Five-stage proof + aggregation progress per S07 §3.4.
 *
 * The "aggregating" bar is the trickiest: zkVerify's batch cadence is
 * 3-7 min and the dapp has no event for "your proof slotted into a
 * batch yet" — we just see a long pending state. We render a smoothed
 * progress curve that asymptotically approaches but never reaches 100%
 * (so it never lies about being "almost done"), and snaps to 100% on
 * transition to `posting`.
 */
const STAGE_COPY: Record<ProofStage, { title: string; body: string }> = {
  idle: { title: "Idle", body: "" },
  proving: {
    title: "Generating proof",
    body: "Your browser is computing the ZK proof. ~5 s on a typical laptop.",
  },
  submitting: {
    title: "Submitting to aggregator",
    body: "Proof handed to the protocol's data-API; it forwards to zkVerify's Kurier.",
  },
  aggregating: {
    title: "Aggregating with zkVerify",
    body: "Your proof is sharing a batch with other users. 3-7 min typical; reduces per-tx cost ~100×.",
  },
  posting: {
    title: "Posting to chain",
    body: "Aggregated proof posted to Horizen; the relayer is broadcasting your tx.",
  },
  confirmed: {
    title: "Confirmed on-chain",
    body: "Your private position is updated.",
  },
  failed: {
    title: "Failed",
    body: "Something went wrong. See the message below.",
  },
};

const STAGE_ORDER: ProofStage[] = [
  "proving",
  "submitting",
  "aggregating",
  "posting",
  "confirmed",
];

export interface ProofProgressModalProps {
  stage: ProofStage;
  /** Optional: shown under the title when failed. */
  errorMessage?: string;
  /** Optional: shown under "Confirmed" with a click-through to the explorer. */
  txHash?: string | null;
  /** Estimated aggregation duration, ms. Defaults to 4 min (zkVerify avg). */
  aggregationEtaMs?: number;
  onClose?: () => void;
}

const DEFAULT_AGG_ETA = 4 * 60 * 1000;

export function ProofProgressModal({
  stage,
  errorMessage,
  txHash,
  aggregationEtaMs = DEFAULT_AGG_ETA,
  onClose,
}: ProofProgressModalProps) {
  const [aggStartedAt, setAggStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (stage === "aggregating") {
      setAggStartedAt((prev) => prev ?? Date.now());
    }
    if (stage !== "aggregating" && stage !== "submitting") {
      setAggStartedAt(null);
    }
  }, [stage]);

  useEffect(() => {
    if (stage !== "aggregating") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const aggregationProgress = useMemo(() => {
    if (stage === "posting" || stage === "confirmed") return 1;
    if (stage !== "aggregating" || !aggStartedAt) return 0;
    const elapsed = (now - aggStartedAt) / aggregationEtaMs;
    return 1 - Math.exp(-elapsed * 1.6);
  }, [stage, aggStartedAt, now, aggregationEtaMs]);

  if (stage === "idle") return null;
  const copy = STAGE_COPY[stage];
  const isTerminal = stage === "confirmed" || stage === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight">{copy.title}</h3>
            <p className="mt-1 text-sm text-white/60">{copy.body}</p>
          </div>
          {isTerminal && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/5"
            >
              close
            </button>
          ) : null}
        </header>

        <ol className="mt-6 space-y-2">
          {STAGE_ORDER.map((s) => {
            const reached =
              stage === "failed" ? s === STAGE_ORDER[0] : STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(s);
            const current = s === stage;
            const dotColor = current
              ? "bg-emerald-400"
              : reached
                ? "bg-emerald-500/60"
                : "bg-white/15";
            const labelColor = current ? "text-white" : reached ? "text-white/70" : "text-white/40";
            return (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
                <span className={labelColor}>{STAGE_COPY[s].title}</span>
                {current && s === "aggregating" ? (
                  <span className="ml-auto text-xs text-white/40">
                    {Math.round(aggregationProgress * 100)}%
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {stage === "aggregating" ? (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full bg-emerald-500 transition-all duration-700 ease-out"
              style={{ width: `${aggregationProgress * 100}%` }}
            />
          </div>
        ) : null}

        {stage === "confirmed" && txHash ? (
          <p className="mt-4 break-all text-xs text-emerald-300">
            tx <span className="font-mono">{txHash}</span>
          </p>
        ) : null}
        {stage === "failed" && errorMessage ? (
          <p className="mt-4 break-all text-xs text-red-300">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
