// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script} from "forge-std/Script.sol";

import {ZkVerifier} from "../src/ZkVerifier.sol";
import {VkRegistry} from "../src/libraries/VkRegistry.sol";

/// @notice Deploys ZkVerifier with all 11 v1 circuit vkHashes pinned.
/// @dev `proxy_` is the on-chain `IVerifyProofAggregation` address. On
///      Horizen testnet/mainnet this is the canonical zkVerify proxy
///      (Day-8 wiring); on Anvil it points at MockVerifyProofAggregation.
contract DeployZkVerifier is Script {
    function run(address admin, address proxy_) external returns (ZkVerifier zk) {
        vm.startBroadcast();
        zk = new ZkVerifier(admin, proxy_, VkRegistry.pack());
        vm.stopBroadcast();
    }
}
