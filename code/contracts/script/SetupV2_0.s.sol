// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";
import "../src/RateModel.sol";
import "../src/interfaces/IRateModel.sol";

/// @notice Post-deployment setup for v2.0
contract SetupV2_0 is Script {
    uint256 constant RAY = 1e27;

    // Relayer address from data-api
    address constant RELAYER = 0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707;

    // v2.0 addresses
    address constant ORACLE = 0x128cB52bE500871bcBFBeCfb28E53fa89AbB14B5;
    address constant RATE_MODEL = 0xB795a9818b6521D76627271C19fAd4deb9dA79F2;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracle = Oracle(ORACLE);
        RateModel rateModel = RateModel(RATE_MODEL);

        // 1. Grant MANAGER_ROLE to relayer for Oracle
        bytes32 managerRole = oracle.MANAGER_ROLE();
        oracle.grantRole(managerRole, RELAYER);
        console.log("Granted Oracle MANAGER_ROLE to relayer");

        // 2. Grant MANAGER_ROLE to relayer for RateModel (if needed)
        bytes32 rmManagerRole = rateModel.MANAGER_ROLE();
        rateModel.grantRole(rmManagerRole, RELAYER);
        console.log("Granted RateModel MANAGER_ROLE to relayer");

        // 3. Verify oracle prices (should already be set from deployment)
        uint128 usdcPrice = oracle.getPrice(0);
        uint128 cbBtcPrice = oracle.getPrice(1);
        console.log("USDC price:", usdcPrice);
        console.log("cbBTC price:", cbBtcPrice);

        // 4. Rate models should already be initialized from deployment
        console.log("Rate models should be initialized from deployment");

        vm.stopBroadcast();

        console.log("\nSetup complete! Relayer has been granted MANAGER_ROLE.");
    }
}
