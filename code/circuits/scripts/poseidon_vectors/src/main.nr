// Generates Poseidon2 test vectors for the Solidity Poseidon2 library
// (Day 14c Stage A).
//
// Each #[test] prints one (l, r, expected) tuple via `println` so the
// values can be pasted into `code/contracts/test/libraries/Poseidon2.t.sol`.
//
// Run with:
//   nargo test --show-output --package poseidon_vectors
//
// Hashing is `Poseidon2::hash([l, r], 2)` -- the same call lib_common
// uses for every level of `merkle_root` (lib_common/src/lib.nr:139). The
// Solidity library must reproduce this byte-for-byte.
//
// Vectors emitted at Stage-A landing (recorded for posterity; the
// Solidity test pins these same values):
//   00 (0,0)        -> 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1
//   01 (0,1)        -> 0x0dd6d785caa3fe1ad139a40b6bd26fccbd6c8697573b0e34489c740533db5cc8
//   02 (1,0)        -> 0x1e05013a2f40c60dc58cfe36bfa4d7e94676c43436922368628342bc5144d103
//   03 (1,1)        -> 0x1df6080e5bf5cefb3e40daf91cfcc5a267781505471aa058c0b205986774f978
//   04 (1,2)        -> 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383
//   05 (2,3)        -> 0x2bc00d90b885b09d12764e764410f7f693f514f7f3ca14d916741ff3968b3079
//   06 (42,1729)    -> 0x1c19c28fa4d066c2fc922baba534304092c52d0566e72670268bfd47afeda7f1
//   07 (big,big)    -> 0x0b357ed8ae39f700c0f713613a8851c6c170dcfc6bfb1f0300a9520c6ee59a09
//   08 (p-1,p-2)    -> 0x2a3af28ae45056e36af2c3a829f1500c199a3f0aa681c199b7366d00676f0ca9
//   09 (iv- region) -> 0x05510aa08876d798a1d0061eac844a5602e8d00c4dfc8f41739e843833327763
//   10 (leaf,0)     -> 0x080f70df0e78effd4c9de7467c782528094799110267c05be0d30ebadb3ae184
//   11 (0,leaf)     -> 0x0ec6ebf60b09ba87b23b24bc945c5218f88daa29a8b656476a64969601929ce6
//   12 (commit,commit) -> 0x0ca6ca7b9a6d8c62643ddc73c28238ef52059b012086f0a274421230ac69cc2e

use poseidon::poseidon2::Poseidon2;

fn h2(l: Field, r: Field) -> Field {
    Poseidon2::hash([l, r], 2)
}

// Emulates the Tornado-style empty-subtree convention the Solidity IMT
// uses: zeros[0] = 0 (the Field zero-leaf), zeros[d] = h2(zeros[d-1],
// zeros[d-1]). The lib_common::merkle_root function pairs the current
// node with whatever sibling is given -- a leaf at index 0 in an
// otherwise-empty tree has siblings = [zeros[0], zeros[1], ...,
// zeros[D-1]] from leaf level upward.
fn empty_subtree_root<let D: u32>() -> Field {
    let mut z: Field = 0;
    for _ in 0..D {
        z = h2(z, z);
    }
    z
}

// Insert a single leaf at index 0 into an otherwise-empty depth-D tree
// and return the root. This mirrors what PoseidonIMT.insert does
// when nextLeafIndex == 0.
fn root_after_one_leaf_at_zero<let D: u32>(leaf: Field) -> Field {
    let mut cur: Field = leaf;
    let mut z: Field = 0;
    for _ in 0..D {
        cur = h2(cur, z);
        z = h2(z, z);
    }
    cur
}

fn main() {}

#[test]
fn vec_00_zero_zero() {
    let l: Field = 0;
    let r: Field = 0;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_01_zero_one() {
    let l: Field = 0;
    let r: Field = 1;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_02_one_zero() {
    let l: Field = 1;
    let r: Field = 0;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_03_one_one() {
    let l: Field = 1;
    let r: Field = 1;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_04_one_two() {
    let l: Field = 1;
    let r: Field = 2;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_05_two_three() {
    let l: Field = 2;
    let r: Field = 3;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_06_small_pair() {
    let l: Field = 42;
    let r: Field = 1729;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_07_keccak_style_pair() {
    // Two 256-bit-ish values reduced mod Fr -- the shape the Solidity IMT
    // will pass in (leaves are bytes32 reinterpreted as field elements).
    let l: Field = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    let r: Field = 0x0fedcba0987654320fedcba0987654320fedcba0987654320fedcba098765432;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_08_max_minus_one_pair() {
    // BN254 Fr p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
    // l = p - 1, r = p - 2
    let l: Field = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000;
    let r: Field = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593efffffff;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_09_iv_neighborhood() {
    // The sponge IV is 2 << 64 = 0x20000000000000000. Stress the
    // permutation around this value to catch any IV-related slip.
    let l: Field = 0x10000000000000000;
    let r: Field = 0x20000000000000000;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_10_merkle_left_branch() {
    // Mimics one level of merkle_root with a typical commitment-sized
    // leaf paired with a zero sibling (left-branch case).
    let l: Field = 0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2;
    let r: Field = 0;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_11_merkle_right_branch() {
    // Right-branch case: zero current node, non-zero sibling.
    let l: Field = 0;
    let r: Field = 0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

#[test]
fn vec_12_two_commitments() {
    // Two leaf-shaped values, simulating an internal node above two
    // populated leaves.
    let l: Field = 0x0a7c3b8f9d4e2c1b6a5f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a09f;
    let r: Field = 0x1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f00;
    let out: Field = h2(l, r);
    println(f"VEC l={l} r={r} expected={out}");
}

// ---- Stage B vectors: empty-subtree roots ------------------------------

#[test]
fn imt_empty_depth_4() {
    let out: Field = empty_subtree_root::<4>();
    println(f"IMT_EMPTY depth=4 root={out}");
}

#[test]
fn imt_empty_depth_5() {
    let out: Field = empty_subtree_root::<5>();
    println(f"IMT_EMPTY depth=5 root={out}");
}

#[test]
fn imt_empty_depth_20() {
    let out: Field = empty_subtree_root::<20>();
    println(f"IMT_EMPTY depth=20 root={out}");
}

// ---- Stage B vectors: one-leaf-at-index-0 root -------------------------

#[test]
fn imt_one_leaf_depth_4_leaf_42() {
    let out: Field = root_after_one_leaf_at_zero::<4>(42);
    println(f"IMT_ONE depth=4 leaf=0x2a root={out}");
}

#[test]
fn imt_one_leaf_depth_20_leaf_commit() {
    let leaf: Field = 0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2;
    let out: Field = root_after_one_leaf_at_zero::<20>(leaf);
    println(f"IMT_ONE depth=20 leaf={leaf} root={out}");
}
