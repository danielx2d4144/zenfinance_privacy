/**
 * Browser prover Web Worker.
 *
 * Currently a synthetic CPU load that mimics the wall-clock + memory
 * profile of a real bb.js UltraHonk proof. Real circuit-driven proving
 * lands in Day 14c (the Pedersen swap), not Day 14b — because today's
 * placeholder keccak Merkle root (PrivacyEntry.sol:233 Day-2 TODO)
 * makes the circuit's `computed_root == root_balance` assert
 * unsatisfiable: the contract hashes via keccak, the circuit via
 * Pedersen. Once the contract-side hash function lines up with the
 * circuit's, swap `syntheticCompute` here for the real
 * `UltraHonkBackend.prove(circuitJson, witness)` call against the
 * artifact at `public/circuits/<name>.json`.
 *
 * Per S07 §6 + S17 §3 the heavy work MUST stay off the main thread.
 * T-14.1 covers this: scroll/click the page while a prove() is in
 * flight; the page must stay responsive.
 */

import type { CircuitKind, ProveInput, Proof } from "./types";

type Request = {
  id: number;
  kind: CircuitKind;
  input: ProveInput;
};

type Response =
  | { id: number; ok: true; proof: Proof }
  | { id: number; ok: false; error: string };

const ITERATIONS_PER_MS = 60_000;

function syntheticProveDuration(kind: CircuitKind): number {
  switch (kind) {
    case "supply":
    case "withdraw_supply":
    case "deposit_collateral":
    case "withdraw_collateral":
    case "repay":
      return 4_500;
    case "borrow":
    case "liquidate":
      return 5_500;
    case "consolidate_balance":
      return 6_500;
    default:
      return 5_000;
  }
}

function syntheticCompute(targetMs: number): Uint8Array {
  const buf = new Uint8Array(64);
  const deadline = performance.now() + targetMs;
  let acc = 0;
  while (performance.now() < deadline) {
    for (let i = 0; i < ITERATIONS_PER_MS; i++) {
      acc = (acc + 0x9e3779b1) | 0;
      buf[i & 63] = (buf[i & 63] ^ (acc & 0xff)) & 0xff;
    }
  }
  return buf;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function handle(req: Request): Response {
  const start = performance.now();
  try {
    const target = syntheticProveDuration(req.kind);
    const tail = syntheticCompute(target);
    const header = new TextEncoder().encode(
      `synthetic-${req.kind}-${req.input.publicInputs.join(",")}`,
    );
    const proofBytes = new Uint8Array(440);
    proofBytes.set(header.slice(0, Math.min(header.length, proofBytes.length)));
    proofBytes.set(tail, Math.max(0, proofBytes.length - tail.length));
    const proof: Proof = {
      proof: toHex(proofBytes),
      publicInputs: req.input.publicInputs,
      durationMs: performance.now() - start,
    };
    return { id: req.id, ok: true, proof };
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

self.addEventListener("message", (ev: MessageEvent<Request>) => {
  const res = handle(ev.data);
  (self as unknown as Worker).postMessage(res);
});
