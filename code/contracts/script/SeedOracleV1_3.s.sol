// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Seed Oracle with initial prices for v1.3 deployment
contract SeedOracleV1_3 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = 0x116f6c37021a3431342B55D3f436d696A083A9bf;

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
