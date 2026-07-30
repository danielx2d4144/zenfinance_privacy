import { describe, expect, it } from "vitest";

import {
  encryptMemo,
  tryDecryptMemo,
  MEMO_VERSION,
  NoteType,
  type NoteSecrets,
} from "../memo-crypto.ts";

const OWN_KEY = new Uint8Array(32).fill(7);
const FOREIGN_KEY = new Uint8Array(32).fill(9);
const COMMITMENT =
  "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809" as const;
const OTHER_COMMITMENT =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

const SECRETS: NoteSecrets = {
  noteType: NoteType.Balance,
  assetId: 0n,
  amount: 1_000_000_000n, // 1000 USDC (1e6 decimals)
  salt: 0x0deadbeef00ddf00d123456789abcdef0deadbeef00ddf00d123456789abcdn,
};

describe("memo roundtrip", () => {
  it("own memo decrypts to the exact secrets", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    const out = await tryDecryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      memo,
    });
    expect(out).not.toBeNull();
    expect(out!.noteType).toBe(NoteType.Balance);
    expect(out!.assetId).toBe(SECRETS.assetId);
    expect(out!.amount).toBe(SECRETS.amount);
    expect(out!.salt).toBe(SECRETS.salt);
  });

  it("memo fits PrivacyEntry.MAX_MEMO_BYTES with wide margin", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    expect(memo.length).toBeLessThan(256);
    expect(memo[0]).toBe(MEMO_VERSION);
  });

  it("nonces are fresh: same secrets encrypt to different memos", async () => {
    const a = await encryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, secrets: SECRETS });
    const b = await encryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, secrets: SECRETS });
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });

  it("max-range values roundtrip (u128 amount, near-2^256 field limbs)", async () => {
    const extreme: NoteSecrets = {
      noteType: NoteType.Position,
      assetId: (1n << 256n) - 1n,
      amount: (1n << 128n) - 1n,
      salt: (1n << 256n) - 1n,
    };
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: extreme,
    });
    const out = await tryDecryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, memo });
    expect(out).toEqual(extreme);
  });

  it("rejects out-of-range amounts at encrypt time", async () => {
    await expect(
      encryptMemo({
        viewingKey: OWN_KEY,
        commitment: COMMITMENT,
        secrets: { ...SECRETS, amount: 1n << 128n },
      }),
    ).rejects.toThrow(/out of range/);
  });
});

describe("trial-decryption (the recovery loop)", () => {
  it("foreign memo returns null, never throws", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    await expect(
      tryDecryptMemo({ viewingKey: FOREIGN_KEY, commitment: COMMITMENT, memo }),
    ).resolves.toBeNull();
  });

  it("memo bound to a different commitment (AAD) returns null", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    await expect(
      tryDecryptMemo({ viewingKey: OWN_KEY, commitment: OTHER_COMMITMENT, memo }),
    ).resolves.toBeNull();
  });

  it("bit-flipped ciphertext returns null", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    memo[memo.length - 1] ^= 0x01;
    await expect(
      tryDecryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, memo }),
    ).resolves.toBeNull();
  });

  it("unknown version byte returns null (future v2 memos skip cleanly)", async () => {
    const memo = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: COMMITMENT,
      secrets: SECRETS,
    });
    memo[0] = 0x02;
    await expect(
      tryDecryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, memo }),
    ).resolves.toBeNull();
  });

  it("truncated/garbage blobs return null", async () => {
    for (const junk of [new Uint8Array(0), new Uint8Array(5), new Uint8Array(40).fill(3)]) {
      await expect(
        tryDecryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, memo: junk }),
      ).resolves.toBeNull();
    }
  });

  it("scans a mixed batch and finds exactly the own notes", async () => {
    const mine1 = await encryptMemo({ viewingKey: OWN_KEY, commitment: COMMITMENT, secrets: SECRETS });
    const theirs = await encryptMemo({
      viewingKey: FOREIGN_KEY,
      commitment: OTHER_COMMITMENT,
      secrets: { ...SECRETS, amount: 5n },
    });
    const mine2 = await encryptMemo({
      viewingKey: OWN_KEY,
      commitment: OTHER_COMMITMENT,
      secrets: { ...SECRETS, noteType: NoteType.Supply, amount: 42n },
    });

    const batch = [
      { commitment: COMMITMENT, memo: mine1 },
      { commitment: OTHER_COMMITMENT, memo: theirs },
      { commitment: OTHER_COMMITMENT, memo: mine2 },
    ];
    const found: bigint[] = [];
    for (const item of batch) {
      const secrets = await tryDecryptMemo({ viewingKey: OWN_KEY, ...item });
      if (secrets) found.push(secrets.amount);
    }
    expect(found).toEqual([SECRETS.amount, 42n]);
  });
});
