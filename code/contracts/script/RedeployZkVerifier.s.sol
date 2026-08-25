// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ZkVerifier} from "../src/ZkVerifier.sol";
import {VkRegistry} from "../src/libraries/VkRegistry.sol";

/// @notice Redeploy ZkVerifier with corrected Pedersen VK hashes
/// @dev The previous deployment used Kurier VK hashes instead of Pedersen hashes,
///      causing AggregationVerifyFailed() errors when verifying on-chain.
///
///      Usage:
///        source ~/.zenfinance/horizen-deployer.env
///        forge script script/RedeployZkVerifier.s.sol:RedeployZkVerifier \
///          --rpc-url $HORIZEN_TESTNET_HTTPS --broadcast --slow
contract RedeployZkVerifier is Script {
    address internal constant DEFAULT_ZKVERIFY_PROXY =
        0x3098A6974649478f0133046e44105AA84e868C21;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address proxy = vm.envOr("ZKVERIFY_PROXY", DEFAULT_ZKVERIFY_PROXY);

        console.log("Deploying ZkVerifier...");
        console.log("  Admin:", admin);
        console.log("  zkVerify proxy:", proxy);

        vm.startBroadcast(pk);
        ZkVerifier zk = new ZkVerifier(admin, proxy, VkRegistry.pack());
        vm.stopBroadcast();

        console.log("ZkVerifier deployed at:", address(zk));
        console.log("");
        console.log("IMPORTANT: Update the following contracts to use the new ZkVerifier:");
        console.log("  - PrivacyEntry");
        console.log("  - ShieldedSupplyPool");
        console.log("  - ShieldedPositionPool");
        console.log("  - LiquidationBoard");
    }
}
