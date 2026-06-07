/**
 * Prover interface — the type contract between the UI and any prover
 * implementation (browser-worker, server-assisted, mock).
 *
 * Day-14 ships the Web-Worker prover scaffolding with a synthetic
 * compute load standing in for real bb.js circuit proving. Real
 * circuit artifacts (.json + verification key) get wired in alongside
 * the supply/borrow/repay/withdraw_collateral backend handlers.
 *
 * The proof shape mirrors what zkVerify's UltraHonk submission accepts:
 * a hex-encoded byte blob + the public inputs the circuit committed to.
 */

export type CircuitKind =
  | "supply"
  | "withdraw_supply"
  | "deposit_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay"
  | "liquidate"
  | "consolidate_balance";

export interface ProveInput {
  /** Witness fields — circuit-specific shape; the worker hands them to bb.js as-is. */
  witness: Record<string, string>;
  /** Public inputs the verifier will check; mirrored in the proof's public-input slot. */
  publicInputs: string[];
}

export interface Proof {
  /** UltraHonk proof bytes, 0x-prefixed. */
  proof: `0x${string}`;
  publicInputs: string[];
  /** Wall-clock prove time, ms — used by the device-class detector. */
  durationMs: number;
}

export interface Prover {
  prove(kind: CircuitKind, input: ProveInput): Promise<Proof>;
  terminate(): void;
}
