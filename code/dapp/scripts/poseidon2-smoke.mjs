// Stage D.1 smoke check: prove poseidon2.ts matches the 13 Noir vectors
// the Solidity test suite uses (code/contracts/test/libraries/Poseidon2.t.sol).
// Run with: node scripts/poseidon2-smoke.mjs
import { poseidon2Hash2, bigIntToHex32 } from "../src/lib/poseidon2.ts";

const VECTORS = [
  [0n, 0n, 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1n],
  [0n, 1n, 0x0dd6d785caa3fe1ad139a40b6bd26fccbd6c8697573b0e34489c740533db5cc8n],
  [1n, 0n, 0x1e05013a2f40c60dc58cfe36bfa4d7e94676c43436922368628342bc5144d103n],
  [1n, 1n, 0x1df6080e5bf5cefb3e40daf91cfcc5a267781505471aa058c0b205986774f978n],
  [1n, 2n, 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n],
  [2n, 3n, 0x2bc00d90b885b09d12764e764410f7f693f514f7f3ca14d916741ff3968b3079n],
  [42n, 1729n, 0x1c19c28fa4d066c2fc922baba534304092c52d0566e72670268bfd47afeda7f1n],
  [
    0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn,
    0x0fedcba0987654320fedcba0987654320fedcba0987654320fedcba098765432n,
    0x0b357ed8ae39f700c0f713613a8851c6c170dcfc6bfb1f0300a9520c6ee59a09n,
  ],
  [
    0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000n,
    0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593efffffffn,
    0x2a3af28ae45056e36af2c3a829f1500c199a3f0aa681c199b7366d00676f0ca9n,
  ],
  [
    0x10000000000000000n,
    0x20000000000000000n,
    0x05510aa08876d798a1d0061eac844a5602e8d00c4dfc8f41739e843833327763n,
  ],
  [
    0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2n,
    0n,
    0x080f70df0e78effd4c9de7467c782528094799110267c05be0d30ebadb3ae184n,
  ],
  [
    0n,
    0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2n,
    0x0ec6ebf60b09ba87b23b24bc945c5218f88daa29a8b656476a64969601929ce6n,
  ],
  [
    0x0a7c3b8f9d4e2c1b6a5f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a09fn,
    0x1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f00n,
    0x0ca6ca7b9a6d8c62643ddc73c28238ef52059b012086f0a274421230ac69cc2en,
  ],
];

let fail = 0;
for (let i = 0; i < VECTORS.length; i++) {
  const [l, r, want] = VECTORS[i];
  const got = poseidon2Hash2(l, r);
  if (got !== want) {
    console.error(
      `[${i}] FAIL\n  got  ${bigIntToHex32(got)}\n  want ${bigIntToHex32(want)}`,
    );
    fail++;
  }
}
if (fail === 0) {
  console.log(`poseidon2 smoke: ${VECTORS.length}/${VECTORS.length} PASS`);
  process.exit(0);
}
console.error(`poseidon2 smoke: ${fail} FAIL`);
process.exit(1);
