/**
 * Browser prover Web Worker -- Day 14c-E swap from synthetic CPU load
 * to real bb.js UltraHonkBackend proving.
 *
 * Per-prove flow:
 *   1. Fetch the compiled circuit artifact at /circuits/<name>.json
 *      (copied from code/circuits/<name>/target/<name>.json by
 *      `scripts/copy-circuit-artifacts.mjs`).
 *   2. Lazily construct a Noir.js + UltraHonkBackend pair per kind;
 *      cache them across proves so subsequent calls skip wasm init.
 *   3. Run `Noir.execute(witnessMap)` -- compiles the structured
 *      witness map (produced by `src/lib/prover/witnesses/`) into the
 *      compressed witness buffer bb.js expects.
 *   4. Run `backend.generateProof(witness)` and return the proof
 *      bytes + public inputs the verifier will check.
 *
 * Per S07 §6 + S17 §3 the heavy work stays off the main thread. The
 * UltraHonkBackend wasm load happens inside the worker, so the page
 * remains responsive even on first prove.
 */

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

import type { CircuitKind, Proof } from "./types";
import { circuitArtifactName } from "./types";
import type { WitnessMap } from "./witnesses";

type Request = {
  id: number;
  kind: CircuitKind;
  witnessMap: WitnessMap;
};

type Response =
  | { id: number; ok: true; proof: Proof }
  | { id: number; ok: false; error: string };

// Per-circuit lazy caches. wasm init is the bulk of first-prove cost
// (~1-2s); proof generation itself dominates wall-clock afterwards.
const artifactCache = new Map<string, unknown>();
const noirCache = new Map<string, Noir>();
const backendCache = new Map<string, UltraHonkBackend>();

let apiPromise: Promise<Barretenberg> | null = null;

function getBarretenberg(): Promise<Barretenberg> {
  if (!apiPromise) {
    // Single Worker thread; one worker per page is enough.
    apiPromise = Barretenberg.new({ threads: 1 });
  }
  return apiPromise;
}

async function getArtifact(name: string): Promise<unknown> {
  const cached = artifactCache.get(name);
  if (cached) return cached;
  const res = await fetch(`/circuits/${name}.json`);
  if (!res.ok) {
    throw new Error(`prover: failed to fetch ${name}.json (${res.status})`);
  }
  const json = (await res.json()) as unknown;
  artifactCache.set(name, json);
  return json;
}

function getNoir(name: string, artifact: unknown): Noir {
  let n = noirCache.get(name);
  if (!n) {
    // Noir.js's constructor accepts the full artifact JSON (it reads
    // `.bytecode` + `.abi` for execute()).
    n = new Noir(artifact as ConstructorParameters<typeof Noir>[0]);
    noirCache.set(name, n);
  }
  return n;
}

function getBackend(name: string, artifact: unknown, api: Barretenberg): UltraHonkBackend {
  let b = backendCache.get(name);
  if (!b) {
    const a = artifact as { bytecode: string };
    b = new UltraHonkBackend(a.bytecode, api);
    backendCache.set(name, b);
  }
  return b;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

async function prove(kind: CircuitKind, witnessMap: WitnessMap): Promise<Proof> {
  const t0 = performance.now();
  const name = circuitArtifactName(kind);
  const [artifact, api] = await Promise.all([getArtifact(name), getBarretenberg()]);
  const noir = getNoir(name, artifact);
  const backend = getBackend(name, artifact, api);

  // Noir.js validates the witnessMap against the circuit ABI and
  // returns the compressed witness Uint8Array bb.js consumes.
  const { witness } = (await (noir as unknown as {
    execute(inputs: WitnessMap): Promise<{ witness: Uint8Array }>;
  }).execute(witnessMap));

  const { proof: proofBytes, publicInputs } = await backend.generateProof(witness, {});

  return {
    proof: toHex(proofBytes),
    publicInputs,
    durationMs: performance.now() - t0,
  };
}

async function handle(req: Request): Promise<Response> {
  try {
    const proof = await prove(req.kind, req.witnessMap);
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
  // Fire-and-forget the async handler; postMessage from inside it
  // when the proof is ready. Multiple concurrent proves are queued
  // on the JS event loop -- bb.js's UltraHonkBackend is not
  // reentrant, so the main thread must serialise via WorkerProver.
  void handle(ev.data).then((res) => {
    (self as unknown as Worker).postMessage(res);
  });
});
