// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RateModel.sol";
import "../src/interfaces/IRateModel.sol";

contract InitializeRateModelV1_2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address rateModelAddr = 0x1B66f9c2e96757920e7cbABFac1A46235Fec8613;

        vm.startBroadcast(deployerPrivateKey);

        RateModel rateModel = RateModel(rateModelAddr);

        // Initialize USDC (asset 0)
        rateModel.initializeAsset(
            0,
            IRateModel.RateParams({
                uOptimalRay: 8e26, // 80% utilization optimal
                slope1Ray: 1e25,   // 1% slope below optimal
                slope2Ray: 5e25    // 5% slope above optimal
            })
        );

        // Initialize cbBTC (asset 1)
        rateModel.initializeAsset(
            1,
            IRateModel.RateParams({
                uOptimalRay: 7e26, // 70% utilization optimal
                slope1Ray: 8e24,   // 0.8% slope below optimal
                slope2Ray: 6e25    // 6% slope above optimal
            })
        );

        vm.stopBroadcast();

        console.log("RateModel initialized:");
        console.log("  USDC (ID 0): indices set to 1e27 (RAY)");
        console.log("  cbBTC (ID 1): indices set to 1e27 (RAY)");
    }
}
