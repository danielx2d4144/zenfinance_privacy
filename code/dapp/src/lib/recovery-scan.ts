import { bigIntToHex32 } from "./poseidon2.ts";
import { balanceCommitment, balanceNullifier, spendingPubkeyOf } from "./witness.ts";
import { tryDecryptMemo } from "./memo-crypto.ts";
import type { BalanceNotePreimage } from "./note-store.ts";

/**
 * M2.5 — private full-set recovery scan (ADR-002).
 *
 * Rebuilds a wallet's notes from chain data + the viewing key alone:
 *
 *   1. Sync EVERY PrivacyEntry event from the deployment block to head
 *      (chunked eth_getLogs, resumable cursor). Full-set sync is the
 *      privacy property: we never ask an RPC about specific notes or
 *      nullifiers, so the provider learns nothing beyond "a scan ran"
 *      (the Zcash light-client-leak lesson).
 *   2. Trial-decrypt every EncryptedMemo with the viewing key (foreign
 *      memos fail the GCM tag). Successes are our notes.
 *   3. Verify each recovered note by recomputing its commitment from the
 *      decrypted secrets (defense in depth on top of GCM authenticity),
 *      take its leaf index from the event join, and mark it spent when
 *      its nullifier appears in the locally-synced nullifier set.
 *
 * Leaf-index pairing: `deposit` emits MerkleRootUpdated (from the
 * insert) then Deposited then EncryptedMemo in one tx, so a Deposited
 * event's leaf index is `nextLeafIndex - 1` of the last-seen
 * MerkleRootUpdated. Residual inserts from `spendBalance` never event
 * their commitment (protocol observability gap, see TODOS.md), so the
 * index maps DEPOSIT leaves only — which is precisely the set memos
 * exist for.
 */

// ------------------------------------------------------------------ events

export type ScanEventName =
  | "Deposited"
  | "EncryptedMemo"
  | "Withdrawn"
  | "BalanceSpent"
  | "BalanceCredited"
  | "MerkleRootUpdated";

/** Decoded PrivacyEntry log, ordered by (blockNumber, logIndex). */
export interface ScanEvent {
  blockNumber: bigint;
  logIndex: number;
  name: ScanEventName;
  args: Record<string, unknown>;
}

/** Injectable log source: viem adapter in the app, synthetic in tests. */
export type FetchLogsFn = (fromBlock: bigint, toBlock: bigint) => Promise<ScanEvent[]>;

// --------------------------------------------------------------- chain view

export interface ChainView {
  /** Deposit commitments joined to their IMT leaf indices. */
  depositLeaves: Array<{ commitment: string; leafIndex: number }>;
  /** Every EncryptedMemo payload, join-keyed by commitment. */
  memos: Array<{ commitment: string; memo: Uint8Array }>;
  /** Every spent nullifier (BalanceSpent + Withdrawn), hex32 lowercase. */
  nullifiers: Set<string>;
  /** Total commitments inserted (from the last MerkleRootUpdated). */
  leafCount: number;
}

export const DEFAULT_CHUNK_SIZE = 2000n;

/**
 * Chunked, resumable scanner. `syncTo` throws on RPC failure with the
 * cursor preserved — calling it again resumes from the failed chunk, and
 * a partial view is NEVER returned (callers can read `cursor` to render
 * progress, but data only comes back from a completed sync).
 */
export class RecoveryScanner {
  private nextBlock: bigint;
  private lastInsertIndex = -1;
  private view: ChainView = {
    depositLeaves: [],
    memos: [],
    nullifiers: new Set(),
    leafCount: 0,
  };

  constructor(
    private readonly args: {
      fetchLogs: FetchLogsFn;
      /** Deployment block from chain-config — the scan floor. */
      scanFloor: bigint;
      chunkSize?: bigint;
    },
  ) {
    this.nextBlock = args.scanFloor;
  }

  /** First block the next chunk will fetch (resume cursor / progress). */
  get cursor(): bigint {
    return this.nextBlock;
  }

  async syncTo(
    headBlock: bigint,
    onProgress?: (scannedTo: bigint, head: bigint) => void,
  ): Promise<ChainView> {
    const chunk = this.args.chunkSize ?? DEFAULT_CHUNK_SIZE;
    while (this.nextBlock <= headBlock) {
      const to = min(this.nextBlock + chunk - 1n, headBlock);
      // Throws propagate with this.nextBlock untouched → resumable.
      const events = await this.args.fetchLogs(this.nextBlock, to);
      this.ingest(events);
      this.nextBlock = to + 1n;
      onProgress?.(to, headBlock);
    }
    return this.view;
  }

  private ingest(events: ScanEvent[]): void {
    const ordered = [...events].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );
    for (const ev of ordered) {
      switch (ev.name) {
        case "MerkleRootUpdated": {
          const next = Number(ev.args.nextLeafIndex);
          this.lastInsertIndex = next - 1;
          this.view.leafCount = Math.max(this.view.leafCount, next);
          break;
        }
        case "Deposited": {
          const commitment = normalize(String(ev.args.commitment));
          if (this.lastInsertIndex >= 0) {
            this.view.depositLeaves.push({ commitment, leafIndex: this.lastInsertIndex });
          }
          break;
        }
        case "EncryptedMemo": {
          this.view.memos.push({
            commitment: normalize(String(ev.args.commitment)),
            memo: hexToBytes(String(ev.args.memo)),
          });
          break;
        }
        case "Withdrawn":
        case "BalanceSpent": {
          this.view.nullifiers.add(normalize(String(ev.args.nullifier)));
          break;
        }
        case "BalanceCredited":
          // Commitment lives in a pool tree (spendBalance) or was already
          // counted by its MerkleRootUpdated (creditBalance) — nothing to
          // join here for deposit-memo recovery.
          break;
      }
    }
  }
}

// ---------------------------------------------------------------- recovery

export interface RecoveredNote {
  leafHex: string;
  preimage: BalanceNotePreimage;
  spent: boolean;
}

/**
 * Trial-decrypt every memo in a completed ChainView and return the
 * wallet's notes. Runs entirely locally: no RPC, no per-note queries.
 *
 * A memo that decrypts but whose secrets do NOT recompute to its
 * commitment is counted in `mismatched` (a buggy or malicious client
 * produced it) and excluded — never silently imported.
 */
export async function recoverNotes(args: {
  view: ChainView;
  viewingKey: Uint8Array;
  spendingKey: bigint;
}): Promise<{ notes: RecoveredNote[]; mismatched: number }> {
  const pubkey = spendingPubkeyOf(args.spendingKey);
  const indexByCommitment = new Map(
    args.view.depositLeaves.map((d) => [d.commitment, d.leafIndex]),
  );

  const notes: RecoveredNote[] = [];
  let mismatched = 0;

  for (const { commitment, memo } of args.view.memos) {
    const secrets = await tryDecryptMemo({
      viewingKey: args.viewingKey,
      commitment: commitment as `0x${string}`,
      memo,
    });
    if (!secrets) continue; // foreign or corrupt — not ours

    const recomputed = bigIntToHex32(
      balanceCommitment({
        assetId: secrets.assetId,
        amount: secrets.amount,
        spendingPubkey: pubkey,
        salt: secrets.salt,
      }),
    );
    if (normalize(recomputed) !== commitment) {
      mismatched += 1;
      continue;
    }

    const leafIndex = indexByCommitment.get(commitment);
    if (leafIndex === undefined) continue; // memo without a landed deposit

    const nullifier = normalize(
      bigIntToHex32(balanceNullifier(args.spendingKey, secrets.salt)),
    );
    notes.push({
      leafHex: commitment,
      preimage: {
        kind: "balance",
        leafIdx: leafIndex,
        assetId: secrets.assetId,
        amount: secrets.amount,
        salt: secrets.salt,
      },
      spent: args.view.nullifiers.has(nullifier),
    });
  }
  return { notes, mismatched };
}

// ----------------------------------------------------------------- helpers

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function normalize(hex: string): string {
  const s = hex.toLowerCase();
  return s.startsWith("0x") ? s : `0x${s}`;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
