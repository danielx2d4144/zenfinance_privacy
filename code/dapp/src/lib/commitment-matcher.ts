import type { WalRecord } from "./note-vault.ts";

/**
 * M2.4 — the ONE commitment-matching module (eng review C1).
 *
 * Both consumers ask the same question — "which of these expected
 * commitments actually landed on chain?" — so both go through here:
 *
 *   - WAL reconciliation (unlock/crash recovery): did the in-flight tx's
 *     commitments land? Promote its preimages, or drop the record.
 *   - Recovery scan (M2.5): join trial-decrypted memos to IMT leaves.
 *
 * Pure functions over already-synced data. NOTHING here talks to an
 * RPC — callers hand in the full locally-synced commitment set, which
 * is what keeps recovery private (no per-note queries).
 */

/** Locally-synced view of the chain's commitment log. */
export interface CommitmentIndex {
  /** leaf hex (lowercase 0x…64) → IMT leaf index. */
  byLeaf: Map<string, number>;
}

export function buildCommitmentIndex(
  entries: Iterable<{ commitment: string; leafIndex: number }>,
): CommitmentIndex {
  const byLeaf = new Map<string, number>();
  for (const e of entries) byLeaf.set(normalize(e.commitment), e.leafIndex);
  return { byLeaf };
}

export type WalVerdict =
  | {
      /** Every expected commitment is on chain → tx confirmed. Promote
       *  preimages (with their true leaf indices), evict spent leaves,
       *  delete the record. */
      action: "promote";
      record: WalRecord;
      /** expectedNotes with leafIdx patched to the on-chain index. */
      notes: Array<[string, { leafIdx: number }]>;
    }
  | {
      /** Nothing landed and the record is older than the grace window →
       *  the tx never made it (crash before submit, or dropped/reverted).
       *  Delete the record; nothing was spent on chain. */
      action: "drop";
      record: WalRecord;
    }
  | {
      /** Nothing landed but the record is recent — the tx may still be
       *  in flight. Keep waiting; re-reconcile on next sync. */
      action: "wait";
      record: WalRecord;
    }
  | {
      /** SOME expected commitments landed but not all. With atomic txs
       *  this means the local expectation is out of sync with the chain
       *  (e.g. relayer changed a residual). Surface loudly; recovery
       *  scan is the fixup path. */
      action: "conflict";
      record: WalRecord;
      landed: string[];
      missing: string[];
    };

/** Age after which a fully-unlanded record is dropped instead of waited on. */
export const WAL_DROP_AFTER_MS = 30 * 60 * 1000;

export function reconcileWalRecord(args: {
  record: WalRecord;
  chain: CommitmentIndex;
  nowMs: number;
  dropAfterMs?: number;
}): WalVerdict {
  const { record, chain } = args;
  const dropAfter = args.dropAfterMs ?? WAL_DROP_AFTER_MS;

  const landed: string[] = [];
  const missing: string[] = [];
  for (const [leaf] of record.expectedNotes) {
    (chain.byLeaf.has(normalize(leaf)) ? landed : missing).push(normalize(leaf));
  }

  if (missing.length === 0) {
    return {
      action: "promote",
      record,
      notes: record.expectedNotes.map(([leaf]) => {
        const n = normalize(leaf);
        return [n, { leafIdx: chain.byLeaf.get(n)! }];
      }),
    };
  }
  if (landed.length === 0) {
    const age = args.nowMs - record.createdAtMs;
    return age >= dropAfter ? { action: "drop", record } : { action: "wait", record };
  }
  return { action: "conflict", record, landed, missing };
}

/** Reconcile a whole WAL, oldest first. */
export function reconcileWal(args: {
  records: WalRecord[];
  chain: CommitmentIndex;
  nowMs: number;
  dropAfterMs?: number;
}): WalVerdict[] {
  return args.records.map((record) => reconcileWalRecord({ ...args, record }));
}

function normalize(leaf: string): string {
  const s = leaf.toLowerCase();
  return s.startsWith("0x") ? s : `0x${s}`;
}
