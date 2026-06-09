// Stage D.2 smoke check: prove imt.ts matches the Solidity PoseidonIMT
// vectors (the same ones PoseidonIMT.t.sol pins).
//   - Empty tree at depth 20 -> NOIR_EMPTY_ROOT_DEPTH_20
//   - Single leaf at index 0 -> NOIR_ONE_LEAF_ROOT_DEPTH_20
//   - 33 inserts -> root_1 drops from known()
//
// Run with: node scripts/imt-smoke.mjs
//
// Imports use .ts extensions so Node's --experimental-strip-types
// loader can resolve them; the production build (Next/webpack under
// moduleResolution: "bundler") uses the extensionless form in src/.
import { LocalIMT, TREE_DEPTH, ROOT_HISTORY_SIZE } from "../src/lib/imt.ts";
import { bigIntToHex32 } from "../src/lib/poseidon2.ts";

const NOIR_EMPTY_ROOT_DEPTH_20 =
  0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755n;
const NOIR_ONE_LEAF_ROOT_DEPTH_20 =
  0x13300185e7b6e3bfa8ee2fb1c5c0a0efa7bda96e7185b2a75a98ef1511268dbcn;
const LEAF =
  0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2n;

let fail = 0;

// Test 1: empty-tree root
{
  const imt = new LocalIMT();
  if (imt.currentRoot() !== NOIR_EMPTY_ROOT_DEPTH_20) {
    console.error(
      `empty-root FAIL\n  got  ${bigIntToHex32(imt.currentRoot())}\n  want ${bigIntToHex32(NOIR_EMPTY_ROOT_DEPTH_20)}`,
    );
    fail++;
  }
}

// Test 2: one-leaf-at-zero root
{
  const imt = new LocalIMT();
  const r = imt.insert(LEAF);
  if (r.idx !== 0) {
    console.error(`one-leaf idx FAIL: ${r.idx}`);
    fail++;
  }
  if (r.newRoot !== NOIR_ONE_LEAF_ROOT_DEPTH_20) {
    console.error(
      `one-leaf root FAIL\n  got  ${bigIntToHex32(r.newRoot)}\n  want ${bigIntToHex32(NOIR_ONE_LEAF_ROOT_DEPTH_20)}`,
    );
    fail++;
  }
  if (!imt.known(r.newRoot)) {
    console.error("one-leaf: newRoot not in known()");
    fail++;
  }
}

// Test 3: siblings of one-leaf insert match zeros[]
{
  const imt = new LocalIMT();
  const r = imt.insert(LEAF);
  for (let d = 0; d < TREE_DEPTH; d++) {
    if (r.siblings[d] !== imt.zerosAt(d)) {
      console.error(`one-leaf siblings[${d}] != zeros[${d}]`);
      fail++;
    }
    if (r.indexBits[d] !== false) {
      console.error(`one-leaf indexBits[${d}] should be false`);
      fail++;
    }
  }
}

// Test 4: 33-insert history rollover; root_1 drops, root_2 + root_33 remain
{
  const PRIME =
    0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
  const imt = new LocalIMT();
  let root1 = 0n;
  let root2 = 0n;
  let root33 = 0n;
  for (let i = 0; i < 33; i++) {
    const leaf = (BigInt(i + 1) * 0xdeadbeefn + 0x42n) % PRIME;
    const r = imt.insert(leaf);
    if (i === 0) root1 = r.newRoot;
    if (i === 1) root2 = r.newRoot;
    if (i === 32) root33 = r.newRoot;
  }
  if (imt.known(root1)) {
    console.error("33-leaf rollover: root1 should NOT be known");
    fail++;
  }
  if (!imt.known(root2)) {
    console.error("33-leaf rollover: root2 should be known");
    fail++;
  }
  if (!imt.known(root33)) {
    console.error("33-leaf rollover: root33 should be known");
    fail++;
  }
  if (imt.currentRoot() !== root33) {
    console.error("33-leaf rollover: currentRoot must equal root33");
    fail++;
  }
  if (imt.nextLeafIndex() !== 33) {
    console.error("33-leaf rollover: nextLeafIndex drift");
    fail++;
  }
}

if (fail === 0) {
  console.log(
    `imt smoke: all checks PASS (depth=${TREE_DEPTH}, history=${ROOT_HISTORY_SIZE})`,
  );
  process.exit(0);
}
console.error(`imt smoke: ${fail} FAIL`);
process.exit(1);
