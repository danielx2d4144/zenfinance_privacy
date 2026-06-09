// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test, Vm} from "forge-std/Test.sol";

import {AssetRegistry} from "../src/AssetRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {RateModel} from "../src/RateModel.sol";
import {IRateModel} from "../src/interfaces/IRateModel.sol";
import {Oracle} from "../src/Oracle.sol";
import {PrivacyEntry} from "../src/PrivacyEntry.sol";
import {ZkVerifier} from "../src/ZkVerifier.sol";
import {IZkVerifier} from "../src/interfaces/IZkVerifier.sol";
import {InsuranceFund} from "../src/InsuranceFund.sol";
import {ShieldedSupplyPool} from "../src/ShieldedSupplyPool.sol";
import {IShieldedSupplyPool} from "../src/interfaces/IShieldedSupplyPool.sol";
import {ShieldedPositionPool} from "../src/ShieldedPositionPool.sol";
import {LiquidationBoard} from "../src/LiquidationBoard.sol";
import {ILiquidationBoard} from "../src/interfaces/ILiquidationBoard.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVerifyProofAggregation} from "./mocks/MockVerifyProofAggregation.sol";

/// @notice Shared deployment harness for the Day-3 pool contracts. Sets up
///         AssetRegistry + RateModel + Oracle + PrivacyEntry + ZkVerifier +
///         InsuranceFund + the three Day-3 pools and wires roles between
///         them. Used by ShieldedPoolsTest and Invariant_Solv.
abstract contract PoolDeployment is Test {
    AssetRegistry internal registry;
    RateModel internal rateModel;
    Oracle internal oracle;
    PrivacyEntry internal entry;
    ZkVerifier internal zk;
    MockVerifyProofAggregation internal proxy;
    InsuranceFund internal fund;
    ShieldedSupplyPool internal supplyPool;
    ShieldedPositionPool internal positionPool;
    LiquidationBoard internal board;

    MockERC20 internal usdc;
    MockERC20 internal cbBtc;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant POOL_KEEPER = address(0xC0DE);
    address internal constant GUARDIAN = address(0xBADD);
    address internal constant LIQUIDATOR = address(0x10AD);
    address internal constant LP = address(0x5EED);
    address internal constant USER = address(0xF00D);
    address internal constant RECIPIENT = address(0x9999);

    /// BN254 Fr prime: Stage-A Poseidon2 rejects inputs >= PRIME, so
    /// test commitments built from keccak("...") must be reduced into Field.
    uint256 internal constant PRIME =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    /// Depth-20 empty Poseidon2 IMT root (pinned in
    /// `code/contracts/test/libraries/PoseidonIMT.t.sol` against Noir).
    bytes32 internal constant EMPTY_IMT_ROOT =
        0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755;

    /// Field-reduced commitment helper. Real production commitments come
    /// from in-circuit hashing and are already < PRIME; tests mirror that.
    function _c(string memory s) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(bytes(s))) % PRIME);
    }
    /// Bytes-input variant for `abi.encodePacked(...)` sites; renamed
    /// (vs an overload) to keep Solidity's string-literal overload
    /// resolution unambiguous.
    function _ce(bytes memory b) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(b)) % PRIME);
    }

    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;
    uint256 internal constant RAY = 1e27;

    bytes32[] internal _vks;

    function _deployAll() internal {
        // Asset registry + manager role
        registry = new AssetRegistry(ADMIN);
        bytes32 mgrRole = registry.MANAGER_ROLE();
        vm.prank(ADMIN);
        registry.grantRole(mgrRole, MANAGER);

        // Tokens
        usdc = new MockERC20("USDC", "USDC", 6);
        cbBtc = new MockERC20("cbBTC", "cbBTC", 8);

        // Asset configs
        IAssetRegistry.AssetConfig memory usdcCfg = _cfg(address(usdc), 6, 7_500, 8_000, 500, 3_000, 1_000);
        IAssetRegistry.AssetConfig memory cbBtcCfg = _cfg(address(cbBtc), 8, 6_500, 7_500, 800, 3_750, 2_000);
        vm.startPrank(MANAGER);
        registry.enableAsset(USDC_ID, usdcCfg);
        registry.enableAsset(CBBTC_ID, cbBtcCfg);
        vm.stopPrank();

        // Oracle
        oracle = new Oracle(ADMIN, address(0));
        bytes32 oracleMgr = oracle.MANAGER_ROLE();
        vm.startPrank(ADMIN);
        oracle.grantRole(oracleMgr, MANAGER);
        oracle.configureFeed(USDC_ID, address(0xFEED), 600);
        oracle.configureFeed(CBBTC_ID, address(0xFEED), 600);
        vm.stopPrank();
        vm.startPrank(MANAGER);
        oracle.pushPrice(USDC_ID, 1e8); // $1
        oracle.pushPrice(CBBTC_ID, 60_000e8); // $60,000
        vm.stopPrank();

        // RateModel
        rateModel = new RateModel(ADMIN, address(registry));
        bytes32 rmMgr = rateModel.MANAGER_ROLE();
        vm.prank(ADMIN);
        rateModel.grantRole(rmMgr, MANAGER);
        IRateModel.RateParams memory rp = IRateModel.RateParams({
            uOptimalRay: uint128(8 * RAY / 10),
            slope1Ray: uint128(4 * RAY / 100),
            slope2Ray: uint128(75 * RAY / 100)
        });
        vm.startPrank(MANAGER);
        rateModel.initializeAsset(USDC_ID, rp);
        rateModel.initializeAsset(CBBTC_ID, rp);
        vm.stopPrank();

        // ZkVerifier (mock proxy, vkHashes seeded per-circuit)
        proxy = new MockVerifyProofAggregation();
        _vks = new bytes32[](11);
        for (uint256 i = 0; i < 11; ++i) {
            _vks[i] = _ce(abi.encodePacked("vk-", i));
        }
        zk = new ZkVerifier(ADMIN, address(proxy), _vks);

        // PrivacyEntry
        entry = new PrivacyEntry(ADMIN, address(zk));
        bytes32 callerRole = zk.CALLER_ROLE();
        vm.prank(ADMIN);
        zk.grantRole(callerRole, address(entry));

        // InsuranceFund
        fund = new InsuranceFund(ADMIN, address(registry));

        // Day-3 pools
        supplyPool = new ShieldedSupplyPool(
            ADMIN, address(registry), address(rateModel), address(entry), address(zk)
        );
        positionPool = new ShieldedPositionPool(
            ADMIN, address(registry), address(rateModel), address(entry), address(zk)
        );
        board = new LiquidationBoard(
            ADMIN,
            address(registry),
            address(oracle),
            address(entry),
            address(positionPool),
            address(fund),
            address(zk)
        );

        // Role wiring (Day-3 done-criterion: POOL_ROLE on PrivacyEntry)
        bytes32 entryPool = entry.POOL_ROLE();
        bytes32 rmPool = rateModel.POOL_ROLE();
        bytes32 fundPool = fund.POOL_ROLE();
        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        bytes32 boardRegistrar = board.REGISTRAR_ROLE();
        bytes32 zkCaller = zk.CALLER_ROLE();

        vm.startPrank(ADMIN);
        entry.grantRole(entryPool, address(supplyPool));
        entry.grantRole(entryPool, address(positionPool));
        entry.grantRole(entryPool, address(board));
        rateModel.grantRole(rmPool, address(supplyPool));
        rateModel.grantRole(rmPool, address(positionPool));
        fund.grantRole(fundPool, address(board));
        positionPool.grantRole(liqRole, address(board));
        board.grantRole(boardRegistrar, POOL_KEEPER);
        zk.grantRole(zkCaller, address(supplyPool));
        zk.grantRole(zkCaller, address(positionPool));
        zk.grantRole(zkCaller, address(board));
        vm.stopPrank();

        // Fund users
        usdc.mint(USER, 1_000_000e6);
        usdc.mint(LP, 1_000_000e6);
        cbBtc.mint(USER, 100e8);
        vm.prank(USER);
        usdc.approve(address(entry), type(uint256).max);
        vm.prank(USER);
        cbBtc.approve(address(entry), type(uint256).max);
        vm.prank(LP);
        usdc.approve(address(entry), type(uint256).max);
        vm.prank(LP);
        usdc.approve(address(fund), type(uint256).max);
    }

    function _cfg(
        address token,
        uint8 decimals,
        uint16 ltv,
        uint16 lt,
        uint16 bonus,
        uint16 feeOfBonus,
        uint16 rf
    ) internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: token,
            oracleFeed: address(0xFEED),
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
            enabled: false
        });
    }

    function _proof(uint256 domainId, uint256 aggId, uint256 leafIndex)
        internal
        pure
        returns (IZkVerifier.AggregationProof memory)
    {
        return IZkVerifier.AggregationProof({
            domainId: domainId,
            aggregationId: aggId,
            leaf: _ce(abi.encodePacked("leaf", domainId, aggId, leafIndex)),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: leafIndex
        });
    }
}

/// @notice subsystem_test.md Day-3 unit tests T-3.1 .. T-3.4.
contract ShieldedPoolsTest is PoolDeployment {
    function setUp() public {
        _deployAll();
    }

    // ────────────── T-3.1: supply increases custody + supplyIndex updates ──────────────
    function test_T31_supply_increasesCustodyAndAggregates() public {
        // Seed user with a balance commitment in PrivacyEntry (one-shot deposit).
        bytes32 cBal = _c("user-balance-1");
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, cBal);

        // Mock the supply proof tuple as accepted by the proxy.
        proxy.setAllowed(1, 10, 0, true);

        bytes32 balNul = _c("bal-nul-1");
        bytes32 residual = _c("residual-1");
        bytes32 supplyC = _c("supply-commit-1");

        uint256 prevCustody = entry.reserves(address(usdc));
        uint256 prevTotal = supplyPool.totalSupplyPerAsset(USDC_ID);

        vm.prank(USER);
        supplyPool.supplyAsset(USDC_ID, balNul, residual, supplyC, 5_000e6, _proof(1, 10, 0));

        // T-3.1 observations:
        // - PrivacyEntry custody unchanged (tokens stay in custody; only commitments change)
        // - totalSupplyPerAsset increases by amount
        // - RateModel.setTotals was called (state.totalSupply reflects new total)
        assertEq(entry.reserves(address(usdc)), prevCustody, "custody unchanged");
        assertEq(supplyPool.totalSupplyPerAsset(USDC_ID), prevTotal + 5_000e6);
        IRateModel.AssetRateState memory s = rateModel.state(USDC_ID);
        assertEq(s.totalSupply, 5_000e6, "rateModel totals synced");
        assertTrue(entry.isSpent(balNul), "balance nullifier marked spent");
        assertTrue(supplyPool.knownRoot(supplyPool.currentRoot()), "supply tree root recorded");
    }

    function test_supply_emitsEvents() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("e1"));
        proxy.setAllowed(1, 11, 0, true);

        vm.expectEmit(true, false, false, true);
        emit IShieldedSupplyPool.SupplyDeposited(USDC_ID, 0, _c("sc"), 1_000e6);

        vm.prank(USER);
        supplyPool.supplyAsset(
            USDC_ID, _c("n"), _c("r"), _c("sc"), 1_000e6, _proof(1, 11, 0)
        );
    }

    function testRevert_supply_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedSupplyPool.ZeroAmount.selector);
        supplyPool.supplyAsset(
            USDC_ID, bytes32(0), bytes32(0), _c("sc"), 0, _proof(1, 12, 0)
        );
    }

    function testRevert_supply_unknownAsset() public {
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(ShieldedSupplyPool.AssetNotEnabled.selector, uint8(99)));
        supplyPool.supplyAsset(
            99, _c("n"), _c("r"), _c("sc"), 1, _proof(1, 13, 0)
        );
    }

    function testRevert_supply_proofRejected() public {
        // No proxy allowlist → ZkVerifier reverts → supply reverts.
        vm.prank(USER);
        vm.expectRevert();
        supplyPool.supplyAsset(
            USDC_ID, _c("n"), _c("r"), _c("sc"), 1, _proof(1, 14, 0)
        );
    }

    function test_withdrawSupply_marksNullifierAndCreditsBalance() public {
        // First supply so we have something to withdraw.
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("e2"));
        proxy.setAllowed(1, 20, 0, true);
        vm.prank(USER);
        supplyPool.supplyAsset(
            USDC_ID, _c("n2"), _c("r2"), _c("sc2"), 1_000e6, _proof(1, 20, 0)
        );
        bytes32 supplyRoot = supplyPool.currentRoot();

        proxy.setAllowed(1, 21, 0, true);
        vm.prank(USER);
        supplyPool.withdrawSupply(
            USDC_ID,
            _c("supply-nul"),
            _c("new-balance"),
            500e6,
            supplyRoot,
            _proof(1, 21, 0)
        );

        assertTrue(supplyPool.isSpent(_c("supply-nul")));
        assertEq(supplyPool.totalSupplyPerAsset(USDC_ID), 500e6);
    }

    function testRevert_withdrawSupply_unknownRoot() public {
        proxy.setAllowed(1, 22, 0, true);
        vm.prank(USER);
        vm.expectRevert(ShieldedSupplyPool.UnknownRoot.selector);
        supplyPool.withdrawSupply(
            USDC_ID,
            _c("snul"),
            _c("nb"),
            1,
            _c("not-a-root"),
            _proof(1, 22, 0)
        );
    }

    // ────────────── T-3.2: borrow with HF<1 reverts (proof rejected) ──────────────
    function test_T32_borrow_rejectedWhenProofInvalid() public {
        // Build the position with collateral first so the borrow has something to consume.
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("eC"));
        proxy.setAllowed(1, 30, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("bnul"),
            _c("residual"),
            bytes32(0),
            _c("pos-1"),
            1_000e6,
            bytes32(0),
            _proof(1, 30, 0)
        );
        bytes32 posRoot = positionPool.currentRoot();

        // Now attempt an over-LTV borrow. The circuit's HF check would
        // refuse to produce a valid proof for this; we simulate by leaving
        // the proxy disallowed for the borrow tuple. ZkVerifier reverts.
        vm.prank(USER);
        vm.expectRevert();
        positionPool.borrow(
            USDC_ID,
            _c("pos-1-nul"),
            _c("new-pos"),
            _c("new-bal"),
            8_000e6, // over-LTV
            posRoot,
            _proof(1, 31, 0)
        );
    }

    function test_borrow_happyPath_creditsBalanceAndBumpsTotals() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("eD"));
        proxy.setAllowed(1, 40, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("bnul-D"),
            _c("res-D"),
            bytes32(0),
            _c("pos-D"),
            5_000e6,
            bytes32(0),
            _proof(1, 40, 0)
        );
        bytes32 posRoot = positionPool.currentRoot();

        proxy.setAllowed(1, 41, 0, true);
        vm.prank(USER);
        positionPool.borrow(
            USDC_ID,
            _c("pos-D-nul"),
            _c("pos-D2"),
            _c("bal-D2"),
            1_000e6,
            posRoot,
            _proof(1, 41, 0)
        );

        assertEq(positionPool.totalBorrowPerAsset(USDC_ID), 1_000e6);
        IRateModel.AssetRateState memory s = rateModel.state(USDC_ID);
        assertEq(s.totalBorrow, 1_000e6, "rateModel borrow synced");
    }

    function test_repay_reducesTotalBorrow() public {
        // setup: collateral + borrow
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("eE"));
        proxy.setAllowed(1, 50, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("bnul-E"),
            _c("res-E"),
            bytes32(0),
            _c("pos-E"),
            5_000e6,
            bytes32(0),
            _proof(1, 50, 0)
        );
        bytes32 root1 = positionPool.currentRoot();
        proxy.setAllowed(1, 51, 0, true);
        vm.prank(USER);
        positionPool.borrow(
            USDC_ID,
            _c("pos-E-nul"),
            _c("pos-E2"),
            _c("bal-E2"),
            1_000e6,
            root1,
            _proof(1, 51, 0)
        );
        bytes32 root2 = positionPool.currentRoot();

        // Repay 300
        proxy.setAllowed(1, 52, 0, true);
        vm.prank(USER);
        positionPool.repay(
            USDC_ID,
            _c("repay-bal-nul"),
            _c("repay-res"),
            _c("pos-E2-nul"),
            _c("pos-E3"),
            300e6,
            root2,
            _proof(1, 52, 0)
        );
        assertEq(positionPool.totalBorrowPerAsset(USDC_ID), 700e6);
    }

    // ────────────── T-3.3 + T-3.4: liquidation close factor + bonus split ──────────────
    function test_T33_closeFactor_aboveThreshold_is50pct() public view {
        // HF = 0.96 > 0.95 threshold (cbBTC asset) → 50% close factor.
        uint16 cf = board.closeFactorBpsFor(CBBTC_ID, 9_600);
        assertEq(cf, board.DEFAULT_CLOSE_FACTOR_BPS());
    }

    function test_T33_closeFactor_belowThreshold_is100pct() public view {
        // HF = 0.94 < 0.95 → 100% close factor.
        uint16 cf = board.closeFactorBpsFor(CBBTC_ID, 9_400);
        assertEq(cf, board.FULL_CLOSE_FACTOR_BPS());
    }

    /// @dev T-3.4: liquidate $100 (= 100 USDC) debt at 8% bonus (cbBTC config).
    ///      protocolFeeOfBonusBps = 3750 (37.5% of bonus → InsuranceFund).
    ///      Expected (USD-denominated, 1e8 scale):
    ///        bonusValue = 100 × 8% = $8 (8e8 in USD-1e8 scale)
    ///        InsuranceFund share = 8 × 37.5% = $3 (3e8)
    ///        Liquidator share    = $5 (5e8)
    function test_T34_liquidationBonusSplit_5_3() public {
        // Pre-seed PrivacyEntry custody with enough cbBTC to cover the
        // collateral seizure + InsuranceFund payout. The custody must hold
        // the underlying collateral the liquidator will receive plus the
        // protocol's bonus share.
        usdc.mint(USER, 10_000e6); // already minted in setUp, top up anyway
        // We use cbBTC as collateral here to match the 8% bonus param.
        vm.prank(USER);
        entry.deposit(address(cbBtc), 1e8, _c("entry-cbtc")); // 1 cbBTC = $60k

        // Register a fake position so liquidate can target it.
        bytes32 target = _c("victim-position");
        ILiquidationBoard.LiquidationTrigger[] memory triggers =
            new ILiquidationBoard.LiquidationTrigger[](1);
        triggers[0] = ILiquidationBoard.LiquidationTrigger({
            assetId: CBBTC_ID,
            priceThresholdUsd1e8: 50_000e8
        });
        vm.prank(POOL_KEEPER);
        board.registerPosition(target, triggers);

        // HF = 0.96 → 50% close factor (we won't hit that cap in this test
        // because debtToCover is small relative to position).
        // Allow the liquidate proof tuple.
        proxy.setAllowed(1, 99, 0, true);

        // debtToCover = 100 USDC ($100 at $1/USDC).
        ILiquidationBoard.LiquidationTrigger[] memory newTriggers =
            new ILiquidationBoard.LiquidationTrigger[](0);

        uint256 fundReserveBefore = fund.reserveOf(CBBTC_ID);

        vm.recordLogs();
        vm.prank(LIQUIDATOR);
        board.liquidate(
            target,
            _c("residual-victim"),
            _c("liquidator-bal"),
            CBBTC_ID,
            USDC_ID,
            100e6, // 100 USDC debt
            9_600, // HF = 0.96 → 50% close factor
            newTriggers,
            _proof(1, 99, 0)
        );

        // Decode the PositionLiquidated event:
        //   bonus = $100 × 8% = $8 (= 8e8 in 1e8 scale)
        //   insurance share = 8 × 37.5% = $3 (= 3e8)
        //   liquidator bonus = $5 (= 5e8)
        // Find the event in the log.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256(
            "PositionLiquidated(bytes32,address,uint8,uint8,uint256,uint256,uint256,uint256)"
        );
        bool found;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == sig) {
                (
                    , // collateralAssetSeized (uint8)
                    , // debtAssetRepaid (uint8)
                    , // collateralSeized (uint256)
                    , // debtCovered (uint256)
                    uint256 liqBonus,
                    uint256 insShare
                ) = abi.decode(
                    logs[i].data, (uint8, uint8, uint256, uint256, uint256, uint256)
                );
                assertEq(insShare, 3e8, "insurance bonus share = $3 in USD-1e8");
                assertEq(liqBonus, 5e8, "liquidator bonus = $5 in USD-1e8");
                found = true;
                break;
            }
        }
        assertTrue(found, "PositionLiquidated emitted");

        // InsuranceFund actually received tokens.
        assertGt(fund.reserveOf(CBBTC_ID), fundReserveBefore, "fund balance increased");
    }

    function testRevert_liquidate_unknownPosition() public {
        ILiquidationBoard.LiquidationTrigger[] memory none =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.prank(LIQUIDATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidationBoard.UnknownPosition.selector, _c("ghost")
            )
        );
        board.liquidate(
            _c("ghost"),
            _c("r"),
            _c("lb"),
            CBBTC_ID,
            USDC_ID,
            1,
            9_600,
            none,
            _proof(1, 100, 0)
        );
    }

    function testRevert_liquidate_zeroDebtToCover() public {
        bytes32 target = _c("target-2");
        ILiquidationBoard.LiquidationTrigger[] memory triggers =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.prank(POOL_KEEPER);
        board.registerPosition(target, triggers);

        vm.prank(LIQUIDATOR);
        vm.expectRevert(LiquidationBoard.ZeroAmount.selector);
        board.liquidate(
            target,
            _c("r"),
            _c("lb"),
            CBBTC_ID,
            USDC_ID,
            0,
            9_600,
            triggers,
            _proof(1, 101, 0)
        );
    }

    function testRevert_liquidate_invalidHF() public {
        bytes32 target = _c("target-3");
        ILiquidationBoard.LiquidationTrigger[] memory triggers =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.prank(POOL_KEEPER);
        board.registerPosition(target, triggers);

        vm.prank(LIQUIDATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidationBoard.InvalidHealthFactor.selector, uint16(10_000))
        );
        board.liquidate(
            target,
            _c("r"),
            _c("lb"),
            CBBTC_ID,
            USDC_ID,
            1,
            10_000, // HF = 1.0 not liquidatable
            triggers,
            _proof(1, 102, 0)
        );
    }

    function testRevert_liquidate_inactivePosition() public {
        bytes32 target = _c("target-4");
        ILiquidationBoard.LiquidationTrigger[] memory triggers =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.startPrank(POOL_KEEPER);
        board.registerPosition(target, triggers);
        board.removePosition(target);
        vm.stopPrank();

        vm.prank(LIQUIDATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidationBoard.PositionInactive.selector, target)
        );
        board.liquidate(
            target,
            _c("r"),
            _c("lb"),
            CBBTC_ID,
            USDC_ID,
            1,
            9_600,
            triggers,
            _proof(1, 103, 0)
        );
    }

    function testRevert_registerPosition_byOutsider() public {
        ILiquidationBoard.LiquidationTrigger[] memory none =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.expectRevert();
        board.registerPosition(_c("x"), none);
    }

    function test_pause_blocksSupply() public {
        bytes32 guardian = supplyPool.GUARDIAN_ROLE();
        vm.prank(ADMIN);
        supplyPool.grantRole(guardian, GUARDIAN);
        vm.prank(GUARDIAN);
        supplyPool.pause();

        vm.prank(USER);
        vm.expectRevert();
        supplyPool.supplyAsset(
            USDC_ID, _c("n"), _c("r"), _c("sc"), 1, _proof(1, 200, 0)
        );
    }

    function testRevert_applyLiquidation_byOutsider() public {
        vm.expectRevert();
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, _c("n"), _c("c"), 1, 1
        );
    }

    // ────────────── Coverage-fill: revert paths + secondary flows ──────────────

    function testRevert_supply_zeroSupplyCommitment() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedSupplyPool.ZeroAmount.selector);
        supplyPool.supplyAsset(
            USDC_ID, _c("n"), _c("r"), bytes32(0), 100, _proof(1, 300, 0)
        );
    }

    function testRevert_supply_nonSuppliableAsset() public {
        // Disable suppliable on USDC
        IAssetRegistry.AssetConfig memory cfg = registry.assets(USDC_ID);
        cfg.suppliable = false;
        vm.prank(MANAGER);
        registry.updateAssetConfig(USDC_ID, cfg);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedSupplyPool.AssetNotSuppliable.selector, USDC_ID)
        );
        supplyPool.supplyAsset(
            USDC_ID, _c("n"), _c("r"), _c("sc"), 100, _proof(1, 301, 0)
        );
    }

    function testRevert_supply_nullifierAlreadySpent() public {
        // Seed
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("seed-S"));
        proxy.setAllowed(1, 302, 0, true);
        bytes32 dup = _c("dup-nul");
        vm.prank(USER);
        supplyPool.supplyAsset(
            USDC_ID, dup, _c("rA"), _c("sA"), 100e6, _proof(1, 302, 0)
        );

        // Replay — PrivacyEntry's spendBalance rejects since it owns the
        // balance-nullifier set.
        proxy.setAllowed(1, 303, 0, true);
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(PrivacyEntry.NullifierAlreadySpent.selector, dup)
        );
        supplyPool.supplyAsset(
            USDC_ID, dup, _c("rB"), _c("sB"), 100e6, _proof(1, 303, 0)
        );
    }

    function testRevert_withdrawSupply_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedSupplyPool.ZeroAmount.selector);
        supplyPool.withdrawSupply(
            USDC_ID, _c("n"), _c("c"), 0, bytes32(0), _proof(1, 304, 0)
        );
    }

    function testRevert_withdrawSupply_zeroCommitment() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedSupplyPool.ZeroAmount.selector);
        supplyPool.withdrawSupply(
            USDC_ID, _c("n"), bytes32(0), 1, bytes32(0), _proof(1, 305, 0)
        );
    }

    function testRevert_withdrawSupply_assetDisabled() public {
        // Build a known root first so we don't hit UnknownRoot before AssetNotEnabled.
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("seed-WD"));
        proxy.setAllowed(1, 306, 0, true);
        vm.prank(USER);
        supplyPool.supplyAsset(
            USDC_ID, _c("nWD"), _c("rWD"), _c("sWD"), 1_000e6, _proof(1, 306, 0)
        );

        // Disable
        vm.prank(MANAGER);
        registry.disableAsset(USDC_ID);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedSupplyPool.AssetNotEnabled.selector, USDC_ID)
        );
        supplyPool.withdrawSupply(
            USDC_ID, _c("nWD2"), _c("nbWD"), 1, bytes32(0), _proof(1, 307, 0)
        );

        // Re-enable for following tests
        vm.prank(MANAGER);
        registry.reenableAsset(USDC_ID);
    }

    function test_withdrawCollateral_happyPath() public {
        // Open a position with collateral
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("e-wc"));
        proxy.setAllowed(1, 400, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("bnul-wc"),
            _c("res-wc"),
            bytes32(0),
            _c("pos-wc"),
            5_000e6,
            bytes32(0),
            _proof(1, 400, 0)
        );
        bytes32 root = positionPool.currentRoot();

        proxy.setAllowed(1, 401, 0, true);
        vm.prank(USER);
        positionPool.withdrawCollateral(
            USDC_ID,
            _c("pos-wc-nul"),
            _c("pos-wc-2"),
            _c("bal-wc-2"),
            1_000e6,
            root,
            _proof(1, 401, 0)
        );
        assertEq(positionPool.totalCollateralPerAsset(USDC_ID), 4_000e6);
    }

    function testRevert_depositCollateral_assetNotCollateralizable() public {
        IAssetRegistry.AssetConfig memory cfg = registry.assets(USDC_ID);
        cfg.collateralizable = false;
        vm.prank(MANAGER);
        registry.updateAssetConfig(USDC_ID, cfg);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPositionPool.AssetNotCollateralizable.selector, USDC_ID
            )
        );
        positionPool.depositCollateral(
            USDC_ID,
            _c("n"),
            _c("r"),
            bytes32(0),
            _c("c"),
            1,
            bytes32(0),
            _proof(1, 500, 0)
        );
    }

    function testRevert_depositCollateral_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.depositCollateral(
            USDC_ID,
            _c("n"),
            _c("r"),
            bytes32(0),
            _c("c"),
            0,
            bytes32(0),
            _proof(1, 501, 0)
        );
    }

    function testRevert_borrow_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.borrow(
            USDC_ID,
            _c("n"),
            _c("c"),
            _c("b"),
            0,
            bytes32(0),
            _proof(1, 502, 0)
        );
    }

    function testRevert_borrow_unknownRoot() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.UnknownRoot.selector);
        positionPool.borrow(
            USDC_ID,
            _c("n"),
            _c("c"),
            _c("b"),
            1,
            _c("not-a-root"),
            _proof(1, 503, 0)
        );
    }

    function testRevert_borrow_assetNotBorrowable() public {
        IAssetRegistry.AssetConfig memory cfg = registry.assets(USDC_ID);
        cfg.borrowable = false;
        vm.prank(MANAGER);
        registry.updateAssetConfig(USDC_ID, cfg);

        // Need a known root first
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("e-bnb"));
        proxy.setAllowed(1, 504, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("n-bnb"),
            _c("r-bnb"),
            bytes32(0),
            _c("c-bnb"),
            500e6,
            bytes32(0),
            _proof(1, 504, 0)
        );
        bytes32 root = positionPool.currentRoot();

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPositionPool.AssetNotBorrowable.selector, USDC_ID)
        );
        positionPool.borrow(
            USDC_ID,
            _c("nb-bnb"),
            _c("cb-bnb"),
            _c("bb-bnb"),
            1,
            root,
            _proof(1, 505, 0)
        );
    }

    function testRevert_repay_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.repay(
            USDC_ID,
            _c("bn"),
            _c("r"),
            _c("on"),
            _c("nc"),
            0,
            bytes32(0),
            _proof(1, 600, 0)
        );
    }

    function testRevert_repay_unknownRoot() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.UnknownRoot.selector);
        positionPool.repay(
            USDC_ID,
            _c("bn"),
            _c("r"),
            _c("on"),
            _c("nc"),
            1,
            _c("nope"),
            _proof(1, 601, 0)
        );
    }

    function test_applyLiquidation_byBoard() public {
        // Open a position
        vm.prank(USER);
        entry.deposit(address(cbBtc), 1e8, _c("e-alq"));
        proxy.setAllowed(1, 700, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            CBBTC_ID,
            _c("n-alq"),
            _c("r-alq"),
            bytes32(0),
            _c("p-alq"),
            1e8,
            bytes32(0),
            _proof(1, 700, 0)
        );

        // Grant LIQUIDATOR_ROLE to a test address so we can call directly.
        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(liqRole, LIQUIDATOR);

        vm.prank(LIQUIDATOR);
        positionPool.applyLiquidation(
            CBBTC_ID,
            USDC_ID,
            _c("p-alq-nul"),
            _c("p-alq-2"),
            1e7, // 0.1 cbBTC seized
            100e6 // 100 USDC repaid (no prior debt so this just decrements floor)
        );

        assertEq(positionPool.totalCollateralPerAsset(CBBTC_ID), 1e8 - 1e7);
    }

    function testRevert_registerPosition_zero() public {
        ILiquidationBoard.LiquidationTrigger[] memory none =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.prank(POOL_KEEPER);
        vm.expectRevert(LiquidationBoard.ZeroAmount.selector);
        board.registerPosition(bytes32(0), none);
    }

    function test_registerPosition_updatesExisting() public {
        bytes32 target = _c("upd-target");
        ILiquidationBoard.LiquidationTrigger[] memory t1 =
            new ILiquidationBoard.LiquidationTrigger[](1);
        t1[0] = ILiquidationBoard.LiquidationTrigger({assetId: CBBTC_ID, priceThresholdUsd1e8: 50_000e8});

        ILiquidationBoard.LiquidationTrigger[] memory t2 =
            new ILiquidationBoard.LiquidationTrigger[](1);
        t2[0] = ILiquidationBoard.LiquidationTrigger({assetId: CBBTC_ID, priceThresholdUsd1e8: 55_000e8});

        vm.startPrank(POOL_KEEPER);
        board.registerPosition(target, t1);
        board.registerPosition(target, t2); // updates rather than re-adds
        vm.stopPrank();

        ILiquidationBoard.PositionInfo memory info = board.positionByCommitment(target);
        assertEq(info.triggers.length, 1);
        assertEq(uint256(info.triggers[0].priceThresholdUsd1e8), 55_000e8);
    }

    function testRevert_removePosition_unknown() public {
        vm.prank(POOL_KEEPER);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidationBoard.UnknownPosition.selector, _c("ghost"))
        );
        board.removePosition(_c("ghost"));
    }

    function testRevert_positionByCommitment_unknown() public {
        vm.expectRevert(
            abi.encodeWithSelector(LiquidationBoard.UnknownPosition.selector, _c("ghost"))
        );
        board.positionByCommitment(_c("ghost"));
    }

    function test_positionCountAndAt() public {
        ILiquidationBoard.LiquidationTrigger[] memory triggers =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.startPrank(POOL_KEEPER);
        board.registerPosition(_c("pa1"), triggers);
        board.registerPosition(_c("pa2"), triggers);
        vm.stopPrank();

        assertEq(board.positionCount(), 2);
        assertEq(board.positionAt(0).commitment, _c("pa1"));
        assertEq(board.positionAt(1).commitment, _c("pa2"));
    }

    function test_pause_liquidationBoard() public {
        bytes32 boardGuard = board.GUARDIAN_ROLE();
        vm.prank(ADMIN);
        board.grantRole(boardGuard, GUARDIAN);
        vm.prank(GUARDIAN);
        board.pause();

        ILiquidationBoard.LiquidationTrigger[] memory none =
            new ILiquidationBoard.LiquidationTrigger[](0);
        vm.prank(LIQUIDATOR);
        vm.expectRevert();
        board.liquidate(
            _c("any"), bytes32(0), _c("lb"), CBBTC_ID, USDC_ID,
            1, 9_600, none, _proof(1, 800, 0)
        );

        vm.prank(ADMIN);
        board.unpause();
    }

    function test_pause_positionPool() public {
        bytes32 ppGuard = positionPool.GUARDIAN_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(ppGuard, GUARDIAN);
        vm.prank(GUARDIAN);
        positionPool.pause();

        vm.prank(USER);
        vm.expectRevert();
        positionPool.borrow(
            USDC_ID, _c("n"), _c("c"), _c("b"), 1,
            bytes32(0), _proof(1, 801, 0)
        );

        vm.prank(ADMIN);
        positionPool.unpause();
    }

    function test_supplyPool_views() public view {
        assertEq(supplyPool.nextLeafIndex(), 0);
        assertEq(supplyPool.currentRoot(), EMPTY_IMT_ROOT);
        assertFalse(supplyPool.knownRoot(bytes32(0)));
        assertFalse(supplyPool.isSpent(bytes32("x")));
    }

    function test_positionPool_views() public view {
        assertEq(positionPool.nextLeafIndex(), 0);
        assertEq(positionPool.currentRoot(), EMPTY_IMT_ROOT);
        assertFalse(positionPool.knownRoot(bytes32(0)));
        assertFalse(positionPool.isSpent(bytes32("x")));
    }

    function test_supplyPool_pauseUnpauseRoundtrip() public {
        bytes32 g = supplyPool.GUARDIAN_ROLE();
        vm.prank(ADMIN);
        supplyPool.grantRole(g, GUARDIAN);
        vm.prank(GUARDIAN);
        supplyPool.pause();
        vm.prank(ADMIN);
        supplyPool.unpause();
    }

    function testRevert_withdrawSupply_replaySupplyNullifier() public {
        // Seed and withdraw once
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("seed-rep"));
        proxy.setAllowed(1, 900, 0, true);
        vm.prank(USER);
        supplyPool.supplyAsset(
            USDC_ID, _c("n-rep"), _c("r-rep"), _c("s-rep"), 1_000e6, _proof(1, 900, 0)
        );
        bytes32 root = supplyPool.currentRoot();
        bytes32 supplyNul = _c("supply-nul-rep");
        proxy.setAllowed(1, 901, 0, true);
        vm.prank(USER);
        supplyPool.withdrawSupply(
            USDC_ID, supplyNul, _c("nb-rep"), 100e6, root, _proof(1, 901, 0)
        );

        // Replay same supply nullifier
        proxy.setAllowed(1, 902, 0, true);
        bytes32 newRoot = supplyPool.currentRoot();
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedSupplyPool.NullifierAlreadySpent.selector, supplyNul
            )
        );
        supplyPool.withdrawSupply(
            USDC_ID, supplyNul, _c("nb-rep2"), 100e6, newRoot, _proof(1, 902, 0)
        );
    }

    function testRevert_withdrawCollateral_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.withdrawCollateral(
            USDC_ID, _c("n"), _c("c"), _c("b"), 0, bytes32(0), _proof(1, 910, 0)
        );
    }

    function testRevert_withdrawCollateral_zeroPositionCommitment() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.withdrawCollateral(
            USDC_ID, _c("n"), bytes32(0), _c("b"), 1, bytes32(0), _proof(1, 911, 0)
        );
    }

    function testRevert_withdrawCollateral_zeroBalanceCommitment() public {
        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.withdrawCollateral(
            USDC_ID, _c("n"), _c("c"), bytes32(0), 1, bytes32(0), _proof(1, 912, 0)
        );
    }

    function testRevert_withdrawCollateral_assetDisabled() public {
        // Need a known root first
        vm.prank(USER);
        entry.deposit(address(usdc), 10_000e6, _c("e-wcd"));
        proxy.setAllowed(1, 913, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            USDC_ID,
            _c("n-wcd"),
            _c("r-wcd"),
            bytes32(0),
            _c("c-wcd"),
            500e6,
            bytes32(0),
            _proof(1, 913, 0)
        );
        bytes32 root = positionPool.currentRoot();

        vm.prank(MANAGER);
        registry.disableAsset(USDC_ID);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPositionPool.AssetNotEnabled.selector, USDC_ID)
        );
        positionPool.withdrawCollateral(
            USDC_ID, _c("nw-wcd"), _c("ncw-wcd"), _c("nbw-wcd"),
            1, root, _proof(1, 914, 0)
        );

        vm.prank(MANAGER);
        registry.reenableAsset(USDC_ID);
    }

    function testRevert_borrow_assetDisabled() public {
        vm.prank(MANAGER);
        registry.disableAsset(USDC_ID);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPositionPool.AssetNotEnabled.selector, USDC_ID)
        );
        positionPool.borrow(
            USDC_ID, _c("n"), _c("c"), _c("b"), 1, bytes32(0), _proof(1, 915, 0)
        );

        vm.prank(MANAGER);
        registry.reenableAsset(USDC_ID);
    }

    function testRevert_repay_assetDisabled() public {
        vm.prank(MANAGER);
        registry.disableAsset(USDC_ID);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPositionPool.AssetNotEnabled.selector, USDC_ID)
        );
        positionPool.repay(
            USDC_ID, _c("bn"), _c("r"), _c("on"), _c("nc"),
            1, bytes32(0), _proof(1, 916, 0)
        );

        vm.prank(MANAGER);
        registry.reenableAsset(USDC_ID);
    }

    function testRevert_depositCollateral_unknownAsset() public {
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPositionPool.AssetNotEnabled.selector, uint8(99))
        );
        positionPool.depositCollateral(
            99, _c("n"), _c("r"), bytes32(0), _c("c"), 1, bytes32(0),
            _proof(1, 917, 0)
        );
    }

    function test_depositCollateral_withExistingPosition_unknownRoot() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("e-dc2"));

        vm.prank(USER);
        vm.expectRevert(ShieldedPositionPool.UnknownRoot.selector);
        positionPool.depositCollateral(
            USDC_ID,
            _c("n-dc2"),
            _c("r-dc2"),
            _c("existing-pos"), // non-zero → triggers root check
            _c("c-dc2"),
            500e6,
            _c("not-a-root"),
            _proof(1, 918, 0)
        );
    }

    function test_applyLiquidation_zeroDebt() public {
        // Open a position
        vm.prank(USER);
        entry.deposit(address(cbBtc), 1e8, _c("e-alz"));
        proxy.setAllowed(1, 919, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            CBBTC_ID, _c("n-alz"), _c("r-alz"), bytes32(0),
            _c("p-alz"), 1e8, bytes32(0), _proof(1, 919, 0)
        );

        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(liqRole, LIQUIDATOR);

        // collateralSeized=0 and debtCovered=0 exercises both skip branches
        vm.prank(LIQUIDATOR);
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, _c("p-alz-nul"), _c("p-alz-2"), 0, 0
        );
    }

    function test_applyLiquidation_collateralOnly() public {
        // Open
        vm.prank(USER);
        entry.deposit(address(cbBtc), 1e8, _c("e-aco"));
        proxy.setAllowed(1, 920, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            CBBTC_ID, _c("n-aco"), _c("r-aco"), bytes32(0),
            _c("p-aco"), 1e8, bytes32(0), _proof(1, 920, 0)
        );

        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(liqRole, LIQUIDATOR);

        vm.prank(LIQUIDATOR);
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, _c("p-aco-nul"), _c("p-aco-2"), 1e7, 0
        );
        assertEq(positionPool.totalCollateralPerAsset(CBBTC_ID), 1e8 - 1e7);
    }

    function testRevert_applyLiquidation_replay() public {
        vm.prank(USER);
        entry.deposit(address(cbBtc), 1e8, _c("e-arp"));
        proxy.setAllowed(1, 921, 0, true);
        vm.prank(USER);
        positionPool.depositCollateral(
            CBBTC_ID, _c("n-arp"), _c("r-arp"), bytes32(0),
            _c("p-arp"), 1e8, bytes32(0), _proof(1, 921, 0)
        );
        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(liqRole, LIQUIDATOR);

        bytes32 dupNul = _c("dup-pos-nul");
        vm.startPrank(LIQUIDATOR);
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, dupNul, _c("p-arp-2"), 1e6, 1
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPositionPool.NullifierAlreadySpent.selector, dupNul
            )
        );
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, dupNul, _c("p-arp-3"), 1e6, 1
        );
        vm.stopPrank();
    }

    function testRevert_applyLiquidation_zeroCommitment() public {
        bytes32 liqRole = positionPool.LIQUIDATOR_ROLE();
        vm.prank(ADMIN);
        positionPool.grantRole(liqRole, LIQUIDATOR);
        vm.prank(LIQUIDATOR);
        vm.expectRevert(ShieldedPositionPool.ZeroAmount.selector);
        positionPool.applyLiquidation(
            CBBTC_ID, USDC_ID, _c("n"), bytes32(0), 1, 1
        );
    }

    function testRevert_constructors_zeroAddrs() public {
        // Quick sanity that each pool's constructor rejects zero addresses
        vm.expectRevert(ShieldedSupplyPool.ZeroAddress.selector);
        new ShieldedSupplyPool(
            address(0), address(registry), address(rateModel), address(entry), address(zk)
        );
        vm.expectRevert(ShieldedPositionPool.ZeroAddress.selector);
        new ShieldedPositionPool(
            address(0), address(registry), address(rateModel), address(entry), address(zk)
        );
        vm.expectRevert(LiquidationBoard.ZeroAddress.selector);
        new LiquidationBoard(
            address(0),
            address(registry),
            address(oracle),
            address(entry),
            address(positionPool),
            address(fund),
            address(zk)
        );
    }
}

// Forge `Vm.Log` is imported from forge-std/Test.sol via the named import above.
