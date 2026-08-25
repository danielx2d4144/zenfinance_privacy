// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Emergency script to refresh stale Oracle prices
/// @dev Use this as a temporary fix until Stork integration is deployed
contract RefreshOraclePrices is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2; // V3 Oracle

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracle = Oracle(oracleAddr);

        // Refresh USDC price: $1.00
        oracle.pushPrice(0, 1e8);

        // Refresh cbBTC price: $60,000
        oracle.pushPrice(1, 60000e8);

        vm.stopBroadcast();

        console.log("Oracle prices refreshed at block:", block.number);
        console.log("  USDC (ID 0): $1.00");
        console.log("  cbBTC (ID 1): $60,000");
        console.log("  Timestamp:", block.timestamp);
    }
}
