// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";

/// @notice Per subsystem_test.md Day-1 T-1.1: enable / disable / role gating.
contract AssetRegistryTest is Test {
    AssetRegistry internal registry;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant GUARDIAN = address(0xC0DE);
    address internal constant OUTSIDER = address(0xDEAD);

    address internal constant USDC_TOKEN = address(0x1111);
    address internal constant USDC_FEED = address(0x2222);
    address internal constant CBBTC_TOKEN = address(0x3333);
    address internal constant CBBTC_FEED = address(0x4444);

    function setUp() public {
        registry = new AssetRegistry(ADMIN);
        vm.startPrank(ADMIN);
        registry.grantRole(registry.MANAGER_ROLE(), MANAGER);
        registry.grantRole(registry.GUARDIAN_ROLE(), GUARDIAN);
        vm.stopPrank();
    }

    function _usdcConfig() internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: USDC_TOKEN,
            oracleFeed: USDC_FEED,
            decimals: 6,
            ltvBps: 7_500,
            liquidationThresholdBps: 8_000,
            liquidationBonusBps: 500,
            protocolFeeOfBonusBps: 3_000,
            reserveFactorBps: 1_000,
            closeFactorHfThresholdBps: 9_500,
            minBorrowSize: 0,
            dustDebtThreshold: 0,
            suppliable: true,
            borrowable: true,
            collateralizable: true,
            enabled: false
        });
    }

    function _cbBtcConfig() internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: CBBTC_TOKEN,
            oracleFeed: CBBTC_FEED,
            decimals: 8,
            ltvBps: 6_500,
            liquidationThresholdBps: 7_500,
            liquidationBonusBps: 800,
            protocolFeeOfBonusBps: 3_750,
            reserveFactorBps: 2_000,
            closeFactorHfThresholdBps: 9_500,
            minBorrowSize: 0,
            dustDebtThreshold: 0,
            suppliable: true,
            borrowable: true,
            collateralizable: true,
            enabled: false
        });
    }

    function test_enableAsset_byManager_emitsEvents() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();

        vm.expectEmit(true, true, false, false);
        emit IAssetRegistry.AssetEnabled(0, USDC_TOKEN);

        vm.prank(MANAGER);
        registry.enableAsset(0, c);

        IAssetRegistry.AssetConfig memory stored = registry.assets(0);
        assertEq(stored.token, USDC_TOKEN);
        assertTrue(stored.enabled);
        assertEq(registry.numAssets(), 1);
        assertTrue(registry.isEnabled(0));
    }

    function testRevert_enableAsset_byNonManager() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        registry.enableAsset(1, _cbBtcConfig());
    }

    function testRevert_enableAsset_alreadyExists() public {
        vm.startPrank(MANAGER);
        registry.enableAsset(0, _usdcConfig());
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetAlreadyExists.selector, uint8(0)));
        registry.enableAsset(0, _usdcConfig());
        vm.stopPrank();
    }

    function testRevert_enableAsset_overMaxAssetId() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidAssetId.selector, uint8(16)));
        registry.enableAsset(16, _usdcConfig());
    }

    function testRevert_enableAsset_zeroTokenAddress() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.token = address(0);
        vm.prank(MANAGER);
        vm.expectRevert(AssetRegistry.ZeroAddress.selector);
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_invalidLtv() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.ltvBps = 10_000;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(AssetRegistry.InvalidBps.selector, "ltvBps", uint16(10_000))
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_invalidReserveFactor() public {
        // S14 §4: reserveFactor < 10_000 bps (I-SOLV-4)
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.reserveFactorBps = 10_000;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidBps.selector, "reserveFactorBps", uint16(10_000)
            )
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_ltBelowLtv() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.liquidationThresholdBps = c.ltvBps - 1;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.LiquidationThresholdBelowLtv.selector,
                c.ltvBps,
                uint16(c.ltvBps - 1)
            )
        );
        registry.enableAsset(0, c);
    }

    function test_updateAssetConfig_preservesEnabledFlag() public {
        vm.startPrank(MANAGER);
        registry.enableAsset(0, _usdcConfig());

        IAssetRegistry.AssetConfig memory updated = _usdcConfig();
        updated.ltvBps = 7_000;
        registry.updateAssetConfig(0, updated);
        vm.stopPrank();

        IAssetRegistry.AssetConfig memory stored = registry.assets(0);
        assertEq(stored.ltvBps, 7_000);
        assertTrue(stored.enabled, "enabled flag should be preserved across update");
    }

    function testRevert_updateAssetConfig_notConfigured() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetNotConfigured.selector, uint8(5)));
        registry.updateAssetConfig(5, _usdcConfig());
    }

    function test_disableAsset_flipsEnabled() public {
        vm.startPrank(MANAGER);
        registry.enableAsset(0, _usdcConfig());

        vm.expectEmit(true, false, false, false);
        emit IAssetRegistry.AssetDisabled(0);
        registry.disableAsset(0);
        vm.stopPrank();

        assertFalse(registry.isEnabled(0));
    }

    function test_reenableAsset_flipsEnabledBack() public {
        vm.startPrank(MANAGER);
        registry.enableAsset(0, _usdcConfig());
        registry.disableAsset(0);
        assertFalse(registry.isEnabled(0));

        registry.reenableAsset(0);
        vm.stopPrank();
        assertTrue(registry.isEnabled(0));
    }

    function test_pause_byGuardian_blocksEnable() public {
        vm.prank(GUARDIAN);
        registry.pause();

        vm.prank(MANAGER);
        vm.expectRevert();
        registry.enableAsset(0, _usdcConfig());

        vm.prank(ADMIN);
        registry.unpause();

        vm.prank(MANAGER);
        registry.enableAsset(0, _usdcConfig());
        assertTrue(registry.isEnabled(0));
    }

    function testRevert_pause_byOutsider() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        registry.pause();
    }

    function testRevert_constructor_zeroAdmin() public {
        vm.expectRevert(AssetRegistry.ZeroAddress.selector);
        new AssetRegistry(address(0));
    }

    function test_numAssets_tracksMultipleEnables() public {
        vm.startPrank(MANAGER);
        registry.enableAsset(0, _usdcConfig());
        registry.enableAsset(1, _cbBtcConfig());
        vm.stopPrank();
        assertEq(registry.numAssets(), 2);
    }

    function testRevert_enableAsset_invalidLiquidationThresholdAtCap() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.liquidationThresholdBps = 10_000;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidBps.selector,
                "liquidationThresholdBps",
                uint16(10_000)
            )
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_bonusOverCap() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.liquidationBonusBps = 2_001;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidBps.selector, "liquidationBonusBps", uint16(2_001)
            )
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_protocolFeeBpsOverCap() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.protocolFeeOfBonusBps = 10_001;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidBps.selector, "protocolFeeOfBonusBps", uint16(10_001)
            )
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_closeFactorThresholdOverCap() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.closeFactorHfThresholdBps = 10_001;
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidBps.selector, "closeFactorHfThresholdBps", uint16(10_001)
            )
        );
        registry.enableAsset(0, c);
    }

    function testRevert_enableAsset_zeroOracleFeed() public {
        IAssetRegistry.AssetConfig memory c = _usdcConfig();
        c.oracleFeed = address(0);
        vm.prank(MANAGER);
        vm.expectRevert(AssetRegistry.ZeroAddress.selector);
        registry.enableAsset(0, c);
    }

    function testRevert_disableAsset_notConfigured() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetNotConfigured.selector, uint8(0)));
        registry.disableAsset(0);
    }

    function testRevert_reenableAsset_notConfigured() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetNotConfigured.selector, uint8(0)));
        registry.reenableAsset(0);
    }
}
