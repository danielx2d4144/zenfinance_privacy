import { randomBytes } from "node:crypto";

/**
 * A random commitment that Poseidon2 will actually accept.
 *
 * `PrivacyEntry.deposit` hashes the commitment with Poseidon2, which reverts
 * with `Poseidon2: input >= PRIME` for anything at or above the BN254 scalar
 * field modulus r:
 *
 *   r = 0x30644E72E131A029B85045B68181585D2833E84879B9709143E1F593F0000001
 *
 * A uniform 32-byte value clears that bar only about 19% of the time
 * (r / 2^256), so tests seeded with a bare `randomBytes(32)` failed roughly
 * four runs in five. Clearing the top three bits caps the value at
 * 0x1fff…ff, comfortably below r, and leaves 253 bits of entropy — far more
 * than enough to keep commitments distinct across a test run.
 */
export function randomFieldElement(): `0x${string}` {
  const buf = randomBytes(32);
  // writeUInt8/readUInt8 rather than `buf[0] &= …`: indexed access is
  // `number | undefined` under noUncheckedIndexedAccess.
  buf.writeUInt8(buf.readUInt8(0) & 0x1f, 0);
  return `0x${buf.toString("hex")}`;
}
