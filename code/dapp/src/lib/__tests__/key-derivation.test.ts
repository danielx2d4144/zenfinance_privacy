import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  canonicalRS,
  checkSignerDeterminism,
  deriveSessionKeys,
  keyDerivationTypedData,
  sessionKeysFromSignature,
  type DeriveArgs,
} from "../key-derivation.ts";
import { BN254_FR } from "../poseidon2.ts";

/**
 * M2.2 derivation vectors. viem local accounts sign with RFC 6979
 * (deterministic ECDSA), so these are true fixed vectors: same key +
 * same typed data → byte-identical signature on every run.
 */

const PRIV_A =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // anvil #1
const PRIV_B =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const; // anvil #2

const ENTRY = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as const;
const OTHER_ENTRY = "0x0000000000000000000000000000000000000001" as const;

const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function argsFor(
  priv: `0x${string}`,
  overrides: Partial<Omit<DeriveArgs, "signTypedData">> = {},
): DeriveArgs {
  const account = privateKeyToAccount(priv);
  return {
    address: account.address,
    chainId: 31337,
    privacyEntry: ENTRY,
    signTypedData: (typedData) => account.signTypedData(typedData),
    ...overrides,
  };
}

describe("deriveSessionKeys", () => {
  it("is deterministic: same wallet + same binding → identical keys", async () => {
    const a1 = await deriveSessionKeys(argsFor(PRIV_A));
    const a2 = await deriveSessionKeys(argsFor(PRIV_A));
    expect(a1.spendingKey).toBe(a2.spendingKey);
    expect(a1.viewingKey).toEqual(a2.viewingKey);
    expect(a1.storageKey).toEqual(a2.storageKey);
  });

  it("spendingKey is a valid BN254 field element", async () => {
    const keys = await deriveSessionKeys(argsFor(PRIV_A));
    expect(keys.spendingKey).toBeGreaterThan(0n);
    expect(keys.spendingKey).toBeLessThan(BN254_FR);
  });

  it("the three keys are pairwise independent (domain separation)", async () => {
    const keys = await deriveSessionKeys(argsFor(PRIV_A));
    const spendHex = keys.spendingKey.toString(16);
    expect(Buffer.from(keys.viewingKey).toString("hex")).not.toBe(
      Buffer.from(keys.storageKey).toString("hex"),
    );
    expect(Buffer.from(keys.viewingKey).toString("hex")).not.toContain(spendHex.slice(0, 16));
  });

  it("different wallets derive different keys", async () => {
    const a = await deriveSessionKeys(argsFor(PRIV_A));
    const b = await deriveSessionKeys(argsFor(PRIV_B));
    expect(a.spendingKey).not.toBe(b.spendingKey);
    expect(a.viewingKey).not.toEqual(b.viewingKey);
  });

  it("different chainId → different keys (wrong-chain derivation rejected by construction)", async () => {
    const local = await deriveSessionKeys(argsFor(PRIV_A, { chainId: 31337 }));
    const horizen = await deriveSessionKeys(argsFor(PRIV_A, { chainId: 845320009 }));
    expect(local.spendingKey).not.toBe(horizen.spendingKey);
    expect(local.viewingKey).not.toEqual(horizen.viewingKey);
  });

  it("different verifyingContract → different keys", async () => {
    const a = await deriveSessionKeys(argsFor(PRIV_A));
    const b = await deriveSessionKeys(argsFor(PRIV_A, { privacyEntry: OTHER_ENTRY }));
    expect(a.spendingKey).not.toBe(b.spendingKey);
  });

  it("rejects invalid chainId", async () => {
    await expect(deriveSessionKeys(argsFor(PRIV_A, { chainId: 0 }))).rejects.toThrow(
      /invalid chainId/,
    );
    await expect(deriveSessionKeys(argsFor(PRIV_A, { chainId: 1.5 }))).rejects.toThrow(
      /invalid chainId/,
    );
  });
});

describe("canonicalRS — wallet signature-encoding tolerance", () => {
  async function realSignature(): Promise<`0x${string}`> {
    const account = privateKeyToAccount(PRIV_A);
    return account.signTypedData(
      keyDerivationTypedData({
        chainId: 31337,
        privacyEntry: ENTRY,
        address: account.address,
      }),
    );
  }

  it("v-encoding variants (27/28 vs 0/1) produce identical key material", async () => {
    const sig = await realSignature();
    const body = sig.slice(2, 130);
    const v27 = `0x${body}1b` as const; // v = 27
    const v28 = `0x${body}1c` as const; // v = 28
    const v00 = `0x${body}00` as const; // v = 0
    const v01 = `0x${body}01` as const; // v = 1
    const expected = Buffer.from(canonicalRS(v27)).toString("hex");
    for (const variant of [v28, v00, v01]) {
      expect(Buffer.from(canonicalRS(variant)).toString("hex")).toBe(expected);
    }
  });

  it("high-s and low-s encodings of the same signature map to the same keys", async () => {
    const sig = await realSignature();
    const rHex = sig.slice(2, 66);
    const sLow = BigInt("0x" + sig.slice(66, 130));
    const sHigh = SECP256K1_N - sLow; // the alternative valid encoding
    const highSig =
      `0x${rHex}${sHigh.toString(16).padStart(64, "0")}1b` as `0x${string}`;

    const bind = {
      address: privateKeyToAccount(PRIV_A).address,
      chainId: 31337,
      privacyEntry: ENTRY,
    };
    const fromLow = sessionKeysFromSignature(sig, bind);
    const fromHigh = sessionKeysFromSignature(highSig, bind);
    expect(fromHigh.spendingKey).toBe(fromLow.spendingKey);
    expect(fromHigh.viewingKey).toEqual(fromLow.viewingKey);
    expect(fromHigh.storageKey).toEqual(fromLow.storageKey);
  });

  it("rejects non-65-byte signatures (ERC-1271 smart-wallet blobs)", () => {
    expect(() => canonicalRS("0x1234")).toThrow(/65-byte/);
    const blob = `0x${"ab".repeat(96)}` as `0x${string}`;
    expect(() => canonicalRS(blob)).toThrow(/65-byte/);
  });

  it("rejects s = 0 and s >= N", () => {
    const r = "11".repeat(32);
    const zeroS = `0x${r}${"00".repeat(32)}1b` as `0x${string}`;
    const bigS = `0x${r}${SECP256K1_N.toString(16)}1b` as `0x${string}`;
    expect(() => canonicalRS(zeroS)).toThrow(/out of range/);
    expect(() => canonicalRS(bigS)).toThrow(/out of range/);
  });
});

describe("checkSignerDeterminism", () => {
  it("passes for an EOA (RFC-6979 deterministic)", async () => {
    await expect(checkSignerDeterminism(argsFor(PRIV_A))).resolves.toBe(true);
  });

  it("fails for a non-deterministic signer", async () => {
    const account = privateKeyToAccount(PRIV_A);
    let call = 0;
    const flaky: DeriveArgs = {
      address: account.address,
      chainId: 31337,
      privacyEntry: ENTRY,
      // Simulates an MPC/smart-wallet signer: different (r, s) each call.
      signTypedData: async (typedData) => {
        call += 1;
        if (call === 1) return account.signTypedData(typedData);
        const other = privateKeyToAccount(PRIV_B);
        return other.signTypedData(typedData);
      },
    };
    await expect(checkSignerDeterminism(flaky)).resolves.toBe(false);
  });
});
