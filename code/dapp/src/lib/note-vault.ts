import type { NotePreimage } from "./note-store.ts";

/**
 * M2.3b — encrypted at-rest note persistence (ADR-002).
 *
 * The in-memory NoteStore stays the hot cache with its sync API; this
 * vault is the write-through IndexedDB layer beneath it. On unlock the
 * vault hydrates the NoteStore; every register/forget mirrors here.
 * **On-chain recovery remains the source of truth** — losing this DB
 * costs a rescan, never funds.
 *
 * At-rest format: each preimage is serialized (bigint-safe JSON) and
 * AES-GCM-encrypted under the session storageKey, with the leaf hex as
 * AAD — a row copied onto another leaf key fails authentication. The
 * database name is scoped to {chainId, address} so wallets and chains
 * never share rows, and a chain fork/redeploy can't feed stale notes
 * into witnesses.
 *
 * Storage-unavailable policy (plan D10=3A): `NoteVault.open` never
 * throws for environmental failures — it returns `{ok:false, reason}`
 * so the UI shows a persistent warning banner and gates new deposits
 * behind an explicit confirm. Never silent.
 */

export type VaultOpenResult =
  | { ok: true; vault: NoteVault }
  | { ok: false; reason: VaultUnavailableReason; error?: unknown };

export type VaultUnavailableReason =
  | "indexeddb-missing" // Safari private mode, some webviews, SSR
  | "open-failed" // quota, corrupt DB, permission denied
  | "blocked"; // another tab holds a version lock

const DB_VERSION = 1;
const STORE = "notes";
const WAL_STORE = "wal";

export class NoteVault {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly key: CryptoKey,
  ) {}

  static dbName(scope: { chainId: number; address: string }): string {
    return `zenfinance-notes:v1:${scope.chainId}:${scope.address.toLowerCase()}`;
  }

  static async open(args: {
    storageKey: Uint8Array;
    chainId: number;
    address: string;
  }): Promise<VaultOpenResult> {
    if (typeof indexedDB === "undefined") {
      return { ok: false, reason: "indexeddb-missing" };
    }
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey(
        "raw",
        args.storageKey as BufferSource,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
      );
    } catch (error) {
      return { ok: false, reason: "open-failed", error };
    }

    return new Promise<VaultOpenResult>((resolve) => {
      const req = indexedDB.open(NoteVault.dbName(args), DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
        if (!req.result.objectStoreNames.contains(WAL_STORE)) {
          req.result.createObjectStore(WAL_STORE);
        }
      };
      req.onsuccess = () => resolve({ ok: true, vault: new NoteVault(req.result, key) });
      req.onerror = () => resolve({ ok: false, reason: "open-failed", error: req.error });
      req.onblocked = () => resolve({ ok: false, reason: "blocked" });
    });
  }

  /** Encrypt and persist one preimage keyed by its leaf hex. */
  async put(leafHex: string, preimage: NotePreimage): Promise<void> {
    const leaf = leafHex.toLowerCase();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(serialize(preimage));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: new TextEncoder().encode(leaf) as BufferSource,
        },
        this.key,
        plaintext as BufferSource,
      ),
    );
    await this.tx("readwrite", (store) => store.put({ nonce, ciphertext }, leaf));
  }

  /** Remove a spent note's row. */
  async delete(leafHex: string): Promise<void> {
    await this.tx("readwrite", (store) => store.delete(leafHex.toLowerCase()));
  }

  /**
   * Decrypt every stored preimage (unlock-time hydration). Rows that
   * fail authentication (wrong storageKey — e.g. the signature-derived
   * key changed) are counted, not thrown: the caller decides whether to
   * warn + fall back to on-chain recovery.
   */
  async loadAll(): Promise<{
    notes: Array<[string, NotePreimage]>;
    corruptRows: number;
  }> {
    const rows = await this.tx<Array<[IDBValidKey, VaultRow]>>("readonly", (store) => {
      return collectAll(store);
    });
    const notes: Array<[string, NotePreimage]> = [];
    let corruptRows = 0;
    for (const [rawKey, row] of rows) {
      const leaf = String(rawKey);
      try {
        const plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: row.nonce as BufferSource,
              additionalData: new TextEncoder().encode(leaf) as BufferSource,
            },
            this.key,
            row.ciphertext as BufferSource,
          ),
        );
        notes.push([leaf, deserialize(new TextDecoder().decode(plaintext))]);
      } catch {
        corruptRows += 1;
      }
    }
    return { notes, corruptRows };
  }

  /** Drop every row (wallet disconnect-and-forget, or test cleanup). */
  async wipe(): Promise<void> {
    await this.tx("readwrite", (store) => store.clear());
    await this.tx("readwrite", (store) => store.clear(), WAL_STORE);
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------------ WAL
  //
  // Write-ahead records for in-flight transactions (M2.4). A record is
  // written BEFORE the tx is submitted, carrying every note the tx will
  // create and every leaf it will spend. Reconciliation (crash recovery /
  // next unlock) promotes or drops records by checking the chain — see
  // commitment-matcher.ts. Records are encrypted exactly like note rows,
  // with the WAL id as AAD.

  /** Persist a pending record BEFORE submitting its transaction. */
  async putPending(record: WalRecord): Promise<void> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(serializeWal(record));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: new TextEncoder().encode(record.id) as BufferSource,
        },
        this.key,
        plaintext as BufferSource,
      ),
    );
    await this.tx("readwrite", (store) => store.put({ nonce, ciphertext }, record.id), WAL_STORE);
  }

  /** Update a pending record in place (e.g. attach txHash after submit). */
  async updatePending(record: WalRecord): Promise<void> {
    await this.putPending(record);
  }

  /** Remove a record after its notes are safely promoted (or dropped). */
  async deletePending(id: string): Promise<void> {
    await this.tx("readwrite", (store) => store.delete(id), WAL_STORE);
  }

  /** All pending records, oldest first. Corrupt rows are dropped+counted. */
  async listPending(): Promise<{ records: WalRecord[]; corruptRows: number }> {
    const rows = await this.tx<Array<[IDBValidKey, VaultRow]>>(
      "readonly",
      (store) => collectAll(store),
      WAL_STORE,
    );
    const records: WalRecord[] = [];
    let corruptRows = 0;
    for (const [rawKey, row] of rows) {
      const id = String(rawKey);
      try {
        const plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: row.nonce as BufferSource,
              additionalData: new TextEncoder().encode(id) as BufferSource,
            },
            this.key,
            row.ciphertext as BufferSource,
          ),
        );
        records.push(deserializeWal(new TextDecoder().decode(plaintext)));
      } catch {
        corruptRows += 1;
      }
    }
    records.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return { records, corruptRows };
  }

  // -------------------------------------------------------------- internal

  private tx<T = unknown>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest | Promise<T>,
    storeName: string = STORE,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      tx.onerror = () => reject(tx.error);
      const result = run(tx.objectStore(storeName));
      if (result instanceof Promise) {
        result.then(resolve, reject);
      } else {
        result.onsuccess = () => resolve(result.result as T);
        result.onerror = () => reject(result.error);
      }
    });
  }
}

/**
 * One in-flight transaction's write-ahead record. `expectedNotes` are
 * the (leaf, preimage) pairs the tx will create; `spendsLeaves` are the
 * store leaves it consumes (evicted only AFTER confirmation).
 */
export interface WalRecord {
  /** Unique id — the primary new leaf hex (commitments are unique). */
  id: string;
  createdAtMs: number;
  /** Flow that created it: "deposit" | "supply" | "borrow" | ... */
  flow: string;
  /** Set once the wallet returns a tx hash; absent if we crashed first. */
  txHash?: string;
  expectedNotes: Array<[string, NotePreimage]>;
  spendsLeaves: string[];
}

function serializeWal(record: WalRecord): string {
  return JSON.stringify(record, (_k, v) =>
    typeof v === "bigint" ? `#b:${v.toString(16)}` : v,
  );
}

function deserializeWal(json: string): WalRecord {
  return JSON.parse(json, (_k, v) =>
    typeof v === "string" && v.startsWith("#b:") ? BigInt(`0x${v.slice(3)}`) : v,
  ) as WalRecord;
}

interface VaultRow {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

function collectAll(
  store: IDBObjectStore,
): Promise<Array<[IDBValidKey, VaultRow]>> {
  return new Promise((resolve, reject) => {
    const out: Array<[IDBValidKey, VaultRow]> = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        out.push([cursor.key, cursor.value as VaultRow]);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// -------------------------------------------------- bigint-safe (de)serialize

/** JSON with bigints tagged as strings ("#b:<hex>") so preimages with
 *  mixed bigint/number/array fields round-trip exactly. */
function serialize(preimage: NotePreimage): string {
  return JSON.stringify(preimage, (_k, v) =>
    typeof v === "bigint" ? `#b:${v.toString(16)}` : v,
  );
}

function deserialize(json: string): NotePreimage {
  return JSON.parse(json, (_k, v) =>
    typeof v === "string" && v.startsWith("#b:") ? BigInt(`0x${v.slice(3)}`) : v,
  ) as NotePreimage;
}
