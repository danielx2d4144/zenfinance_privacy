// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Temporary fix: Disable Stork feeds and use manual price pushing
/// @dev Stork contract on Horizen doesn't have price data yet
contract DisableStorkUseManualPrices is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2;

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracle = Oracle(oracleAddr);

        // Disable Stork feeds (set to bytes32(0) to fall back to manual prices)
        oracle.setStorkFeed(0, bytes32(0)); // USDC
        oracle.setStorkFeed(1, bytes32(0)); // cbBTC

        // Push fresh prices
        oracle.pushPrice(0, 1e8);         // USDC: $1.00
        oracle.pushPrice(1, 79000e8);     // BTC: $79,000 (current price from Stork API)

        vm.stopBroadcast();

        console.log("Stork feeds disabled, manual prices set:");
        console.log("  USDC (ID 0): $1.00");
        console.log("  cbBTC (ID 1): $79,000");
        console.log("");
        console.log("Oracle now uses manual price pushing until Stork is configured.");
    }
}
