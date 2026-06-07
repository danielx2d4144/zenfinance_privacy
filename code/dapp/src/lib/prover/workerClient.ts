import type { CircuitKind, Proof, ProveInput, Prover } from "./types";

/**
 * Main-thread handle to the worker. Constructs the worker via Webpack's
 * `new Worker(new URL(...), { type: "module" })` pattern so Next bundles
 * it as a separate chunk and never inlines the prover code into the
 * page bundle.
 */
export class WorkerProver implements Prover {
  private readonly worker: Worker;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (p: Proof) => void; reject: (err: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "lending-prover",
    });
    this.worker.addEventListener("message", (ev) => this.onMessage(ev));
    this.worker.addEventListener("error", (ev) => {
      for (const { reject } of this.pending.values()) reject(new Error(ev.message ?? "worker error"));
      this.pending.clear();
    });
  }

  prove(kind: CircuitKind, input: ProveInput): Promise<Proof> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, kind, input });
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error("prover terminated"));
    this.pending.clear();
  }

  private onMessage(ev: MessageEvent<{ id: number; ok: boolean; proof?: Proof; error?: string }>) {
    const { id, ok, proof, error } = ev.data;
    const slot = this.pending.get(id);
    if (!slot) return;
    this.pending.delete(id);
    if (ok && proof) slot.resolve(proof);
    else slot.reject(new Error(error ?? "unknown prover error"));
  }
}
