import { describe, expect, it } from "vitest";

import {
  RecoveryScanner,
  recoverNotes,
  type ScanEvent,
  type ChainView,
} from "../recovery-scan.ts";
import { encryptMemo, NoteType } from "../memo-crypto.ts";
import { balanceCommitment, balanceNullifier, spendingPubkeyOf } from "../witness.ts";
import { bigIntToHex32 } from "../poseidon2.ts";

/** Build the event triple a real `deposit(token, amount, commitment, memo)`
 *  tx emits: MerkleRootUpdated → Deposited → EncryptedMemo. */
function depositEvents(args: {
  blockNumber: bigint;
  logIndexBase: number;
  leafIndex: number;
  commitment: string;
  memo?: Uint8Array;
}): ScanEvent[] {
  const events: ScanEvent[] = [
    {
      blockNumber: args.blockNumber,
      logIndex: args.logIndexBase,
      name: "MerkleRootUpdated",
      args: { newRoot: "0x1", nextLeafIndex: args.leafIndex + 1 },
    },
    {
      blockNumber: args.blockNumber,
      logIndex: args.logIndexBase + 1,
      name: "Deposited",
      args: { token: "0xT", from: "0xF", amount: 1n, commitment: args.commitment },
    },
  ];
  if (args.memo) {
    events.push({
      blockNumber: args.blockNumber,
      logIndex: args.logIndexBase + 2,
      name: "EncryptedMemo",
      args: {
        commitment: args.commitment,
        memo: `0x${Buffer.from(args.memo).toString("hex")}`,
      },
    });
  }
  return events;
}

function fetchFromFixture(all: ScanEvent[]) {
  const calls: Array<[bigint, bigint]> = [];
  const fetchLogs = async (from: bigint, to: bigint) => {
    calls.push([from, to]);
    return all.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  };
  return { fetchLogs, calls };
}

describe("RecoveryScanner chunking + resume", () => {
  it("scans in inclusive chunk windows from the scan floor", async () => {
    const { fetchLogs, calls } = fetchFromFixture([]);
    const scanner = new RecoveryScanner({ fetchLogs, scanFloor: 100n, chunkSize: 2000n });
    await scanner.syncTo(4600n);

    expect(calls).toEqual([
      [100n, 2099n],
      [2100n, 4099n],
      [4100n, 4600n],
    ]);
  });

  it("RPC failure mid-scan throws (no partial view) and resumes from the cursor", async () => {
    const events = depositEvents({
      blockNumber: 4500n,
      logIndexBase: 0,
      leafIndex: 0,
      commitment: "0xaaa1",
    });
    const calls: Array<[bigint, bigint]> = [];
    let failOnce = true;
    const fetchLogs = async (from: bigint, to: bigint) => {
      if (from >= 4100n && failOnce) {
        failOnce = false;
        throw new Error("RPC dropped");
      }
      calls.push([from, to]);
      return events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
    };

    const scanner = new RecoveryScanner({ fetchLogs, scanFloor: 100n, chunkSize: 2000n });
    await expect(scanner.syncTo(4600n)).rejects.toThrow("RPC dropped");
    expect(scanner.cursor).toBe(4100n); // chunks 1-2 done, 3 not

    const view = await scanner.syncTo(4600n); // resume — no refetch of 1-2
    expect(calls).toEqual([
      [100n, 2099n],
      [2100n, 4099n],
      [4100n, 4600n],
    ]);
    expect(view.depositLeaves).toEqual([{ commitment: "0xaaa1", leafIndex: 0 }]);
  });

  it("reports progress per chunk", async () => {
    const { fetchLogs } = fetchFromFixture([]);
    const scanner = new RecoveryScanner({ fetchLogs, scanFloor: 0n, chunkSize: 1000n });
    const progress: bigint[] = [];
    await scanner.syncTo(2500n, (scannedTo) => progress.push(scannedTo));
    expect(progress).toEqual([999n, 1999n, 2500n]);
  });

  it("joins deposits to leaf indices and collects nullifiers across flows", async () => {
    const all: ScanEvent[] = [
      ...depositEvents({ blockNumber: 10n, logIndexBase: 0, leafIndex: 0, commitment: "0xc0" }),
      ...depositEvents({ blockNumber: 20n, logIndexBase: 0, leafIndex: 1, commitment: "0xc1" }),
      // spendBalance: residual insert (MRU only) + BalanceSpent + BalanceCredited
      {
        blockNumber: 30n,
        logIndex: 0,
        name: "MerkleRootUpdated",
        args: { newRoot: "0x2", nextLeafIndex: 3 },
      },
      { blockNumber: 30n, logIndex: 1, name: "BalanceSpent", args: { nullifier: "0xN1" } },
      { blockNumber: 30n, logIndex: 2, name: "BalanceCredited", args: { commitment: "0xPOOL" } },
      // withdraw
      { blockNumber: 40n, logIndex: 0, name: "Withdrawn", args: { nullifier: "0xN2" } },
    ];
    const { fetchLogs } = fetchFromFixture(all);
    const scanner = new RecoveryScanner({ fetchLogs, scanFloor: 0n });
    const view = await scanner.syncTo(50n);

    expect(view.depositLeaves).toEqual([
      { commitment: "0xc0", leafIndex: 0 },
      { commitment: "0xc1", leafIndex: 1 },
    ]);
    expect(view.leafCount).toBe(3);
    expect(view.nullifiers).toEqual(new Set(["0xn1", "0xn2"]));
    // BalanceCredited never polluted the deposit join:
    expect(view.depositLeaves.find((d) => d.commitment === "0xpool")).toBeUndefined();
  });
});

describe("recoverNotes — wipe→recover from chain data alone", () => {
  const MY_SPENDING_KEY = 0x1234n;
  const MY_VIEWING_KEY = new Uint8Array(32).fill(5);
  const THEIR_SPENDING_KEY = 0x9876n;
  const THEIR_VIEWING_KEY = new Uint8Array(32).fill(6);

  async function buildFixture() {
    const myPub = spendingPubkeyOf(MY_SPENDING_KEY);
    const theirPub = spendingPubkeyOf(THEIR_SPENDING_KEY);

    const mkNote = (amount: bigint, salt: bigint, pub: bigint) => ({
      secrets: { noteType: NoteType.Balance, assetId: 0n, amount, salt },
      commitment: bigIntToHex32(
        balanceCommitment({ assetId: 0n, amount, spendingPubkey: pub, salt }),
      ),
    });

    const mine1 = mkNote(1_000_000n, 0xa1n, myPub); // unspent
    const mine2 = mkNote(2_000_000n, 0xa2n, myPub); // spent below
    const theirs = mkNote(3_000_000n, 0xb1n, theirPub);

    const events: ScanEvent[] = [
      ...depositEvents({
        blockNumber: 1n,
        logIndexBase: 0,
        leafIndex: 0,
        commitment: mine1.commitment,
        memo: await encryptMemo({
          viewingKey: MY_VIEWING_KEY,
          commitment: mine1.commitment as `0x${string}`,
          secrets: mine1.secrets,
        }),
      }),
      ...depositEvents({
        blockNumber: 2n,
        logIndexBase: 0,
        leafIndex: 1,
        commitment: theirs.commitment,
        memo: await encryptMemo({
          viewingKey: THEIR_VIEWING_KEY,
          commitment: theirs.commitment as `0x${string}`,
          secrets: theirs.secrets,
        }),
      }),
      ...depositEvents({
        blockNumber: 3n,
        logIndexBase: 0,
        leafIndex: 2,
        commitment: mine2.commitment,
        memo: await encryptMemo({
          viewingKey: MY_VIEWING_KEY,
          commitment: mine2.commitment as `0x${string}`,
          secrets: mine2.secrets,
        }),
      }),
      // mine2 was spent:
      {
        blockNumber: 4n,
        logIndex: 0,
        name: "BalanceSpent",
        args: { nullifier: bigIntToHex32(balanceNullifier(MY_SPENDING_KEY, 0xa2n)) },
      },
    ];
    return { events, mine1, mine2 };
  }

  it("recovers exactly the wallet's notes with true leaf indices and spent flags", async () => {
    const { events, mine1, mine2 } = await buildFixture();
    const { fetchLogs } = fetchFromFixture(events);
    const scanner = new RecoveryScanner({ fetchLogs, scanFloor: 0n });
    const view = await scanner.syncTo(10n);

    const { notes, mismatched } = await recoverNotes({
      view,
      viewingKey: MY_VIEWING_KEY,
      spendingKey: MY_SPENDING_KEY,
    });

    expect(mismatched).toBe(0);
    expect(notes).toHaveLength(2);

    const byLeaf = new Map(notes.map((n) => [n.leafHex, n]));
    const n1 = byLeaf.get(mine1.commitment)!;
    expect(n1.preimage).toMatchObject({ kind: "balance", leafIdx: 0, amount: 1_000_000n, salt: 0xa1n });
    expect(n1.spent).toBe(false);

    const n2 = byLeaf.get(mine2.commitment)!;
    expect(n2.preimage.leafIdx).toBe(2);
    expect(n2.spent).toBe(true);
  });

  it("counts commitment-mismatched memos instead of importing them", async () => {
    // A memo that decrypts under our key but whose secrets don't hash to
    // the commitment it rides on (buggy/malicious client).
    const bogusCommitment =
      "0x00000000000000000000000000000000000000000000000000000000000000ff";
    const memo = await encryptMemo({
      viewingKey: MY_VIEWING_KEY,
      commitment: bogusCommitment,
      secrets: { noteType: NoteType.Balance, assetId: 0n, amount: 5n, salt: 0x77n },
    });
    const view: ChainView = {
      depositLeaves: [{ commitment: bogusCommitment, leafIndex: 0 }],
      memos: [{ commitment: bogusCommitment, memo }],
      nullifiers: new Set(),
      leafCount: 1,
    };
    const { notes, mismatched } = await recoverNotes({
      view,
      viewingKey: MY_VIEWING_KEY,
      spendingKey: MY_SPENDING_KEY,
    });
    expect(notes).toHaveLength(0);
    expect(mismatched).toBe(1);
  });

  it("skips memos whose deposit never landed in the index", async () => {
    const myPub = spendingPubkeyOf(MY_SPENDING_KEY);
    const commitment = bigIntToHex32(
      balanceCommitment({ assetId: 0n, amount: 9n, spendingPubkey: myPub, salt: 0x99n }),
    );
    const memo = await encryptMemo({
      viewingKey: MY_VIEWING_KEY,
      commitment: commitment as `0x${string}`,
      secrets: { noteType: NoteType.Balance, assetId: 0n, amount: 9n, salt: 0x99n },
    });
    const view: ChainView = {
      depositLeaves: [], // no Deposited join
      memos: [{ commitment, memo }],
      nullifiers: new Set(),
      leafCount: 0,
    };
    const { notes } = await recoverNotes({
      view,
      viewingKey: MY_VIEWING_KEY,
      spendingKey: MY_SPENDING_KEY,
    });
    expect(notes).toHaveLength(0);
  });
});
