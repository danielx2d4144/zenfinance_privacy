/**
 * M2.4 — cross-tab write exclusivity (plan D13=6A).
 *
 * Exactly one tab may create notes / submit txs per {chainId, address}
 * scope; every other tab is read-only with a banner. Two mechanisms:
 *
 *   - navigator.locks (Web Locks API): the writer holds a named lock for
 *     its lifetime; others fail `ifAvailable` acquisition and watch for
 *     release. Owned by the browser — released automatically on tab
 *     close/crash, which is exactly the semantics WAL recovery wants.
 *   - BroadcastChannel: writer announces acquire/release so readers can
 *     flip to writer without polling when the writer tab goes away.
 *
 * Environments without navigator.locks (old Safari, some webviews) fall
 * back to single-writer-optimism: the tab reports `writer` but flags
 * `exclusive: false` so the UI can show a softer "don't open two tabs"
 * warning. Never silently unsafe.
 */

export interface TabRole {
  role: "writer" | "reader";
  /** true when a real Web Lock enforces exclusivity. */
  exclusive: boolean;
}

export type TabRoleListener = (role: TabRole) => void;

export class TabLock {
  private listeners = new Set<TabRoleListener>();
  private channel: BroadcastChannel | null = null;
  private current: TabRole = { role: "reader", exclusive: false };
  private releaseLock: (() => void) | null = null;
  private closed = false;

  private constructor(private readonly name: string) {}

  static async acquire(scope: { chainId: number; address: string }): Promise<TabLock> {
    const name = `zenfinance-writer:v1:${scope.chainId}:${scope.address.toLowerCase()}`;
    const lock = new TabLock(name);
    if (typeof BroadcastChannel !== "undefined") {
      lock.channel = new BroadcastChannel(name);
      lock.channel.onmessage = (ev) => {
        if (ev.data === "released" && lock.current.role === "reader") {
          // Writer went away — try to take over.
          void lock.tryBecomeWriter();
        }
      };
    }
    await lock.tryBecomeWriter();
    return lock;
  }

  get role(): TabRole {
    return this.current;
  }

  onChange(listener: TabRoleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Release the writer lock (disconnect / vault close). */
  release(): void {
    this.closed = true;
    this.releaseLock?.();
    this.releaseLock = null;
    this.channel?.postMessage("released");
    this.channel?.close();
    this.channel = null;
  }

  // -------------------------------------------------------------- internal

  private async tryBecomeWriter(): Promise<void> {
    if (this.closed) return;
    const locks: LockManager | undefined =
      typeof navigator !== "undefined" ? navigator.locks : undefined;

    if (!locks) {
      this.set({ role: "writer", exclusive: false });
      return;
    }

    // IMPORTANT: `locks.request(...)` resolves only when its callback
    // settles — and the writer callback deliberately stays PENDING for
    // as long as we hold the lock. Awaiting the request itself would
    // therefore deadlock. We await role determination instead.
    await new Promise<void>((roleSettled) => {
      // `ifAvailable` invokes the callback immediately: with the lock
      // when free, with null when another tab holds it.
      void locks.request(this.name, { ifAvailable: true }, async (granted) => {
        if (!granted) {
          this.set({ role: "reader", exclusive: true });
          roleSettled();
          // Queue for takeover: a waiting request that is granted when
          // the current writer disappears (close/crash/release).
          void locks.request(this.name, { ifAvailable: false }, async (lock) => {
            if (!lock || this.closed) return;
            await this.holdAsWriter();
          });
          return;
        }
        const held = this.holdAsWriter(); // sets role synchronously
        roleSettled();
        await held; // pending until release() — this IS holding the lock
      });
    });
  }

  private holdAsWriter(): Promise<void> {
    this.set({ role: "writer", exclusive: true });
    this.channel?.postMessage("acquired");
    return new Promise<void>((resolve) => {
      this.releaseLock = () => {
        this.set({ role: "reader", exclusive: true });
        resolve();
      };
    });
  }

  private set(role: TabRole): void {
    this.current = role;
    for (const l of this.listeners) l(role);
  }
}
