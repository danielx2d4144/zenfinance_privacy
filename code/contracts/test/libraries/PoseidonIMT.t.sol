// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {PoseidonIMT} from "../../src/libraries/PoseidonIMT.sol";
import {Poseidon2} from "../../src/libraries/Poseidon2.sol";

/// Thin harness so the State struct sits in real storage and we can
/// drive it via external calls (library `internal` functions inline,
/// but the State pointer must come from a real storage slot for the
/// fixed-size arrays to lay out correctly).
contract IMTHarness {
    using PoseidonIMT for PoseidonIMT.State;

    PoseidonIMT.State internal _s;

    function init() external {
        _s.init();
    }

    function insert(bytes32 leaf) external returns (uint32 idx, bytes32 newRoot) {
        return _s.insert(leaf);
    }

    function currentRoot() external view returns (bytes32) {
        return _s.currentRoot;
    }

    function nextLeafIndex() external view returns (uint32) {
        return _s.nextLeafIndex;
    }

    function nextHistoryIndex() external view returns (uint32) {
        return _s.nextHistoryIndex;
    }

    function zeros(uint256 d) external view returns (bytes32) {
        return _s.zeros[d];
    }

    function known(bytes32 root) external view returns (bool) {
        return _s.known(root);
    }
}

/// @notice Day 14c Stage B tests for the depth-20 Poseidon2 incremental
///         Merkle tree. Pin Solidity-side roots against Noir-generated
///         vectors from `code/circuits/scripts/poseidon_vectors/`,
///         exercise the Tornado-style filledSubtrees logic with 5
///         interleaved-path leaves, and verify ROOT_HISTORY_SIZE = 32
///         drops the oldest root after a 33-leaf burst.
contract PoseidonIMTTest is Test {
    IMTHarness internal imt;

    // Noir vectors (see scripts/poseidon_vectors/src/main.nr):
    //   IMT_EMPTY depth=20 root =
    bytes32 internal constant NOIR_EMPTY_ROOT_DEPTH_20 =
        0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755;
    //   IMT_ONE depth=20 leaf=0x1f7e1b73... root =
    bytes32 internal constant NOIR_ONE_LEAF_ROOT_DEPTH_20 =
        0x13300185e7b6e3bfa8ee2fb1c5c0a0efa7bda96e7185b2a75a98ef1511268dbc;
    bytes32 internal constant LEAF_FOR_ONE_LEAF_VECTOR =
        0x1f7e1b73f1c6a9c11de4fee5e57bcaff0e3a85a7b67afcd3edc8e1f9bbc4d3a2;

    // The Field-zero leaf the circuits assume for unfilled slots.
    bytes32 internal constant ZERO_LEAF = bytes32(0);

    function setUp() public {
        imt = new IMTHarness();
        imt.init();
    }

    // ----- init / shape ------------------------------------------------------

    function test_init_currentRoot_matches_Noir_emptyTree_depth20() public view {
        require(
            imt.currentRoot() == NOIR_EMPTY_ROOT_DEPTH_20,
            "init: empty-tree root != Noir vector"
        );
    }

    function test_init_zeros_layer_is_doubled_hash_chain() public view {
        // zeros[0] = 0; zeros[d] = hash2(zeros[d-1], zeros[d-1]).
        bytes32 expected = bytes32(0);
        for (uint256 d; d < 20; ++d) {
            require(imt.zeros(d) == expected, "zeros[d] drift");
            expected = bytes32(Poseidon2.hash2(uint256(expected), uint256(expected)));
        }
    }

    function test_init_revertsOnSecondCall() public {
        vm.expectRevert(PoseidonIMT.AlreadyInitialized.selector);
        imt.init();
    }

    // ----- single-leaf root ---------------------------------------------------

    function test_insert_one_leaf_matches_Noir_vector() public {
        (uint32 idx, bytes32 newRoot) = imt.insert(LEAF_FOR_ONE_LEAF_VECTOR);
        require(idx == 0, "first leaf must land at index 0");
        require(
            newRoot == NOIR_ONE_LEAF_ROOT_DEPTH_20,
            "one-leaf root != Noir vector"
        );
        require(imt.currentRoot() == newRoot, "currentRoot drift");
        require(imt.nextLeafIndex() == 1, "nextLeafIndex drift");
        require(imt.known(newRoot), "one-leaf root not in known()");
        require(
            !imt.known(NOIR_EMPTY_ROOT_DEPTH_20),
            "empty-tree root must drop from known() after first insert"
        );
    }

    // ----- 5-leaf self-consistency -------------------------------------------

    /// @dev Hand-computes the root after 5 sequential left-to-right inserts
    ///      using the same Tornado-style filledSubtrees algorithm that lives
    ///      in PoseidonIMT.insert, but written out longhand here so a
    ///      library-side algorithmic bug (e.g. wrong filledSubtrees update
    ///      ordering) doesn't slip through.
    function test_insert_five_leaves_matches_hand_computed_root() public {
        bytes32[5] memory leaves = [
            bytes32(uint256(0x11)),
            bytes32(uint256(0x22)),
            bytes32(uint256(0x33)),
            bytes32(uint256(0x44)),
            bytes32(uint256(0x55))
        ];

        // Drive the library.
        bytes32 libRoot;
        for (uint256 i; i < 5; ++i) {
            (, libRoot) = imt.insert(leaves[i]);
        }

        // Reference implementation: full depth-20 tree, all unfilled
        // positions = zeros[d], compute the root straight from leaves.
        bytes32[20] memory zs;
        bytes32 z = bytes32(0);
        for (uint256 d; d < 20; ++d) {
            zs[d] = z;
            z = bytes32(Poseidon2.hash2(uint256(z), uint256(z)));
        }

        // 5 leaves occupy positions 0..4. Build the depth-20 root from
        // the bottom by computing only the populated subtree, then
        // walking the lone surviving "top" node up to the root by
        // pairing with zeros[d] sibling at each remaining depth.
        bytes32 n01 = bytes32(Poseidon2.hash2(uint256(leaves[0]), uint256(leaves[1])));
        bytes32 n23 = bytes32(Poseidon2.hash2(uint256(leaves[2]), uint256(leaves[3])));
        bytes32 n45 = bytes32(Poseidon2.hash2(uint256(leaves[4]), uint256(zs[0]))); // pos 5 empty
        // depth-1 internal nodes: positions 0..1 of level 2
        bytes32 m0 = bytes32(Poseidon2.hash2(uint256(n01), uint256(n23)));
        bytes32 m1 = bytes32(Poseidon2.hash2(uint256(n45), uint256(zs[1])));
        // depth-2 internal node: the top of the populated subtree
        bytes32 top = bytes32(Poseidon2.hash2(uint256(m0), uint256(m1)));
        // Walk up to depth 20 with zeros[d] siblings on the right.
        for (uint256 d = 3; d < 20; ++d) {
            top = bytes32(Poseidon2.hash2(uint256(top), uint256(zs[d])));
        }

        require(libRoot == top, "5-leaf: library != reference root");
        require(imt.nextLeafIndex() == 5, "5-leaf: nextLeafIndex drift");
    }

    // ----- 33-leaf history rollover ------------------------------------------

    function test_history_rollover_drops_oldest_after_33_inserts() public {
        bytes32 root1;
        bytes32 root2;
        bytes32 root33;
        // BN254 Fr prime, used to keep keccak-derived leaves in-Field.
        uint256 PRIME =
            0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        for (uint256 i; i < 33; ++i) {
            // Reduce mod PRIME so the leaf is a valid BN254 Field element
            // (real production leaves come from in-circuit commitments
            // and are already < PRIME; tests need to mirror that).
            uint256 raw = uint256(keccak256(abi.encodePacked("leaf", i)));
            bytes32 leaf = bytes32(raw % PRIME);
            (, bytes32 r) = imt.insert(leaf);
            if (i == 0) root1 = r;
            if (i == 1) root2 = r;
            if (i == 32) root33 = r;
        }

        require(root1 != bytes32(0), "root1 missing");
        require(root2 != bytes32(0), "root2 missing");
        require(root33 != bytes32(0), "root33 missing");

        // root_1 was written at history[0]; the 33rd insert overwrote
        // history[0] with root_33. So root_1 is gone, root_2 (at
        // history[1]) and root_33 (now at history[0]) remain.
        require(!imt.known(root1), "root1 must drop after 33 inserts");
        require(imt.known(root2), "root2 must survive 33 inserts");
        require(imt.known(root33), "root33 must be current");
        require(
            imt.currentRoot() == root33,
            "currentRoot must equal root33"
        );
        require(imt.nextLeafIndex() == 33, "nextLeafIndex drift");
        require(imt.nextHistoryIndex() == 33, "nextHistoryIndex drift");
    }

    // ----- safety guards -----------------------------------------------------

    function test_known_rejects_zero() public view {
        require(!imt.known(bytes32(0)), "known(0) must return false");
    }

    function test_uninitialized_insert_reverts() public {
        IMTHarness fresh = new IMTHarness();
        vm.expectRevert(PoseidonIMT.NotInitialized.selector);
        fresh.insert(bytes32(uint256(0x11)));
    }
}
