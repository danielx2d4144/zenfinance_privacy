// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

contract SeedOracleV1_2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address oracle = 0x8D1a117d9478B357FDD80AA5DC0f66487bc23E55;

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracleContract = Oracle(oracle);

        // Seed prices: USDC=$1.00, cbBTC=$60,000
        oracleContract.pushPrice(0, 1e8);        // USDC: $1.00 (8 decimals)
        oracleContract.pushPrice(1, 6e12);       // cbBTC: $60,000 (8 decimals)

        vm.stopBroadcast();

        console.log("Oracle seeded:");
        console.log("  USDC (ID 0): $1.00");
        console.log("  cbBTC (ID 1): $60,000");
    }
}
