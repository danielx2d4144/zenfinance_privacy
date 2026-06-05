// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {RateModel} from "../src/RateModel.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IRateModel} from "../src/interfaces/IRateModel.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice Day-9 testnet deploy: mock tokens + AssetRegistry + RateModel,
///         with USDC (id=0) and cbBTC (id=1) initialized so the accrue-keeper
///         has something to call against.
/// @dev    Uses MockERC20 because Base Sepolia has no canonical USDC/cbBTC
///         testnet addresses. On mainnet these become the real token addresses.
///         Caller (admin = the relayer) ends up holding MANAGER_ROLE on both
///         registry and rate-model so subsequent ops don't need a role grant.
contract DeployLendingStack is Script {
    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;
    uint256 internal constant RAY = 1e27;

    struct Deployment {
        MockERC20 usdc;
        MockERC20 cbBtc;
        AssetRegistry registry;
        RateModel rateModel;
    }

    function run(address admin, address oracleFeed) external returns (Deployment memory d) {
        vm.startBroadcast();

        d.usdc = new MockERC20("Mock USDC", "USDC", 6);
        d.cbBtc = new MockERC20("Mock cbBTC", "cbBTC", 8);

        d.registry = new AssetRegistry(admin);
        d.registry.grantRole(d.registry.MANAGER_ROLE(), admin);
        d.registry.enableAsset(USDC_ID, _cfg(address(d.usdc), 6, 7_500, 8_000, 500, 3_000, 1_000, oracleFeed));
        d.registry.enableAsset(CBBTC_ID, _cfg(address(d.cbBtc), 8, 6_500, 7_500, 800, 3_750, 2_000, oracleFeed));

        d.rateModel = new RateModel(admin, address(d.registry));
        d.rateModel.grantRole(d.rateModel.MANAGER_ROLE(), admin);

        IRateModel.RateParams memory rp = IRateModel.RateParams({
            uOptimalRay: uint128(8 * RAY / 10),     // 80%
            slope1Ray: uint128(4 * RAY / 100),      // 4% APR
            slope2Ray: uint128(75 * RAY / 100)      // 75% APR over kink
        });
        d.rateModel.initializeAsset(USDC_ID, rp);
        d.rateModel.initializeAsset(CBBTC_ID, rp);

        vm.stopBroadcast();

        console.log("MockUSDC      :", address(d.usdc));
        console.log("MockcbBTC     :", address(d.cbBtc));
        console.log("AssetRegistry :", address(d.registry));
        console.log("RateModel     :", address(d.rateModel));
    }

    function _cfg(
        address token,
        uint8 decimals,
        uint16 ltv,
        uint16 lt,
        uint16 bonus,
        uint16 feeOfBonus,
        uint16 rf,
        address oracleFeed
    ) internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: token,
            oracleFeed: oracleFeed,
            decimals: decimals,
            ltvBps: ltv,
            liquidationThresholdBps: lt,
            liquidationBonusBps: bonus,
            protocolFeeOfBonusBps: feeOfBonus,
            reserveFactorBps: rf,
            closeFactorHfThresholdBps: 9_500,
            minBorrowSize: 0,
            dustDebtThreshold: 0,
            suppliable: true,
            borrowable: true,
            collateralizable: true,
            enabled: false  // set true automatically by enableAsset
        });
    }
}
