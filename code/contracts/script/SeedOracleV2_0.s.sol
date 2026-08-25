// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Seed Oracle with initial prices for v2.0 deployment
contract SeedOracleV2_0 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = 0x128cB52bE500871bcBFBeCfb28E53fa89AbB14B5;

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracle = Oracle(oracleAddr);

        // Seed USDC price: $1.00 (8 decimals = 1e8)
        oracle.pushPrice(0, 1e8);

        // Seed cbBTC price: $60,000 (8 decimals = 60000e8)
        oracle.pushPrice(1, 60000e8);

        vm.stopBroadcast();

        console.log("Oracle prices seeded:");
        console.log("  USDC (ID 0): $1.00");
        console.log("  cbBTC (ID 1): $60,000");
    }
}
