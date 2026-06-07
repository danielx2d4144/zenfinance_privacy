import { ServerAssistedProver } from "./serverAssistedProver";
import type { Prover } from "./types";
import { WorkerProver } from "./workerClient";

/**
 * Device class — S17 §3. We split based on hardwareConcurrency + an
 * optional URL flag (?proverTier=low) so reviewers can force the
 * low-tier code path on a beefy laptop (T-14.3).
 */
export type DeviceTier = "high" | "low";

export function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "high";

  const sp = new URLSearchParams(window.location.search);
  const forced = sp.get("proverTier");
  if (forced === "low" || forced === "high") return forced;

  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores < 4) return "low";

  type DeviceMemoryNav = Navigator & { deviceMemory?: number };
  const mem = (navigator as DeviceMemoryNav).deviceMemory;
  if (typeof mem === "number" && mem < 4) return "low";

  return "high";
}

/**
 * Pick a prover for the detected device tier. The browser-worker prover
 * is the default; low-tier devices route to the server-assisted prover
 * so users with old hardware don't burn battery proving locally.
 *
 * Returned via factory because the worker construction must happen on
 * the client; the calling component holds onto the same instance for
 * the session and calls .terminate() on unmount.
 */
export function createProverForTier(args: {
  tier: DeviceTier;
  baseUrl: string;
  apiKey?: string;
}): Prover {
  return args.tier === "low"
    ? new ServerAssistedProver({ baseUrl: args.baseUrl, apiKey: args.apiKey })
    : new WorkerProver();
}
