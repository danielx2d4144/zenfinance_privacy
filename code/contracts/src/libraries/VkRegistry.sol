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
///      Day 14c re-pinned every value after the circuit-side hash swap
///      from Pedersen to Poseidon2 (see memory/project_pedersen_grumpkin_too_expensive.md).
///
///      `pack()` returns a `bytes32[NUM_CIRCUITS]` ordered to match the
///      `IZkVerifier.CircuitId` enum — feed it to `new ZkVerifier(...)`.
library VkRegistry {
    // Day 4 circuits ------------------------------------------------------
    bytes32 internal constant ENTRY_DEPOSIT =
        0x2cb1a74389c8e9874bc7afb547715f84294b5b9ad4afda62f673f0d7723914d3;
    bytes32 internal constant ENTRY_WITHDRAW =
        0x1feea9cbba20ac77c4a57ce109b9f469ca66f28f9589336f5c374f5de1cb72f7;
    bytes32 internal constant SUPPLY_ASSET =
        0x25acc035ddd29df9141476091055fe4928d50e836c07ea723b4b8c02fbe7f7c6;
    bytes32 internal constant WITHDRAW_SUPPLY =
        0x18959383b7a911cc6a75759adcf9d3639ec3f9e5009438ae636c40718366889c;
    bytes32 internal constant DEPOSIT_COLLATERAL =
        0x2f711a9ef305f88bf6f01c2110430f47e82ef9c9542c5d1ca6ec6a2c3ffe2b16;

    // Day 5 circuits ------------------------------------------------------
    bytes32 internal constant WITHDRAW_COLLATERAL =
        0x24871915f320a4bc37ff6436424394660768b2176d9e4b32653b6796e1643cdc;
    bytes32 internal constant BORROW =
        0x08d36912f9bb3b71d0773b5a7058d8c015908324e704553ce607b325cbb32a10;
    bytes32 internal constant REPAY =
        0x20e23e6c6e062ab49e4c8cb63f3e24d631a22c184b6b24c164b7fef34a609b0b;
    bytes32 internal constant LIQUIDATE =
        0x02970702f859db033e1bfd39a3cccb83febd4cda36b3512554fc7b74483bc914;
    bytes32 internal constant CONSOLIDATE_BALANCE =
        0x1bd0e1573b44b78c835e1f226dbfee8816743117198715875424e0b2ec333f0c;
    bytes32 internal constant COMPUTE_TRIGGERS =
        0x22165dc59931e98ee8cebfee4c559f991812cfd2802db553fe0e6c4a15b4e1f3;

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
