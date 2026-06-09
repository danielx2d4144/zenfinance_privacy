// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Poseidon2} from "./Poseidon2.sol";

/// @title PoseidonIMT -- Tornado-style binary incremental Merkle tree
///        keyed by the Stage-A Poseidon2 hash on BN254.
///
/// @notice Day 14c Stage B. Depth = 20 matches `lib_common::TREE_DEPTH`
///         (`code/circuits/lib_common/src/lib.nr:33`) so a circuit
///         witness produced by the dapp with `siblings[20]` +
///         `index_bits[20]` reaches the same root the contract holds.
///
///         Empty-subtree convention: `zeros[0] = 0` (the Field-zero
///         leaf the circuits assume for unfilled slots),
///         `zeros[d] = Poseidon2.hash2(zeros[d-1], zeros[d-1])`. The
///         empty-tree root and one-leaf-at-zero root pinned in the
///         Foundry tests against Noir-generated vectors
///         (`code/circuits/scripts/poseidon_vectors/`).
///
/// @dev Storage layout per State:
///        slot 0:  currentRoot          (bytes32)
///        slot 1:  nextLeafIndex | nextHistoryIndex | initialized (packed)
///        slot 2..21:  zeros[20]
///        slot 22..41: filledSubtrees[20]
///        slot 42..73: history[32]
///      74 slots per IMT instance.
library PoseidonIMT {
    uint256 internal constant TREE_DEPTH = 20;
    uint256 internal constant ROOT_HISTORY_SIZE = 32;

    error TreeFull();
    error NotInitialized();
    error AlreadyInitialized();

    struct State {
        bytes32 currentRoot;
        uint32 nextLeafIndex;
        uint32 nextHistoryIndex;
        bool initialized;
        bytes32[TREE_DEPTH] zeros;
        bytes32[TREE_DEPTH] filledSubtrees;
        bytes32[ROOT_HISTORY_SIZE] history;
    }

    /// @notice Initialise a fresh IMT in storage. Computes the 20
    ///         empty-subtree roots from `zeros[0] = 0` upward and
    ///         records the empty-tree root as `currentRoot`. Idempotent
    ///         only via the `AlreadyInitialized` revert -- consumers
    ///         must call this exactly once.
    function init(State storage self) internal {
        if (self.initialized) revert AlreadyInitialized();

        bytes32 z = bytes32(0);
        for (uint256 d; d < TREE_DEPTH; ++d) {
            self.zeros[d] = z;
            self.filledSubtrees[d] = z;
            z = bytes32(Poseidon2.hash2(uint256(z), uint256(z)));
        }
        // `z` after the loop is the root of a fully-empty depth-20 tree.
        self.currentRoot = z;
        self.initialized = true;
        // history slots stay zero; `known()` rejects bytes32(0), so the
        // empty-tree root is NOT considered known until at least one
        // insert lands. That matches the "only proofs against a real
        // committed snapshot are accepted" property the verifier wants.
    }

    /// @notice Append `leaf` at `nextLeafIndex`, recompute the root,
    ///         and push it onto the history ring.
    /// @return idx The leaf index this commitment landed at.
    /// @return newRoot The post-insert root, also stored as `currentRoot`.
    function insert(State storage self, bytes32 leaf)
        internal
        returns (uint32 idx, bytes32 newRoot)
    {
        if (!self.initialized) revert NotInitialized();
        idx = self.nextLeafIndex;
        if (uint256(idx) >= (uint256(1) << TREE_DEPTH)) revert TreeFull();

        bytes32 cur = leaf;
        uint32 walk = idx;
        for (uint256 d; d < TREE_DEPTH; ++d) {
            if (walk & 1 == 0) {
                // current is the left child at depth d; right sibling
                // is the still-empty subtree. Cache cur as the latest
                // left at this depth so a future right-side insert
                // can pair against it.
                self.filledSubtrees[d] = cur;
                cur = bytes32(
                    Poseidon2.hash2(uint256(cur), uint256(self.zeros[d]))
                );
            } else {
                // current is the right child; pair with the cached
                // left sibling stored on a previous insert.
                cur = bytes32(
                    Poseidon2.hash2(
                        uint256(self.filledSubtrees[d]), uint256(cur)
                    )
                );
            }
            walk >>= 1;
        }

        self.nextLeafIndex = idx + 1;
        self.currentRoot = cur;

        uint32 hIdx = self.nextHistoryIndex;
        self.history[uint256(hIdx) % ROOT_HISTORY_SIZE] = cur;
        self.nextHistoryIndex = hIdx + 1;

        newRoot = cur;
    }

    /// @notice Return true if `root` is in the 32-deep history ring.
    /// @dev Rejects `bytes32(0)` so unwritten history slots never
    ///      register as "known" before the first insert. Production
    ///      roots are 254-bit BN254 Fr elements -- the probability of a
    ///      legitimate root colliding with the zero value is
    ///      cryptographically negligible.
    function known(State storage self, bytes32 root)
        internal
        view
        returns (bool)
    {
        if (root == bytes32(0)) return false;
        bytes32[ROOT_HISTORY_SIZE] storage h = self.history;
        for (uint256 i; i < ROOT_HISTORY_SIZE; ++i) {
            if (h[i] == root) return true;
        }
        return false;
    }
}
