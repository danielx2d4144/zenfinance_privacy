import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { NoteVault, type WalRecord } from "../note-vault.ts";
import {
  buildCommitmentIndex,
  reconcileWal,
  reconcileWalRecord,
  WAL_DROP_AFTER_MS,
} from "../commitment-matcher.ts";
import type { BalanceNotePreimage } from "../note-store.ts";

const KEY = new Uint8Array(32).fill(4);
const SCOPE = { chainId: 31337, address: "0x1111111111111111111111111111111111111111" };

const LEAF_NEW = "0x00000000000000000000000000000000000000000000000000000000000000b1";
const LEAF_RESIDUAL = "0x00000000000000000000000000000000000000000000000000000000000000b2";
const LEAF_SPENT = "0x00000000000000000000000000000000000000000000000000000000000000a0";

const PREIMAGE: BalanceNotePreimage = {
  kind: "balance",
  leafIdx: -1, // unknown until the commitment lands
  assetId: 0n,
  amount: 500_000n,
  salt: 0xabcdefn,
};

function record(overrides: Partial<WalRecord> = {}): WalRecord {
  return {
    id: LEAF_NEW,
    createdAtMs: 1_000_000,
    flow: "deposit",
    expectedNotes: [
      [LEAF_NEW, PREIMAGE],
      [LEAF_RESIDUAL, { ...PREIMAGE, amount: 100n }],
    ],
    spendsLeaves: [LEAF_SPENT],
    ...overrides,
  };
}

async function openVault(): Promise<NoteVault> {
  const res = await NoteVault.open({ storageKey: KEY, ...SCOPE });
  if (!res.ok) throw new Error(res.reason);
  return res.vault;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("WAL persistence (encrypted, survives reopen)", () => {
  it("putPending → listPending roundtrips across a vault reopen (crash simulation)", async () => {
    const vault = await openVault();
    await vault.putPending(record());
    vault.close(); // "crash": process gone, IndexedDB survives

    const reopened = await openVault();
    const { records, corruptRows } = await reopened.listPending();
    expect(corruptRows).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record());

    // The point of this line is that the bigint survived the WAL's
    // serialize/deserialize roundtrip as a bigint, not as a string. Narrow on
    // the discriminant first: NotePreimage is a union and PositionPreimage has
    // no `amount`, so reading it off the union does not typecheck.
    const restored = records[0].expectedNotes[0][1];
    if (restored.kind !== "balance") {
      throw new Error(`expected a balance note, got kind=${restored.kind}`);
    }
    expect(restored.amount).toBe(500_000n);
  });

  it("updatePending attaches the txHash in place", async () => {
    const vault = await openVault();
    await vault.putPending(record());
    await vault.updatePending(record({ txHash: "0xdeadbeef" }));

    const { records } = await vault.listPending();
    expect(records).toHaveLength(1);
    expect(records[0].txHash).toBe("0xdeadbeef");
  });

  it("deletePending removes the record; wipe clears WAL too", async () => {
    const vault = await openVault();
    await vault.putPending(record());
    await vault.putPending(record({ id: "0xother", createdAtMs: 2_000_000 }));

    await vault.deletePending(LEAF_NEW);
    expect((await vault.listPending()).records.map((r) => r.id)).toEqual(["0xother"]);

    await vault.wipe();
    expect((await vault.listPending()).records).toHaveLength(0);
  });

  it("lists oldest-first regardless of insertion order", async () => {
    const vault = await openVault();
    await vault.putPending(record({ id: "0xlate", createdAtMs: 9_000 }));
    await vault.putPending(record({ id: "0xearly", createdAtMs: 1_000 }));
    const { records } = await vault.listPending();
    expect(records.map((r) => r.id)).toEqual(["0xearly", "0xlate"]);
  });
});

describe("reconcileWalRecord — the five crash points", () => {
  const chainWithBoth = buildCommitmentIndex([
    { commitment: LEAF_NEW, leafIndex: 7 },
    { commitment: LEAF_RESIDUAL, leafIndex: 8 },
  ]);
  const chainEmpty = buildCommitmentIndex([]);

  it("crash BEFORE submit (young record, nothing on chain) → wait", () => {
    const v = reconcileWalRecord({
      record: record(),
      chain: chainEmpty,
      nowMs: 1_000_000 + 60_000,
    });
    expect(v.action).toBe("wait");
  });

  it("crash before submit, record aged past the window → drop", () => {
    const v = reconcileWalRecord({
      record: record(),
      chain: chainEmpty,
      nowMs: 1_000_000 + WAL_DROP_AFTER_MS,
    });
    expect(v.action).toBe("drop");
  });

  it("crash AFTER submit, tx still unconfirmed → wait (txHash present)", () => {
    const v = reconcileWalRecord({
      record: record({ txHash: "0xabc" }),
      chain: chainEmpty,
      nowMs: 1_000_000 + 1,
    });
    expect(v.action).toBe("wait");
  });

  it("crash after confirm, before promote → promote with true leaf indices", () => {
    const v = reconcileWalRecord({
      record: record({ txHash: "0xabc" }),
      chain: chainWithBoth,
      nowMs: 1_000_000 + 1,
    });
    expect(v.action).toBe("promote");
    if (v.action === "promote") {
      expect(v.notes).toEqual([
        [LEAF_NEW, { leafIdx: 7 }],
        [LEAF_RESIDUAL, { leafIdx: 8 }],
      ]);
    }
  });

  it("crash after promote, before WAL delete → promote again (idempotent)", () => {
    // Re-running reconcile on an already-promoted record yields the same
    // promote verdict; NoteStore.register and vault.put are upserts, so
    // replaying it is harmless.
    const first = reconcileWalRecord({
      record: record(),
      chain: chainWithBoth,
      nowMs: 1_000_000,
    });
    const second = reconcileWalRecord({
      record: record(),
      chain: chainWithBoth,
      nowMs: 1_000_000 + 5_000,
    });
    expect(first).toEqual(second);
    expect(first.action).toBe("promote");
  });

  it("partial landing → conflict, listing landed and missing leaves", () => {
    const chainPartial = buildCommitmentIndex([{ commitment: LEAF_NEW, leafIndex: 7 }]);
    const v = reconcileWalRecord({
      record: record(),
      chain: chainPartial,
      nowMs: 1_000_000,
    });
    expect(v.action).toBe("conflict");
    if (v.action === "conflict") {
      expect(v.landed).toEqual([LEAF_NEW]);
      expect(v.missing).toEqual([LEAF_RESIDUAL]);
    }
  });

  it("commitment matching is case-insensitive on hex", () => {
    const chainUpper = buildCommitmentIndex([
      { commitment: LEAF_NEW.toUpperCase().replace("0X", "0x"), leafIndex: 3 },
      { commitment: LEAF_RESIDUAL, leafIndex: 4 },
    ]);
    const v = reconcileWalRecord({ record: record(), chain: chainUpper, nowMs: 0 });
    expect(v.action).toBe("promote");
  });
});

describe("reconcileWal — whole-log pass", () => {
  it("mixes verdicts across records, oldest first", () => {
    const chain = buildCommitmentIndex([
      { commitment: LEAF_NEW, leafIndex: 7 },
      { commitment: LEAF_RESIDUAL, leafIndex: 8 },
    ]);
    const records = [
      record(), // both landed → promote
      record({
        id: "0xstale",
        createdAtMs: 0,
        expectedNotes: [["0xffff", PREIMAGE]],
      }), // nothing landed, ancient → drop
      record({
        id: "0xfresh",
        createdAtMs: 999_999_999,
        expectedNotes: [["0xeeee", PREIMAGE]],
      }), // nothing landed, new → wait
    ];
    const verdicts = reconcileWal({ records, chain, nowMs: 1_000_000_000 });
    expect(verdicts.map((v) => v.action)).toEqual(["promote", "drop", "wait"]);
  });
});
