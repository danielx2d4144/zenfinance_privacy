// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IZkVerifier} from "../interfaces/IZkVerifier.sol";

/// @title VkRegistry
/// @notice Single source of truth for the 11 circuit verification-key hashes.
/// @dev Spec: design-v2/subsystems/02_zk_circuits.md §2 (the 12 circuits;
///            v1 ships 11, with bucket_refresh deferred to v1.5).
///      Each constant is the Pedersen-domain vkHash emitted by
///      `bb write_vk -t evm` against the matching circuit in
///      `code/circuits/<circuit>/`. Recorded in
///      `design-v2/roadmap/progress_tracker.md`.
///
///      `pack()` returns a `bytes32[NUM_CIRCUITS]` ordered to match the
///      `IZkVerifier.CircuitId` enum — feed it to `new ZkVerifier(...)`.
library VkRegistry {
    // Day 4 circuits ------------------------------------------------------
    bytes32 internal constant ENTRY_DEPOSIT =
        0x2b315b228ad9d1124d0c77a4f4812d7f5d4fa97bd6c34da5ccf366e1bf36c645;
    bytes32 internal constant ENTRY_WITHDRAW =
        0x0d6eaaba1ffb40359304c8ba5acf9f6e9c5770180cb46bce7266322f299bebdd;
    bytes32 internal constant SUPPLY_ASSET =
        0x056c48ddfa2fd803a9037c1db2198e65f1acc3ecca83c92fa54d8b76d1631a67;
    bytes32 internal constant WITHDRAW_SUPPLY =
        0x2ed1cb47c676ffd7a77615d30892d52d1b13e3a4ce8b838472841579482c2abb;
    bytes32 internal constant DEPOSIT_COLLATERAL =
        0x1c5c568a48c9299dd98143271e92b5789e40cf24dd2a4c45710971d44b0e279a;

    // Day 5 circuits ------------------------------------------------------
    bytes32 internal constant WITHDRAW_COLLATERAL =
        0x00a0580b083d25ced7db2de46c7da47e6f20fcb255ac5c2d3d5983ea9c711b01;
    bytes32 internal constant BORROW =
        0x2f26f557f39e6e67a6e12bf0cf1fb829cf1439a8443fd9d39adff5caa60ae3b8;
    bytes32 internal constant REPAY =
        0x2c8e338f012f872c037e86c22ed1c8c6f5b0ef91b29004c195bd7124483d00d5;
    bytes32 internal constant LIQUIDATE =
        0x07303181b6304630990c35f21b94ff2f2ca9d7d64dd149a9ea6605e607c2be46;
    bytes32 internal constant CONSOLIDATE_BALANCE =
        0x080a500330e9d1a5688b72700e155ca9c08f4504ba496cb8bec86a39dd0e4a12;
    bytes32 internal constant COMPUTE_TRIGGERS =
        0x24d7519a8f955dfe41595d78deff63db5f88f98e126af02b0c42df5500e0a109;

    /// @return out an 11-slot array indexed by `IZkVerifier.CircuitId`.
    function pack() internal pure returns (bytes32[] memory out) {
        out = new bytes32[](11);
        out[uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT)] = ENTRY_DEPOSIT;
        out[uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW)] = ENTRY_WITHDRAW;
        out[uint8(IZkVerifier.CircuitId.SUPPLY_ASSET)] = SUPPLY_ASSET;
        out[uint8(IZkVerifier.CircuitId.WITHDRAW_SUPPLY)] = WITHDRAW_SUPPLY;
        out[uint8(IZkVerifier.CircuitId.DEPOSIT_COLLATERAL)] = DEPOSIT_COLLATERAL;
        out[uint8(IZkVerifier.CircuitId.WITHDRAW_COLLATERAL)] = WITHDRAW_COLLATERAL;
        out[uint8(IZkVerifier.CircuitId.BORROW)] = BORROW;
        out[uint8(IZkVerifier.CircuitId.REPAY)] = REPAY;
        out[uint8(IZkVerifier.CircuitId.LIQUIDATE)] = LIQUIDATE;
        out[uint8(IZkVerifier.CircuitId.CONSOLIDATE_BALANCE)] = CONSOLIDATE_BALANCE;
        out[uint8(IZkVerifier.CircuitId.COMPUTE_TRIGGERS)] = COMPUTE_TRIGGERS;
    }
}
