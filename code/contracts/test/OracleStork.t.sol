// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {Oracle} from "../src/Oracle.sol";
import {IOracle} from "../src/interfaces/IOracle.sol";
import {IStork} from "../src/interfaces/external/IStork.sol";

contract MockStork {
    mapping(bytes32 => IStork.TemporalNumericValue) public values;

    function set(bytes32 id, uint64 timestampNs, int192 quantizedValue) external {
        values[id] = IStork.TemporalNumericValue({
            timestampNs: timestampNs,
            quantizedValue: quantizedValue
        });
    }

    function getTemporalNumericValueUnsafeV1(bytes32 id)
        external
        view
        returns (IStork.TemporalNumericValue memory)
    {
        return values[id];
    }
}

/// @notice Day-9 T-9.1: Oracle reads from Stork when a feed id is configured,
///         scales the 1e18 quantization back to 1e8, and enforces staleness.
contract OracleStorkTest is Test {
    Oracle internal oracle;
    MockStork internal stork;

    address internal constant ADMIN = address(0xA11CE);

    uint8 internal constant CBBTC_ID = 1;
    bytes32 internal constant BTCUSD_FEED_ID =
        keccak256(bytes("BTCUSD"));

    function setUp() public {
        stork = new MockStork();
        oracle = new Oracle(ADMIN, address(stork));
        vm.startPrank(ADMIN);
        oracle.configureFeed(CBBTC_ID, address(stork), 600);
        oracle.setStorkFeed(CBBTC_ID, BTCUSD_FEED_ID);
        vm.stopPrank();
    }

    function test_getPrice_readsFromStork_andScalesToE8() public {
        // $60,000.50 → 60000.5 * 1e18 quantization → 6.00005e22
        int192 quantized = int192(60_000_500_000_000_000_000_000); // 60_000.5 * 1e18
        stork.set(
            BTCUSD_FEED_ID,
            uint64(block.timestamp) * 1_000_000_000,
            quantized
        );

        // Expected = 60_000.5 * 1e8 = 6_000_050_000_000
        assertEq(oracle.getPrice(CBBTC_ID), uint128(6_000_050_000_000));
    }

    function test_priceData_reportsStorkValue() public {
        // $1000 → 1000 * 1e18 = 1e21
        int192 quantized = int192(1_000_000_000_000_000_000_000); // 1000 * 1e18
        uint64 ts = uint64(block.timestamp);
        stork.set(BTCUSD_FEED_ID, ts * 1_000_000_000, quantized);

        IOracle.PriceData memory p = oracle.priceData(CBBTC_ID);
        assertEq(p.priceUsd1e8, uint128(100_000_000_000)); // 1000 * 1e8
        assertEq(p.updatedAt, ts);
    }

    function testRevert_getPrice_storkValueZero() public {
        stork.set(BTCUSD_FEED_ID, uint64(block.timestamp) * 1_000_000_000, 0);
        vm.expectPartialRevert(Oracle.StorkValueNonPositive.selector);
        oracle.getPrice(CBBTC_ID);
    }

    function testRevert_getPrice_storkStale() public {
        uint64 t0 = uint64(block.timestamp);
        stork.set(BTCUSD_FEED_ID, t0 * 1_000_000_000, int192(60_000e18));

        // Advance past the window (default = 60, but we configured 600 above).
        vm.warp(t0 + 600 + 1);
        vm.expectPartialRevert(Oracle.PriceStale.selector);
        oracle.getPrice(CBBTC_ID);
    }

    function test_setStorkFeed_zero_revertsToPushPath() public {
        // Set then unset the feed; getPrice should fall back to push path
        // and revert with PriceUnset because nothing was pushed.
        vm.startPrank(ADMIN);
        oracle.setStorkFeed(CBBTC_ID, bytes32(0));
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(Oracle.PriceUnset.selector, CBBTC_ID));
        oracle.getPrice(CBBTC_ID);
    }
}
