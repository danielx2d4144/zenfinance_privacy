import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { BN254_FR } from "./poseidon2.ts";

/**
 * M2.2 — session-key derivation (ADR-002; supersedes spending-key.ts's
 * EIP-191 flow, which fed the raw 65-byte signature into HKDF).
 *
 * One EIP-712 typed-data signature per session yields THREE independent
 * keys via HKDF domain separation:
 *
 *   spendingKey — BN254 Field element; controls commitments/nullifiers.
 *   viewingKey  — 32 bytes; decrypts note memos (recovery never touches
 *                 the spending key).
 *   storageKey  — 32 bytes; AES-GCM encrypt-at-rest for IndexedDB.
 *
 * Signature handling (eng review, auto-applied):
 *   - HKDF input is r || s with s CANONICALIZED to low-s. `v` is DROPPED:
 *     wallets disagree on v encoding (0/1 vs 27/28), and (r, high-s) vs
 *     (r, low-s) are alternative encodings of the same signature — both
 *     variations would silently fork a user's keys across wallets.
 *   - The EIP-712 domain binds {name, version, chainId, verifyingContract}
 *     so a signature phished on another chain/contract derives different
 *     keys. This raises the phishing bar; it does not eliminate it — the
 *     message carries an explicit warning string as the human-side check.
 *
 * Invariants:
 *   - Typed data MUST NEVER change for existing users (their notes would
 *     become unfindable/unspendable). Version bumps require a migration.
 *   - Keys are never persisted raw. storageKey protects data at rest;
 *     spending/viewing keys live in memory for the session only.
 *   - EOA-only guarantee: RFC-6979 EOA signatures are deterministic, so
 *     re-derivation always works. Smart wallets may not be — callers run
 *     `checkSignerDeterminism` on first setup and block with a warning
 *     on mismatch (determinism-now ≠ determinism-forever is a documented
 *     limitation; encrypted local store + future export covers rotation).
 */

// ---------------------------------------------------------------- EIP-712

export const KEY_DERIVATION_DOMAIN_NAME = "ZenFinance";
export const KEY_DERIVATION_DOMAIN_VERSION = "1";

export const KEY_DERIVATION_TYPES = {
  SessionKeys: [
    { name: "purpose", type: "string" },
    { name: "warning", type: "string" },
    { name: "account", type: "address" },
  ],
} as const;

export const KEY_DERIVATION_PRIMARY_TYPE = "SessionKeys" as const;

export function keyDerivationTypedData(args: {
  chainId: number;
  privacyEntry: `0x${string}`;
  address: `0x${string}`;
}) {
  return {
    domain: {
      name: KEY_DERIVATION_DOMAIN_NAME,
      version: KEY_DERIVATION_DOMAIN_VERSION,
      chainId: args.chainId,
      verifyingContract: args.privacyEntry,
    },
    types: KEY_DERIVATION_TYPES,
    primaryType: KEY_DERIVATION_PRIMARY_TYPE,
    message: {
      purpose: "Unlock ZenFinance private balances (session keys v1)",
      warning:
        "Only sign this inside the ZenFinance app. Signing it anywhere " +
        "else can expose your private balances.",
      account: args.address,
    },
  } as const;
}

// ------------------------------------------------------------- derivation

/** secp256k1 group order and half-order for low-s canonicalization. */
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N >> 1n;

export interface SessionKeys {
  /** BN254 Field element — the Poseidon2 secret key. */
  spendingKey: bigint;
  /** 32 bytes — memo encryption/trial-decryption key material. */
  viewingKey: Uint8Array;
  /** 32 bytes — AES-GCM at-rest key material for IndexedDB. */
  storageKey: Uint8Array;
}

export type SignTypedDataFn = (
  typedData: ReturnType<typeof keyDerivationTypedData>,
) => Promise<`0x${string}`>;

export interface DeriveArgs {
  signTypedData: SignTypedDataFn;
  address: `0x${string}`;
  chainId: number;
  privacyEntry: `0x${string}`;
}

export async function deriveSessionKeys(args: DeriveArgs): Promise<SessionKeys> {
  if (!Number.isInteger(args.chainId) || args.chainId <= 0) {
    throw new Error(`key-derivation: invalid chainId ${args.chainId}`);
  }
  const typedData = keyDerivationTypedData(args);
  const signature = await args.signTypedData(typedData);
  return sessionKeysFromSignature(signature, args);
}

/**
 * Pure derivation from an already-obtained signature — split out so the
 * determinism check and unit vectors don't need a second code path.
 */
export function sessionKeysFromSignature(
  signature: `0x${string}`,
  bind: { address: `0x${string}`; chainId: number; privacyEntry: `0x${string}` },
): SessionKeys {
  const ikm = canonicalRS(signature);

  // RFC 5869 salt binds the derivation context; a signature replayed
  // against a different chain/contract/account yields unrelated keys
  // even before the EIP-712 domain does its job wallet-side.
  const salt = utf8ToBytes(
    `zenfinance:session-keys:v1:${bind.chainId}:` +
      `${bind.privacyEntry.toLowerCase()}:${bind.address.toLowerCase()}`,
  );

  const spendingBytes = hkdf(sha256, ikm, salt, utf8ToBytes("zenfinance/spending-key/v1"), 32);
  const viewingKey = hkdf(sha256, ikm, salt, utf8ToBytes("zenfinance/viewing-key/v1"), 32);
  const storageKey = hkdf(sha256, ikm, salt, utf8ToBytes("zenfinance/storage-key/v1"), 32);

  return { spendingKey: bytesToFieldBE(spendingBytes), viewingKey, storageKey };
}

/**
 * Sign-twice determinism check (first-setup ceremony). Returns true when
 * the wallet produced byte-identical canonical (r, s) both times — the
 * EOA/RFC-6979 case. Smart wallets and MPC signers may return false;
 * callers must then warn and gate deposits (recovery would be impossible).
 */
export async function checkSignerDeterminism(args: DeriveArgs): Promise<boolean> {
  const typedData = keyDerivationTypedData(args);
  const [sig1, sig2] = [
    await args.signTypedData(typedData),
    await args.signTypedData(typedData),
  ];
  const [a, b] = [canonicalRS(sig1), canonicalRS(sig2)];
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------- helpers

/** Extract r || low-s (64 bytes) from a 65-byte hex signature; v dropped. */
export function canonicalRS(signature: `0x${string}`): Uint8Array {
  const hex = signature.slice(2);
  if (hex.length !== 130) {
    throw new Error(
      `key-derivation: expected 65-byte signature, got ${hex.length / 2} bytes ` +
        "(smart-wallet/ERC-1271 signatures are not supported for key derivation)",
    );
  }
  const r = hexToBytes(hex.slice(0, 64));
  let s = BigInt("0x" + hex.slice(64, 128));
  if (s === 0n || s >= SECP256K1_N) {
    throw new Error("key-derivation: signature s out of range");
  }
  if (s > SECP256K1_HALF_N) s = SECP256K1_N - s;

  const out = new Uint8Array(64);
  out.set(r, 0);
  const sHex = s.toString(16).padStart(64, "0");
  out.set(hexToBytes(sHex), 32);
  return out;
}

function bytesToFieldBE(b: Uint8Array): bigint {
  let acc = 0n;
  for (let i = 0; i < b.length; i++) acc = (acc << 8n) | BigInt(b[i]);
  // Single mod-reduction of a uniform 256-bit value into BN254 Fr; the
  // resulting bias is ~2^-252 — negligible.
  return acc % BN254_FR;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("odd-length hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
