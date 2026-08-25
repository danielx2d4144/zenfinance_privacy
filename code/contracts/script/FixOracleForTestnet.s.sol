// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Grant MANAGER_ROLE and disable Stork, use manual prices
contract FixOracleForTestnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(deployerPrivateKey);
        address oracleAddr = 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2; // V3 Oracle

        vm.startBroadcast(deployerPrivateKey);

        Oracle oracle = Oracle(oracleAddr);

        // Grant MANAGER_ROLE to admin (needed to push prices)
        bytes32 managerRole = oracle.MANAGER_ROLE();
        oracle.grantRole(managerRole, admin);

        // Disable Stork feeds (set to bytes32(0) to fall back to manual prices)
        oracle.setStorkFeed(0, bytes32(0)); // USDC
        oracle.setStorkFeed(1, bytes32(0)); // cbBTC

        // Push fresh prices
        oracle.pushPrice(0, 1e8);         // USDC: $1.00
        oracle.pushPrice(1, 79000e8);     // BTC: $79,000

        vm.stopBroadcast();

        console.log("Oracle fixed for testnet:");
        console.log("  MANAGER_ROLE granted to:", admin);
        console.log("  Stork feeds disabled");
        console.log("  Manual prices set:");
        console.log("    USDC (ID 0): $1.00");
        console.log("    cbBTC (ID 1): $79,000");
    }
}
