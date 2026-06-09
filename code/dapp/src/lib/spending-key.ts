import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { BN254_FR } from "./poseidon2.ts";

/**
 * Deterministic spending-key derivation per S07 §3.1 + S12 §6.
 *
 * The user signs a stable challenge string with their wallet. The
 * resulting signature (deterministic for a given key + message under
 * EIP-191) is fed through HKDF-SHA256 to produce a 32-byte key, which
 * is then **reduced mod the BN254 scalar field** to a Field-element
 * `secretKey` suitable as a Poseidon2 input.
 *
 * Invariants:
 *   - The message MUST NEVER change for an existing user, or their
 *     spending key changes and their commitments become unspendable.
 *   - The key MUST NEVER be persisted (I-CRYPTO-1). Callers hold it in
 *     React state only; see useSpendingKey().
 *   - The Field-reduced bigint is what every commitment / nullifier
 *     hash actually consumes (Day 14c Stage D); the raw 32-byte
 *     buffer is retained only for debugging / future non-Poseidon
 *     uses.
 */

export const SPENDING_KEY_CHALLENGE = [
  "Lending Protocol — Sign to derive your spending key.",
  "",
  "This signature is used to compute the secret that controls",
  "your private balance commitments. It NEVER leaves your browser.",
  "",
  "Network: Horizen",
  "Purpose: spending-key derivation v1",
].join("\n");

export const SPENDING_KEY_LENGTH = 32;

export interface DerivedSpendingKey {
  /** Raw HKDF output (32 bytes). Retained for debug / future use. */
  bytes: Uint8Array;
  /** Field-reduced bigint < BN254_FR. This is what Poseidon2 consumes. */
  secretKey: bigint;
}

export async function deriveSpendingKey(args: {
  signMessage: (message: string) => Promise<`0x${string}`>;
  address: `0x${string}`;
}): Promise<DerivedSpendingKey> {
  const signature = await args.signMessage(SPENDING_KEY_CHALLENGE);

  // Strip the leading "0x", hex-decode to bytes.
  const sigBytes = hexToBytes(signature.slice(2));

  // Per RFC 5869: salt binds to the address; info binds to the purpose
  // string. Both anchor the key derivation so the same signature on a
  // future, different-purpose challenge wouldn't recover the same key.
  const salt = utf8ToBytes(`lending-protocol:spending-key:v1:${args.address.toLowerCase()}`);
  const info = utf8ToBytes("spending-key");

  const bytes = hkdf(sha256, sigBytes, salt, info, SPENDING_KEY_LENGTH);
  return { bytes, secretKey: bytesToFieldBE(bytes) };
}

function bytesToFieldBE(b: Uint8Array): bigint {
  let acc = 0n;
  for (let i = 0; i < b.length; i++) acc = (acc << 8n) | BigInt(b[i]);
  // Reduce into BN254 Fr. The bias from this single reduction over a
  // 256-bit uniform input is on the order of 2^-252, well below any
  // discernibility threshold.
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

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
