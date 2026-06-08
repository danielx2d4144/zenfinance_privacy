import { keccak256, encodePacked, toHex, type Hex } from "viem";

import { bytesToHex } from "./spending-key";

/**
 * Witness scaffolding for Day-14b intents.
 *
 * Real circuit-bound witnesses require Pedersen on BN254 to match what
 * `lib_common::balance_commitment / supply_commitment / position_*` do.
 * That ships in Day 14c alongside the contract-side Pedersen swap.
 *
 * For Day 14b: every nullifier + commitment value is keccak-derived
 * from `(spendingKey, kind, slot, intentId)`. Same recipe on the dapp
 * and on the verifier side (since the verifier is bypassed by the
 * mock proxy on Anvil), so writes succeed end-to-end. Privacy is
 * preserved at the API boundary (the data-api sees only opaque
 * bytes32 values, never the spending key or amounts).
 *
 * Once Day 14c lands, every `derive*` function in this file gets
 * replaced with a real Pedersen call. The call sites (the four pages
 * + LendingForm) shouldn't need to change.
 */

const TAGS = {
  balanceNullifier: 21,
  supplyNullifier: 22,
  positionNullifier: 23,
  balanceCommitment: 1,
  supplyCommitment: 2,
  positionCommitment: 3,
} as const;

type Tag = keyof typeof TAGS;

function derive(spendingKey: Uint8Array, tag: Tag, slot: string): Hex {
  const skHex = `0x${bytesToHex(spendingKey)}` as Hex;
  return keccak256(
    encodePacked(
      ["bytes32", "uint8", "string"],
      [skHex, TAGS[tag], slot],
    ),
  );
}

export function balanceNullifier(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "balanceNullifier", slot);
}

export function supplyNullifier(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "supplyNullifier", slot);
}

export function positionNullifier(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "positionNullifier", slot);
}

export function balanceCommitment(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "balanceCommitment", slot);
}

export function supplyCommitment(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "supplyCommitment", slot);
}

export function positionCommitment(spendingKey: Uint8Array, slot: string): Hex {
  return derive(spendingKey, "positionCommitment", slot);
}

export function zeroBytes32(): Hex {
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

/**
 * Pick a per-intent slot label so concurrent submissions don't collide.
 * Uses a wall-clock + 4-byte random suffix.
 */
export function slotFor(kind: string): string {
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  return `${kind}:${Date.now()}:${toHex(rnd).slice(2)}`;
}
