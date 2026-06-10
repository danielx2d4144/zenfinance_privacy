/**
 * Prover interface -- the type contract between the UI and any prover
 * implementation (browser-worker, server-assisted, mock).
 *
 * Day 14c-E switched to REAL bb.js UltraHonkBackend proving driven by
 * Noir.js's `Noir.execute(witnessMap)` against the compiled circuit
 * artifact at `public/circuits/<kind>.json`. The witness map shape is
 * produced by `src/lib/prover/witnesses/`.
 *
 * The proof shape mirrors what zkVerify's UltraHonk submission accepts:
 * a hex-encoded byte blob + the public inputs the circuit committed to.
 */

import type { WitnessMap } from "./witnesses";

export type CircuitKind =
  | "entry_deposit"
  | "entry_withdraw"
  | "supply"
  | "withdraw_supply"
  | "deposit_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay"
  | "liquidate"
  | "consolidate_balance";

/** Map a CircuitKind to its compiled-circuit artifact basename. */
export function circuitArtifactName(kind: CircuitKind): string {
  switch (kind) {
    case "entry_deposit":
      return "entry_deposit";
    case "entry_withdraw":
      return "entry_withdraw";
    case "supply":
      return "supply_asset";
    case "withdraw_supply":
      return "withdraw_supply";
    case "deposit_collateral":
      return "deposit_collateral";
    case "withdraw_collateral":
      return "withdraw_collateral";
    case "borrow":
      return "borrow";
    case "repay":
      return "repay";
    case "liquidate":
      return "liquidate";
    case "consolidate_balance":
      return "consolidate_balance";
  }
}

export interface ProveInput {
  /**
   * Structured witness map produced by `src/lib/prover/witnesses/`.
   * Names + ordering MUST match the circuit's `main()` parameters;
   * Noir.js validates this at `execute` time.
   */
  witnessMap: WitnessMap;
  /**
   * Public inputs the verifier will check. Day-14b's prover-service
   * mock attached them directly to the proof; Day-14c-E surfaces
   * them from the bb.js result (`ProofData.publicInputs`) and they
   * round-trip through the relayer + ZkVerifier.verifyAndConsume.
   *
   * Provided redundantly here so call sites (e.g. the LendingForm)
   * that already know the public inputs can include them for the
   * data-api intent body without re-deriving from the proof.
   */
  publicInputs: string[];
}

export interface Proof {
  /** UltraHonk proof bytes, 0x-prefixed. */
  proof: `0x${string}`;
  publicInputs: string[];
  /** Wall-clock prove time, ms -- used by the device-class detector. */
  durationMs: number;
}

export interface Prover {
  prove(kind: CircuitKind, input: ProveInput): Promise<Proof>;
  terminate(): void;
}
