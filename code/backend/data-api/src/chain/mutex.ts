/**
 * Single-flight mutex around the relayer's chain section. viem fetches the
 * next nonce when `nonce` is unset on writeContract; concurrent handlers
 * race and one of them gets "nonce too low" once an earlier tx mines.
 *
 * The Day-11 surface only has one relayer + low throughput (one tx per
 * deposit). A mutex is correct AND cheap; we'll switch to a managed-nonce
 * approach (e.g., per-account counter pre-incremented before send) when
 * volume warrants.
 */
let chain: Promise<unknown> = Promise.resolve();

export async function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = chain;
  let release!: (value: void) => void;
  const gate = new Promise<void>((res) => (release = res));
  chain = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
