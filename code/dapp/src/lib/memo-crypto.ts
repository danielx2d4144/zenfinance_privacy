/**
 * M2.3 — encrypted note memos (ADR-002).
 *
 * A deposit memo carries the note's secrets, encrypted so that ONLY the
 * depositor's viewingKey can open it. Recovery fetches every
 * `EncryptedMemo` event and trial-decrypts: your notes authenticate,
 * everyone else's fail the AES-GCM tag check. That failed tag IS the
 * rejection path — no oracle, no per-note RPC.
 *
 * Deposits are self-notes (the encryptor and the decryptor are the same
 * wallet), so symmetric AES-GCM under viewingKey is sufficient — ADR-002's
 * "ECIES-style" is only needed once third parties can send notes
 * (transfers), which the protocol does not have. The 1-byte version
 * prefix lets an asymmetric v2 coexist with v1 memos later.
 *
 * Wire format (fits comfortably in PrivacyEntry.MAX_MEMO_BYTES = 1024):
 *
 *   memo      = version(1) || nonce(12) || AES-GCM ciphertext+tag
 *   plaintext = noteType(1) || assetId(32 BE) || amount(16 BE) || salt(32 BE)
 *   AAD       = version(1) || commitment(32)
 *
 * Binding the commitment as AAD means a memo cannot be re-attached to a
 * different leaf: decrypt fails unless the (memo, commitment) pair is the
 * one the depositor created.
 */

export const MEMO_VERSION = 0x01;

const NONCE_BYTES = 12;
const PLAINTEXT_BYTES = 1 + 32 + 16 + 32;

export enum NoteType {
  Balance = 0x01,
  Supply = 0x02,
  Position = 0x03,
}

export interface NoteSecrets {
  noteType: NoteType;
  /** BN254 Field element. */
  assetId: bigint;
  /** u128 token amount. */
  amount: bigint;
  /** BN254 Field element — the per-note CSPRNG salt (never derived). */
  salt: bigint;
}

/** Encrypt note secrets to a viewing key, bound to the note's commitment. */
export async function encryptMemo(args: {
  viewingKey: Uint8Array;
  commitment: `0x${string}`;
  secrets: NoteSecrets;
}): Promise<Uint8Array> {
  const key = await importGcmKey(args.viewingKey, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  const plaintext = new Uint8Array(PLAINTEXT_BYTES);
  plaintext[0] = args.secrets.noteType;
  writeBigIntBE(plaintext, args.secrets.assetId, 1, 32);
  writeBigIntBE(plaintext, args.secrets.amount, 33, 16);
  writeBigIntBE(plaintext, args.secrets.salt, 49, 32);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: memoAad(args.commitment) as BufferSource,
      },
      key,
      plaintext as BufferSource,
    ),
  );

  const memo = new Uint8Array(1 + NONCE_BYTES + ciphertext.length);
  memo[0] = MEMO_VERSION;
  memo.set(nonce, 1);
  memo.set(ciphertext, 1 + NONCE_BYTES);
  return memo;
}

/**
 * Trial-decrypt a memo. Returns the note secrets when `viewingKey` owns
 * this memo, or `null` for foreign/corrupt memos and unknown versions.
 * Never throws on foreign data — recovery calls this in a tight loop
 * over every memo on chain.
 */
export async function tryDecryptMemo(args: {
  viewingKey: Uint8Array;
  commitment: `0x${string}`;
  memo: Uint8Array;
}): Promise<NoteSecrets | null> {
  const { memo } = args;
  if (memo.length < 1 + NONCE_BYTES + PLAINTEXT_BYTES + 16) return null;
  if (memo[0] !== MEMO_VERSION) return null;

  try {
    const key = await importGcmKey(args.viewingKey, ["decrypt"]);
    const nonce = memo.subarray(1, 1 + NONCE_BYTES);
    const ciphertext = memo.subarray(1 + NONCE_BYTES);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: memoAad(args.commitment) as BufferSource,
        },
        key,
        ciphertext as BufferSource,
      ),
    );
    if (plaintext.length !== PLAINTEXT_BYTES) return null;

    const noteType = plaintext[0];
    if (!(noteType in NoteType)) return null;
    return {
      noteType,
      assetId: readBigIntBE(plaintext, 1, 32),
      amount: readBigIntBE(plaintext, 33, 16),
      salt: readBigIntBE(plaintext, 49, 32),
    };
  } catch {
    // GCM tag failure — not our memo (or corrupted). Both are "null".
    return null;
  }
}

// ---------------------------------------------------------------- helpers

function memoAad(commitment: `0x${string}`): Uint8Array {
  const aad = new Uint8Array(33);
  aad[0] = MEMO_VERSION;
  const hex = commitment.slice(2).padStart(64, "0");
  for (let i = 0; i < 32; i++) {
    aad[1 + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return aad;
}

async function importGcmKey(
  raw: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("memo-crypto: viewingKey must be 32 bytes");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usages);
}

function writeBigIntBE(out: Uint8Array, value: bigint, offset: number, width: number) {
  if (value < 0n || value >= 1n << BigInt(width * 8)) {
    throw new Error(`memo-crypto: value out of range for ${width}-byte field`);
  }
  let v = value;
  for (let i = width - 1; i >= 0; i--) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function readBigIntBE(buf: Uint8Array, offset: number, width: number): bigint {
  let acc = 0n;
  for (let i = 0; i < width; i++) acc = (acc << 8n) | BigInt(buf[offset + i]);
  return acc;
}
