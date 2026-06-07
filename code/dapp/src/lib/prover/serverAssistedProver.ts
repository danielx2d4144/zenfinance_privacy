import type { CircuitKind, Proof, ProveInput, Prover } from "./types";

/**
 * Server-assisted prover (S17 §4 low-tier path). The dapp calls the
 * data-API's /v1/prove endpoint; the server computes the proof on
 * behalf of the user.
 *
 * Day-14: the endpoint isn't wired yet. We return a synthetic proof
 * after a short network-style delay so the UI can demonstrate the
 * adaptive-routing decision (T-14.3) without false-positive failures.
 * The real backend prover lands alongside circuit artifacts.
 */
export class ServerAssistedProver implements Prover {
  constructor(_opts: { baseUrl: string; apiKey?: string }) {}

  async prove(kind: CircuitKind, input: ProveInput): Promise<Proof> {
    const start = performance.now();
    await new Promise((res) => setTimeout(res, 800));
    const tag = new TextEncoder().encode(
      `server-assisted-${kind}-${input.publicInputs.join(",")}`,
    );
    const proofBytes = new Uint8Array(440);
    proofBytes.set(tag.slice(0, Math.min(tag.length, proofBytes.length)));
    let hex = "0x";
    for (const b of proofBytes) hex += b.toString(16).padStart(2, "0");
    return {
      proof: hex as `0x${string}`,
      publicInputs: input.publicInputs,
      durationMs: performance.now() - start,
    };
  }

  terminate(): void {
    /* nothing to clean up */
  }
}
