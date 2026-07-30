import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TabLock } from "../tab-lock.ts";

/**
 * Minimal in-memory Web Locks implementation with the two behaviors
 * TabLock relies on: `ifAvailable` immediate grant/deny, and queued
 * waiting requests that resolve when the holder's callback settles.
 */
class FakeLockManager {
  private holders = new Map<string, Promise<unknown>>();
  private queues = new Map<string, Array<() => void>>();

  request = async (
    name: string,
    opts: { ifAvailable: boolean },
    cb: (lock: { name: string } | null) => Promise<unknown>,
  ): Promise<unknown> => {
    if (this.holders.has(name)) {
      if (opts.ifAvailable) return cb(null);
      await new Promise<void>((resolve) => {
        const q = this.queues.get(name) ?? [];
        q.push(resolve);
        this.queues.set(name, q);
      });
    }
    const held = cb({ name });
    this.holders.set(name, held);
    try {
      return await held;
    } finally {
      this.holders.delete(name);
      const next = this.queues.get(name)?.shift();
      next?.();
    }
  };
}

const SCOPE = { chainId: 31337, address: "0xAAAA000000000000000000000000000000000000" };

const savedNavigator = globalThis.navigator;
let fake: FakeLockManager;

beforeEach(() => {
  fake = new FakeLockManager();
  Object.defineProperty(globalThis, "navigator", {
    value: { locks: fake },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: savedNavigator,
    configurable: true,
  });
});

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("TabLock", () => {
  it("first tab becomes exclusive writer", async () => {
    const tab = await TabLock.acquire(SCOPE);
    await tick();
    expect(tab.role).toEqual({ role: "writer", exclusive: true });
    tab.release();
  });

  it("second tab is read-only while the first holds the lock", async () => {
    const tab1 = await TabLock.acquire(SCOPE);
    await tick();
    const tab2 = await TabLock.acquire(SCOPE);
    await tick();

    expect(tab1.role.role).toBe("writer");
    expect(tab2.role).toEqual({ role: "reader", exclusive: true });
    tab1.release();
    tab2.release();
  });

  it("reader takes over when the writer releases", async () => {
    const tab1 = await TabLock.acquire(SCOPE);
    await tick();
    const tab2 = await TabLock.acquire(SCOPE);
    await tick();
    expect(tab2.role.role).toBe("reader");

    const roleChanges: string[] = [];
    tab2.onChange((r) => roleChanges.push(r.role));

    tab1.release();
    await tick();
    await tick();

    expect(tab2.role.role).toBe("writer");
    expect(roleChanges).toContain("writer");
    tab2.release();
  });

  it("separate scopes don't contend", async () => {
    const tabA = await TabLock.acquire(SCOPE);
    await tick();
    const tabB = await TabLock.acquire({ ...SCOPE, chainId: 845320009 });
    await tick();
    expect(tabA.role.role).toBe("writer");
    expect(tabB.role.role).toBe("writer");
    tabA.release();
    tabB.release();
  });

  it("falls back to non-exclusive writer when navigator.locks is missing", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    const tab = await TabLock.acquire(SCOPE);
    expect(tab.role).toEqual({ role: "writer", exclusive: false });
    tab.release();
  });
});
