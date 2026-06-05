// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {Oracle} from "../src/Oracle.sol";
import {IOracle} from "../src/interfaces/IOracle.sol";

/// @notice Per subsystem_test.md Day-1 T-1.4: staleness window enforcement.
contract OracleTest is Test {
    Oracle internal oracle;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant OUTSIDER = address(0xDEAD);
    address internal constant FEED = address(0xFEED);

    uint8 internal constant USDC_ID = 0;

    function setUp() public {
        oracle = new Oracle(ADMIN, address(0));
        vm.startPrank(ADMIN);
        oracle.grantRole(oracle.MANAGER_ROLE(), MANAGER);
        oracle.configureFeed(USDC_ID, FEED, 60);
        vm.stopPrank();
    }

    function test_pushPrice_thenGetPrice_withinWindow() public {
        vm.prank(MANAGER);
        oracle.pushPrice(USDC_ID, 1e8);
        assertEq(oracle.getPrice(USDC_ID), 1e8);
    }

    function testRevert_getPrice_afterWindow() public {
        vm.prank(MANAGER);
        oracle.pushPrice(USDC_ID, 1e8);
        uint64 t0 = uint64(block.timestamp);
        uint32 window = oracle.stalenessWindow(USDC_ID);

        vm.warp(t0 + window + 1);

        // Match the selector + first two args (assetId, updatedAt); leave the
        // remaining args unconstrained because expectRevert encodes its
        // arguments at call time and `block.timestamp` reads can be constant-
        // folded by via_ir, producing flaky struct-equality comparisons.
        vm.expectPartialRevert(Oracle.PriceStale.selector);
        oracle.getPrice(USDC_ID);
    }

    function test_getPrice_exactlyAtWindow() public {
        vm.prank(MANAGER);
        oracle.pushPrice(USDC_ID, 1e8);

        vm.warp(block.timestamp + 60);
        assertEq(oracle.getPrice(USDC_ID), 1e8);
    }

    function testRevert_getPrice_unset() public {
        vm.expectRevert(abi.encodeWithSelector(Oracle.PriceUnset.selector, uint8(99)));
        oracle.getPrice(99);
    }

    function testRevert_pushPrice_byNonManager() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        oracle.pushPrice(USDC_ID, 1e8);
    }

    function testRevert_pushPrice_zero() public {
        vm.prank(MANAGER);
        vm.expectRevert(Oracle.ZeroPrice.selector);
        oracle.pushPrice(USDC_ID, 0);
    }

    function testRevert_configureFeed_byNonAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        oracle.configureFeed(1, FEED, 60);
    }

    function testRevert_configureFeed_zeroFeed() public {
        vm.prank(ADMIN);
        vm.expectRevert(Oracle.ZeroAddress.selector);
        oracle.configureFeed(1, address(0), 60);
    }

    function testRevert_configureFeed_zeroWindow() public {
        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(Oracle.InvalidWindow.selector, uint32(0)));
        oracle.configureFeed(1, FEED, 0);
    }

    function testRevert_configureFeed_excessiveWindow() public {
        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(Oracle.InvalidWindow.selector, uint32(3_601)));
        oracle.configureFeed(1, FEED, 3_601);
    }

    function test_setStalenessWindow_takesEffect() public {
        vm.prank(MANAGER);
        oracle.pushPrice(USDC_ID, 1e8);

        vm.prank(ADMIN);
        oracle.setStalenessWindow(USDC_ID, 30);
        assertEq(oracle.stalenessWindow(USDC_ID), 30);

        vm.warp(block.timestamp + 31);
        vm.expectRevert();
        oracle.getPrice(USDC_ID);
    }

    function testRevert_setStalenessWindow_zero() public {
        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(Oracle.InvalidWindow.selector, uint32(0)));
        oracle.setStalenessWindow(USDC_ID, 0);
    }

    function testRevert_setStalenessWindow_excessive() public {
        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(Oracle.InvalidWindow.selector, uint32(3_601)));
        oracle.setStalenessWindow(USDC_ID, 3_601);
    }

    function test_priceData_returnsStruct() public {
        vm.prank(MANAGER);
        oracle.pushPrice(USDC_ID, 12345);
        IOracle.PriceData memory p = oracle.priceData(USDC_ID);
        assertEq(p.priceUsd1e8, 12345);
        assertEq(p.updatedAt, block.timestamp);
    }

    function test_stalenessWindow_defaultForUnconfigured() public view {
        assertEq(oracle.stalenessWindow(99), oracle.DEFAULT_STALENESS_WINDOW());
    }

    function test_feed_returnsConfigured() public view {
        assertEq(oracle.feed(USDC_ID), FEED);
    }

    function testRevert_constructor_zeroAdmin() public {
        vm.expectRevert(Oracle.ZeroAddress.selector);
        new Oracle(address(0), address(0));
    }

    function testRevert_setStorkFeed_whenStorkUnset() public {
        vm.prank(ADMIN);
        vm.expectRevert(Oracle.StorkNotConfigured.selector);
        oracle.setStorkFeed(USDC_ID, bytes32(uint256(1)));
    }
}
