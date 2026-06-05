// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script} from "forge-std/Script.sol";

import {Oracle} from "../src/Oracle.sol";

/// @notice Deploys Oracle wired to a Stork verifier. After deploy the admin
///         should:
///           1. configureFeed(assetId, address(0xFEED), window) for each asset
///              (the second arg is a label; we only use it for events).
///           2. setStorkFeed(assetId, keccak256("BTCUSD")) for cbBTC.
///         USDC ($1 stable) stays on the push path and is updated rarely
///         (or skipped — getPrice never reads it in v1 because USDC is the
///         debt asset, not a collateral).
/// @dev    On Base Sepolia the Stork verifier is
///         0x647DFd812BC1e116c6992CB2bC353b2112176fD6.
contract DeployOracle is Script {
    function run(address admin, address stork_) external returns (Oracle oracle) {
        vm.startBroadcast();
        oracle = new Oracle(admin, stork_);
        vm.stopBroadcast();
    }
}
