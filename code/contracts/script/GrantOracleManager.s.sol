// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {Oracle} from "../src/Oracle.sol";

contract GrantOracleManager is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        address oracle = 0xe5cd6Ceea10baF0F3961b8e9B4AFd6acE3C03dAf;
        address relayer = 0xB19f1F29DdC0C5248DE5bA98dDa4f94f9a562707;

        vm.startBroadcast(pk);

        Oracle(oracle).grantRole(
            Oracle(oracle).MANAGER_ROLE(),
            relayer
        );

        console.log("Granted MANAGER_ROLE to relayer:", relayer);

        // Push fresh prices
        Oracle(oracle).pushPrice(0, 1e8);  // USDC = $1.00
        Oracle(oracle).pushPrice(1, 60_000e8);  // cbBTC = $60,000

        console.log("Pushed fresh prices");

        vm.stopBroadcast();
    }
}
