import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { NoteVault } from "../note-vault.ts";
import type { BalanceNotePreimage, PositionPreimage } from "../note-store.ts";

const KEY_A = new Uint8Array(32).fill(1);
const KEY_B = new Uint8Array(32).fill(2);
const SCOPE = { chainId: 31337, address: "0xAbCd000000000000000000000000000000001234" };

const LEAF_1 = "0x0000000000000000000000000000000000000000000000000000000000000a01";
const LEAF_2 = "0x0000000000000000000000000000000000000000000000000000000000000a02";

const BALANCE: BalanceNotePreimage = {
  kind: "balance",
  leafIdx: 4,
  assetId: 0n,
  amount: 1_000_000n,
  salt: 0x0dead00dn,
};

const POSITION: PositionPreimage = {
  kind: "position",
  leafIdx: 9,
  spendingPubkey: 0x1234567890abcdefn,
  collaterals: [5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  debts: [0n, 3n, 0n, 0n, 0n, 0n, 0n, 0n],
  borrowIndicesAtUpdate: [1_000_000_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  salt: 0xfeedn,
};

async function openVault(key = KEY_A, scope = SCOPE): Promise<NoteVault> {
  const res = await NoteVault.open({ storageKey: key, ...scope });
  if (!res.ok) throw new Error(`vault open failed: ${res.reason}`);
  return res.vault;
}

beforeEach(() => {
  // Fresh IndexedDB universe per test.
  globalThis.indexedDB = new IDBFactory();
});

describe("NoteVault roundtrip", () => {
  it("persists and hydrates preimages exactly (bigints, arrays, discriminants)", async () => {
    const vault = await openVault();
    await vault.put(LEAF_1, BALANCE);
    await vault.put(LEAF_2, POSITION);
    vault.close();

    const reopened = await openVault();
    const { notes, corruptRows } = await reopened.loadAll();
    expect(corruptRows).toBe(0);
    expect(notes).toHaveLength(2);

    const map = new Map(notes);
    expect(map.get(LEAF_1)).toEqual(BALANCE);
    expect(map.get(LEAF_2)).toEqual(POSITION);
    const pos = map.get(LEAF_2) as PositionPreimage;
    expect(typeof pos.salt).toBe("bigint");
    expect(typeof pos.collaterals[0]).toBe("bigint");
  });

  it("delete removes the spent note's row", async () => {
    const vault = await openVault();
    await vault.put(LEAF_1, BALANCE);
    await vault.put(LEAF_2, POSITION);
    await vault.delete(LEAF_1);

    const { notes } = await vault.loadAll();
    expect(notes).toHaveLength(1);
    expect(notes[0][0]).toBe(LEAF_2);
  });

  it("wipe drops everything", async () => {
    const vault = await openVault();
    await vault.put(LEAF_1, BALANCE);
    await vault.wipe();
    const { notes } = await vault.loadAll();
    expect(notes).toHaveLength(0);
  });

  it("rows are ciphertext at rest — no plaintext amounts/salts in the DB", async () => {
    const vault = await openVault();
    await vault.put(LEAF_1, BALANCE);

    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open(NoteVault.dbName(SCOPE), 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("notes", "readonly");
        const get = tx.objectStore("notes").get(LEAF_1.toLowerCase());
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
      open.onerror = () => reject(open.error);
    });

    const row = raw as { nonce: Uint8Array; ciphertext: Uint8Array };
    expect(row.ciphertext).toBeInstanceOf(Uint8Array);
    const asText = Buffer.from(row.ciphertext).toString("utf8");
    expect(asText).not.toContain("amount");
    expect(asText).not.toContain("salt");
    expect(asText).not.toContain("balance");
  });
});

describe("NoteVault key + scope isolation", () => {
  it("wrong storageKey surfaces corruptRows, never bad preimages", async () => {
    const vault = await openVault(KEY_A);
    await vault.put(LEAF_1, BALANCE);
    vault.close();

    const wrongKey = await openVault(KEY_B);
    const { notes, corruptRows } = await wrongKey.loadAll();
    expect(notes).toHaveLength(0);
    expect(corruptRows).toBe(1);
  });

  it("different wallet/chain scopes never share rows", async () => {
    const vaultA = await openVault();
    await vaultA.put(LEAF_1, BALANCE);

    const otherWallet = await openVault(KEY_A, {
      chainId: 31337,
      address: "0x9999999999999999999999999999999999999999",
    });
    const otherChain = await openVault(KEY_A, { ...SCOPE, chainId: 845320009 });

    expect((await otherWallet.loadAll()).notes).toHaveLength(0);
    expect((await otherChain.loadAll()).notes).toHaveLength(0);
  });

  it("a row copied onto another leaf key fails authentication (AAD)", async () => {
    const vault = await openVault();
    await vault.put(LEAF_1, BALANCE);

    // Simulate tampering: copy LEAF_1's encrypted row onto LEAF_2's key.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(NoteVault.dbName(SCOPE), 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("notes", "readwrite");
        const store = tx.objectStore("notes");
        const get = store.get(LEAF_1.toLowerCase());
        get.onsuccess = () => {
          store.put(get.result, LEAF_2.toLowerCase());
          tx.oncomplete = () => resolve();
        };
        get.onerror = () => reject(get.error);
      };
      open.onerror = () => reject(open.error);
    });

    const { notes, corruptRows } = await vault.loadAll();
    expect(notes).toHaveLength(1); // only the genuine row survives
    expect(notes[0][0]).toBe(LEAF_1.toLowerCase());
    expect(corruptRows).toBe(1);
  });
});

describe("NoteVault unavailable environments (D10=3A)", () => {
  it("returns {ok:false, indexeddb-missing} instead of throwing", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error — simulate Safari private mode / SSR
    delete globalThis.indexedDB;
    try {
      const res = await NoteVault.open({ storageKey: KEY_A, ...SCOPE });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("indexeddb-missing");
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it("returns {ok:false} on a bad storage key instead of throwing", async () => {
    const res = await NoteVault.open({
      storageKey: new Uint8Array(7), // invalid AES key length
      ...SCOPE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("open-failed");
  });
});
