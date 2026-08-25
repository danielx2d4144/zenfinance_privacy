// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Oracle.sol";

/// @notice Grants Oracle MANAGER_ROLE to the relayer so the price keeper can
///         push prices without the deployer key.
///
/// @dev Why this exists: Oracle.MAX_STALENESS_WINDOW is 3600s and cannot be
///      raised without redeploying (Oracle.sol:25, enforced at :92). So prices
///      MUST be pushed at least hourly by something. The keeper
///      (scripts/price-keeper.mjs) does that, and it runs on the relayer key
///      that data-api already holds — the deployer key stays offline.
///
///      Run once per Oracle deployment:
///        forge script script/GrantOracleManagerToRelayer.s.sol \
///          --rpc-url horizen --broadcast --legacy
contract GrantOracleManagerToRelayer is Script {
    /// V3 Oracle (deployment block 26008305).
    address constant ORACLE = 0xef554bE4a2D2Eaa5f9A64C8017e60A5e5C24a9a2;

    /// Shared relayer, same key data-api signs with.
    address constant RELAYER = 0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        Oracle oracle = Oracle(ORACLE);
        bytes32 managerRole = oracle.MANAGER_ROLE();

        if (oracle.hasRole(managerRole, RELAYER)) {
            console.log("Relayer already has MANAGER_ROLE - nothing to do.");
            return;
        }

        vm.startBroadcast(pk);
        oracle.grantRole(managerRole, RELAYER);
        vm.stopBroadcast();

        require(oracle.hasRole(managerRole, RELAYER), "grant did not take effect");
        console.log("Granted Oracle MANAGER_ROLE to relayer:", RELAYER);
    }
}
