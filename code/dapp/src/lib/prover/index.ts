import type { Prover } from "./types";
import { WorkerProver } from "./workerClient";

/**
 * Device class — S17 §3. We split based on hardwareConcurrency + an
 * optional URL flag (?proverTier=low) so reviewers can force the
 * low-tier code path on a beefy laptop (T-14.3).
 *
 * As of M3 this is advisory only: it decides what warning to show, not which
 * prover to build. See createProver below.
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

/** Human-readable reason a low-tier device may struggle. Null when high tier. */
export function proverTierWarning(tier: DeviceTier): string | null {
  if (tier === "high") return null;
  return (
    "This device looks light on cores or memory for in-browser proving. " +
    "The proof runs entirely on your machine — nothing about your position " +
    "leaves it — so it may take several minutes or run out of memory. " +
    "A desktop or laptop is the reliable path."
  );
}

/**
 * Build the session's prover. Always the browser worker.
 *
 * There used to be a ServerAssistedProver here that low-tier devices routed
 * to. It never called a server: it slept 800 ms and returned 440 zero bytes
 * with a label written into the front. That was harmless against the Anvil
 * mock verifier, which checks a whitelist rather than the bytes. Against the
 * real zkVerify path it is not — Kurier rejects the submission and the user
 * sees a failure with no honest explanation, having been told the device was
 * being helped.
 *
 * So there is no fallback: low-tier devices get the same real prover plus the
 * warning above. Slow and true beats fast and fake, and server-side proving
 * would mean handing the server the witness — every private value the circuit
 * exists to hide.
 *
 * Returned via factory because the worker construction must happen on
 * the client; the calling component holds onto the same instance for
 * the session and calls .terminate() on unmount.
 */
export function createProver(): Prover {
  return new WorkerProver();
}
