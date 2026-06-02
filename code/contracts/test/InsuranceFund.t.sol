// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {InsuranceFund} from "../src/InsuranceFund.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice subsystem_test.md Day-2 T-2.5 — InsuranceFund POOL_ROLE gating.
contract InsuranceFundTest is Test {
    AssetRegistry internal registry;
    InsuranceFund internal fund;
    MockERC20 internal usdc;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant POOL = address(0xC0DE);
    address internal constant OUTSIDER = address(0xDEAD);
    address internal constant LP = address(0x10AD);
    address internal constant RECIPIENT = address(0x9999);

    uint8 internal constant USDC_ID = 0;

    function setUp() public {
        registry = new AssetRegistry(ADMIN);
        fund = new InsuranceFund(ADMIN, address(registry));
        usdc = new MockERC20("USDC", "USDC", 6);

        vm.startPrank(ADMIN);
        registry.grantRole(registry.MANAGER_ROLE(), MANAGER);
        fund.grantRole(fund.POOL_ROLE(), POOL);
        vm.stopPrank();

        vm.prank(MANAGER);
        registry.enableAsset(USDC_ID, _config(address(usdc)));

        usdc.mint(LP, 10_000e6);
        vm.prank(LP);
        usdc.approve(address(fund), type(uint256).max);
    }

    function _config(address token) internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: token,
            oracleFeed: address(0xFEED),
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

    function test_deposit_increasesReserve() public {
        vm.prank(LP);
        fund.deposit(USDC_ID, 1_000e6);
        assertEq(fund.reserveOf(USDC_ID), 1_000e6);
        assertEq(usdc.balanceOf(address(fund)), 1_000e6);
    }

    function testRevert_deposit_zeroAmount() public {
        vm.prank(LP);
        vm.expectRevert(InsuranceFund.ZeroAmount.selector);
        fund.deposit(USDC_ID, 0);
    }

    function testRevert_deposit_unconfiguredAsset() public {
        vm.prank(LP);
        vm.expectRevert(abi.encodeWithSelector(InsuranceFund.AssetNotConfigured.selector, uint8(7)));
        fund.deposit(7, 100e6);
    }

    // T-2.5: only POOL_ROLE may call cover
    function test_cover_byPool_paysOut() public {
        vm.prank(LP);
        fund.deposit(USDC_ID, 1_000e6);

        vm.prank(POOL);
        fund.cover(USDC_ID, 250e6, RECIPIENT);

        assertEq(fund.reserveOf(USDC_ID), 750e6);
        assertEq(usdc.balanceOf(RECIPIENT), 250e6);
    }

    function testRevert_cover_byOutsider() public {
        vm.prank(LP);
        fund.deposit(USDC_ID, 1_000e6);
        vm.prank(OUTSIDER);
        vm.expectRevert();
        fund.cover(USDC_ID, 100e6, RECIPIENT);
    }

    function testRevert_cover_zeroRecipient() public {
        vm.prank(POOL);
        vm.expectRevert(InsuranceFund.ZeroAddress.selector);
        fund.cover(USDC_ID, 100e6, address(0));
    }

    function testRevert_cover_zeroAmount() public {
        vm.prank(POOL);
        vm.expectRevert(InsuranceFund.ZeroAmount.selector);
        fund.cover(USDC_ID, 0, RECIPIENT);
    }

    function testRevert_cover_unconfiguredAsset() public {
        vm.prank(POOL);
        vm.expectRevert(abi.encodeWithSelector(InsuranceFund.AssetNotConfigured.selector, uint8(7)));
        fund.cover(7, 100e6, RECIPIENT);
    }

    function testRevert_cover_insufficientReserve() public {
        vm.prank(LP);
        fund.deposit(USDC_ID, 100e6);
        vm.prank(POOL);
        vm.expectRevert(
            abi.encodeWithSelector(
                InsuranceFund.InsufficientReserve.selector, USDC_ID, uint256(200e6), uint256(100e6)
            )
        );
        fund.cover(USDC_ID, 200e6, RECIPIENT);
    }

    function test_pause_blocksCover() public {
        vm.prank(LP);
        fund.deposit(USDC_ID, 1_000e6);

        bytes32 guardianRole = fund.GUARDIAN_ROLE();
        vm.startPrank(ADMIN);
        fund.grantRole(guardianRole, ADMIN);
        fund.pause();
        vm.stopPrank();

        vm.prank(POOL);
        vm.expectRevert();
        fund.cover(USDC_ID, 100e6, RECIPIENT);

        vm.prank(ADMIN);
        fund.unpause();

        vm.prank(POOL);
        fund.cover(USDC_ID, 100e6, RECIPIENT);
        assertEq(fund.reserveOf(USDC_ID), 900e6);
    }

    function test_tokenOf_readsRegistry() public view {
        assertEq(fund.tokenOf(USDC_ID), address(usdc));
    }

    function testRevert_constructor_zeroAdmin() public {
        vm.expectRevert(InsuranceFund.ZeroAddress.selector);
        new InsuranceFund(address(0), address(registry));
    }

    function testRevert_constructor_zeroRegistry() public {
        vm.expectRevert(InsuranceFund.ZeroAddress.selector);
        new InsuranceFund(ADMIN, address(0));
    }
}
