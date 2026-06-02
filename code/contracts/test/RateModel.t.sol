// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {RateModel} from "../src/RateModel.sol";
import {IRateModel} from "../src/interfaces/IRateModel.sol";

/// @notice Per subsystem_test.md Day-1 T-1.2 + T-1.3: rate-curve monotonicity
///         and kink-slope behavior. Covers utilizationRay edge cases,
///         accrue idempotence in-block, and SafeCast-protected index growth.
contract RateModelTest is Test {
    AssetRegistry internal registry;
    RateModel internal rateModel;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant POOL = address(0xC0DE);
    address internal constant GUARDIAN = address(0x9999);

    address internal constant USDC_TOKEN = address(0x1111);
    address internal constant USDC_FEED = address(0x2222);

    uint8 internal constant USDC_ID = 0;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    function setUp() public {
        registry = new AssetRegistry(ADMIN);
        rateModel = new RateModel(ADMIN, address(registry));

        vm.startPrank(ADMIN);
        registry.grantRole(registry.MANAGER_ROLE(), MANAGER);
        rateModel.grantRole(rateModel.MANAGER_ROLE(), MANAGER);
        rateModel.grantRole(rateModel.POOL_ROLE(), POOL);
        rateModel.grantRole(rateModel.GUARDIAN_ROLE(), GUARDIAN);
        vm.stopPrank();

        IAssetRegistry.AssetConfig memory c = IAssetRegistry.AssetConfig({
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

        vm.startPrank(MANAGER);
        registry.enableAsset(USDC_ID, c);
        rateModel.initializeAsset(
            USDC_ID,
            IRateModel.RateParams({
                uOptimalRay: uint128(8 * RAY / 10), // 80%
                slope1Ray: uint128(4 * RAY / 100), // 4% APR
                slope2Ray: uint128(75 * RAY / 100) // 75% APR
            })
        );
        vm.stopPrank();
    }

    function _setUtilization(uint128 totalSupply, uint128 totalBorrow) internal {
        vm.prank(POOL);
        rateModel.setTotals(USDC_ID, totalSupply, totalBorrow);
    }

    // T-1.2: borrow rate strictly increasing below kink
    function test_borrowRate_monotoneBelowKink() public {
        _setUtilization(1e18, 0); // U=0
        uint256 r0 = rateModel.currentBorrowRateRay(USDC_ID);

        _setUtilization(1e18, 1e17); // U=10%
        uint256 r10 = rateModel.currentBorrowRateRay(USDC_ID);

        _setUtilization(1e18, 5e17); // U=50%
        uint256 r50 = rateModel.currentBorrowRateRay(USDC_ID);

        _setUtilization(1e18, 79e16); // U=79%
        uint256 r79 = rateModel.currentBorrowRateRay(USDC_ID);

        assertEq(r0, 0, "rate at zero util");
        assertLt(r0, r10, "0 < 10");
        assertLt(r10, r50, "10 < 50");
        assertLt(r50, r79, "50 < 79");
    }

    // T-1.3: slope strictly steeper above kink
    function test_borrowRate_slopeSteeperAboveKink() public {
        // slope below kink: r(50%) - r(40%) over 10% util
        _setUtilization(1e18, 4e17);
        uint256 r40 = rateModel.currentBorrowRateRay(USDC_ID);
        _setUtilization(1e18, 5e17);
        uint256 r50 = rateModel.currentBorrowRateRay(USDC_ID);
        uint256 slopeBelow = r50 - r40;

        // slope above kink: r(95%) - r(85%) over 10% util
        _setUtilization(1e18, 85e16);
        uint256 r85 = rateModel.currentBorrowRateRay(USDC_ID);
        _setUtilization(1e18, 95e16);
        uint256 r95 = rateModel.currentBorrowRateRay(USDC_ID);
        uint256 slopeAbove = r95 - r85;

        assertGt(slopeAbove, slopeBelow * 5, "post-kink slope >> pre-kink");
    }

    function test_borrowRate_atKink_equalsSlope1PerSecond() public {
        _setUtilization(1e18, 8e17); // U == uOptimal
        uint256 expected = (4 * RAY / 100) / SECONDS_PER_YEAR;
        assertEq(rateModel.currentBorrowRateRay(USDC_ID), expected);
    }

    function test_borrowRate_atMaxUtilization() public {
        _setUtilization(1e18, 1e18);
        // U=100%: slope1 + slope2 × (20%/20%) = 4% + 75% = 79% APR
        uint256 expected = (79 * RAY / 100) / SECONDS_PER_YEAR;
        assertEq(rateModel.currentBorrowRateRay(USDC_ID), expected);
    }

    function test_supplyRate_appliesReserveFactor() public {
        _setUtilization(1e18, 8e17); // U=80%
        uint256 brate = rateModel.currentBorrowRateRay(USDC_ID);
        uint256 uRay = rateModel.utilizationRay(USDC_ID);
        uint256 srate = rateModel.currentSupplyRateRay(USDC_ID);

        // supply = borrow × U × (1 - rf), using the contract's ray-scaled U
        uint256 expected = (brate * uRay * 9_000) / (RAY * 10_000);
        assertEq(srate, expected);
    }

    function test_supplyRate_zeroWhenNoBorrow() public {
        _setUtilization(1e18, 0);
        assertEq(rateModel.currentSupplyRateRay(USDC_ID), 0);
    }

    function test_utilizationRay_zeroOnEmptySupply() public {
        _setUtilization(0, 0);
        assertEq(rateModel.utilizationRay(USDC_ID), 0);
    }

    function test_accrue_growsIndices() public {
        _setUtilization(1e18, 8e17);

        IRateModel.AssetRateState memory before = rateModel.state(USDC_ID);
        vm.warp(block.timestamp + 30 days);
        rateModel.accrue(USDC_ID);
        IRateModel.AssetRateState memory afterState = rateModel.state(USDC_ID);

        assertGt(afterState.borrowIndex, before.borrowIndex, "borrowIndex grows");
        assertGt(afterState.supplyIndex, before.supplyIndex, "supplyIndex grows");
        assertGt(afterState.borrowIndex, afterState.supplyIndex, "borrow > supply");
    }

    // S14 §11 inv. 4: accrue is idempotent in-block
    function test_accrue_idempotentInBlock() public {
        _setUtilization(1e18, 8e17);
        vm.warp(block.timestamp + 1 days);

        rateModel.accrue(USDC_ID);
        IRateModel.AssetRateState memory after1 = rateModel.state(USDC_ID);
        rateModel.accrue(USDC_ID);
        IRateModel.AssetRateState memory after2 = rateModel.state(USDC_ID);

        assertEq(after1.borrowIndex, after2.borrowIndex);
        assertEq(after1.supplyIndex, after2.supplyIndex);
        assertEq(after1.lastAccrualTimestamp, after2.lastAccrualTimestamp);
    }

    // S14 §11 inv. 3: monotonicity over many sequential accruals
    function test_accrue_indicesMonotoneOverTime() public {
        _setUtilization(1e18, 8e17);

        uint128 lastBorrow = rateModel.state(USDC_ID).borrowIndex;
        uint128 lastSupply = rateModel.state(USDC_ID).supplyIndex;

        for (uint256 i = 0; i < 12; i++) {
            vm.warp(block.timestamp + 30 days);
            rateModel.accrue(USDC_ID);
            IRateModel.AssetRateState memory s = rateModel.state(USDC_ID);
            assertGe(s.borrowIndex, lastBorrow, "borrowIndex monotone");
            assertGe(s.supplyIndex, lastSupply, "supplyIndex monotone");
            lastBorrow = s.borrowIndex;
            lastSupply = s.supplyIndex;
        }
    }

    function testRevert_accrue_notInitialized() public {
        vm.expectRevert(abi.encodeWithSelector(RateModel.NotInitialized.selector, uint8(5)));
        rateModel.accrue(5);
    }

    function testRevert_initializeAsset_byNonManager() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        rateModel.initializeAsset(
            1,
            IRateModel.RateParams({
                uOptimalRay: uint128(8 * RAY / 10),
                slope1Ray: 0,
                slope2Ray: 0
            })
        );
    }

    function testRevert_initializeAsset_alreadyInitialized() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(RateModel.AlreadyInitialized.selector, USDC_ID));
        rateModel.initializeAsset(
            USDC_ID,
            IRateModel.RateParams({
                uOptimalRay: uint128(8 * RAY / 10),
                slope1Ray: 0,
                slope2Ray: 0
            })
        );
    }

    function testRevert_initializeAsset_notInRegistry() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(RateModel.AssetNotConfigured.selector, uint8(7)));
        rateModel.initializeAsset(
            7,
            IRateModel.RateParams({
                uOptimalRay: uint128(8 * RAY / 10),
                slope1Ray: 0,
                slope2Ray: 0
            })
        );
    }

    function testRevert_initializeAsset_uOptimalZero() public {
        // Need an asset configured in registry first
        IAssetRegistry.AssetConfig memory c = registry.assets(USDC_ID);
        c.token = address(0x5555);
        c.oracleFeed = address(0x6666);
        c.enabled = false;
        vm.prank(MANAGER);
        registry.enableAsset(1, c);

        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(RateModel.InvalidUOptimal.selector, uint128(0)));
        rateModel.initializeAsset(
            1,
            IRateModel.RateParams({uOptimalRay: 0, slope1Ray: 0, slope2Ray: 0})
        );
    }

    function testRevert_initializeAsset_uOptimalAtRay() public {
        IAssetRegistry.AssetConfig memory c = registry.assets(USDC_ID);
        c.token = address(0x5555);
        c.oracleFeed = address(0x6666);
        c.enabled = false;
        vm.prank(MANAGER);
        registry.enableAsset(1, c);

        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(RateModel.InvalidUOptimal.selector, uint128(RAY))
        );
        rateModel.initializeAsset(
            1,
            IRateModel.RateParams({
                uOptimalRay: uint128(RAY),
                slope1Ray: 0,
                slope2Ray: 0
            })
        );
    }

    function test_setRateParams_accruesFirst() public {
        _setUtilization(1e18, 8e17);
        vm.warp(block.timestamp + 10 days);

        IRateModel.AssetRateState memory before = rateModel.state(USDC_ID);

        vm.prank(MANAGER);
        rateModel.setRateParams(
            USDC_ID,
            IRateModel.RateParams({
                uOptimalRay: uint128(9 * RAY / 10),
                slope1Ray: uint128(2 * RAY / 100),
                slope2Ray: uint128(50 * RAY / 100)
            })
        );

        IRateModel.AssetRateState memory afterState = rateModel.state(USDC_ID);
        assertGt(afterState.borrowIndex, before.borrowIndex, "accrued before retune");
        assertEq(rateModel.params(USDC_ID).uOptimalRay, uint128(9 * RAY / 10));
    }

    function testRevert_setRateParams_notInitialized() public {
        vm.prank(MANAGER);
        vm.expectRevert(abi.encodeWithSelector(RateModel.NotInitialized.selector, uint8(9)));
        rateModel.setRateParams(
            9,
            IRateModel.RateParams({uOptimalRay: uint128(RAY / 2), slope1Ray: 0, slope2Ray: 0})
        );
    }

    function testRevert_setTotals_byNonPool() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        rateModel.setTotals(USDC_ID, 1, 1);
    }

    function testRevert_setTotals_notInitialized() public {
        vm.prank(POOL);
        vm.expectRevert(abi.encodeWithSelector(RateModel.NotInitialized.selector, uint8(3)));
        rateModel.setTotals(3, 1, 1);
    }

    function test_setAssetPaused_byGuardian() public {
        vm.prank(GUARDIAN);
        rateModel.setAssetPaused(USDC_ID, true);
        assertTrue(rateModel.state(USDC_ID).paused);
    }

    function testRevert_setAssetPaused_notInitialized() public {
        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(RateModel.NotInitialized.selector, uint8(8)));
        rateModel.setAssetPaused(8, true);
    }

    function test_pause_blocksAccrue() public {
        _setUtilization(1e18, 8e17);
        vm.warp(block.timestamp + 1 days);

        vm.prank(GUARDIAN);
        rateModel.pause();

        vm.expectRevert();
        rateModel.accrue(USDC_ID);

        vm.prank(ADMIN);
        rateModel.unpause();
        rateModel.accrue(USDC_ID);
    }

    function testRevert_constructor_zeroAdmin() public {
        vm.expectRevert(RateModel.ZeroAddress.selector);
        new RateModel(address(0), address(registry));
    }

    function testRevert_constructor_zeroRegistry() public {
        vm.expectRevert(RateModel.ZeroAddress.selector);
        new RateModel(ADMIN, address(0));
    }

    // I-SOLV-1 sanity: with reasonable params + 12 months at 80% U, borrow index
    // growth doesn't overflow uint128 (≈3.4e38 headroom is huge vs ~1e27 × 1.04 ≈ 1.04e27).
    function test_accrue_oneYear_noOverflow() public {
        _setUtilization(1e18, 8e17);
        vm.warp(block.timestamp + 365 days);
        rateModel.accrue(USDC_ID);
        IRateModel.AssetRateState memory s = rateModel.state(USDC_ID);
        assertGt(s.borrowIndex, RAY);
        assertGt(s.supplyIndex, RAY);
    }
}
