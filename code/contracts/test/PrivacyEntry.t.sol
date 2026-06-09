// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {PrivacyEntry} from "../src/PrivacyEntry.sol";
import {IPrivacyEntry} from "../src/interfaces/IPrivacyEntry.sol";
import {ZkVerifier} from "../src/ZkVerifier.sol";
import {IZkVerifier} from "../src/interfaces/IZkVerifier.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVerifyProofAggregation} from "./mocks/MockVerifyProofAggregation.sol";

/// @notice subsystem_test.md Day-2 T-2.1 (POOL_ROLE gating) + T-2.2 (reserves arithmetic).
contract PrivacyEntryTest is Test {
    PrivacyEntry internal entry;
    ZkVerifier internal zk;
    MockVerifyProofAggregation internal proxy;
    MockERC20 internal usdc;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant POOL = address(0xC0DE);
    address internal constant GUARDIAN = address(0xBEEF);
    address internal constant USER = address(0x10AD);
    address internal constant RECIPIENT = address(0x9999);
    address internal constant OUTSIDER = address(0xDEAD);

    bytes32 internal constant VK_WITHDRAW =
        0x0cab278e65e51eb92a75c0285c5b953a2fff36de3547036e3051915af46ce250;
    // ^ _c("vk-circuit-1") -- inlined as hex so the constant
    //   survives the _c() Field-reducer rewrite below.

    /// BN254 Fr prime: Stage-A Poseidon2 rejects inputs >= PRIME, so test
    /// commitments built from keccak("...") must be reduced into Field.
    uint256 internal constant PRIME =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    /// Field-reduced commitment helper. Real production commitments come
    /// from in-circuit hashing and are already < PRIME; tests mirror that.
    function _c(string memory s) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(bytes(s))) % PRIME);
    }

    function setUp() public {
        proxy = new MockVerifyProofAggregation();

        bytes32[] memory vks = new bytes32[](11);
        vks[uint256(uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW))] = VK_WITHDRAW;
        zk = new ZkVerifier(ADMIN, address(proxy), vks);

        entry = new PrivacyEntry(ADMIN, address(zk));

        vm.startPrank(ADMIN);
        zk.grantRole(zk.CALLER_ROLE(), address(entry));
        entry.grantRole(entry.POOL_ROLE(), POOL);
        entry.grantRole(entry.GUARDIAN_ROLE(), GUARDIAN);
        vm.stopPrank();

        usdc = new MockERC20("USDC", "USDC", 6);
        usdc.mint(USER, 10_000e6);
        vm.prank(USER);
        usdc.approve(address(entry), type(uint256).max);
    }

    // T-2.2: reserves arithmetic
    function test_deposit_updatesReservesAndPullsTokens() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("commit-1"));

        assertEq(entry.reserves(address(usdc)), 1_000e6);
        assertEq(usdc.balanceOf(address(entry)), 1_000e6);
        assertEq(entry.nextLeafIndex(), 1);
        assertTrue(entry.currentRoot() != bytes32(0));
        assertTrue(entry.knownRoot(entry.currentRoot()));
    }

    function testRevert_deposit_zeroToken() public {
        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.ZeroAddress.selector);
        entry.deposit(address(0), 1, _c("c"));
    }

    function testRevert_deposit_zeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.ZeroAmount.selector);
        entry.deposit(address(usdc), 0, _c("c"));
    }

    function testRevert_deposit_zeroCommitment() public {
        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.ZeroAmount.selector);
        entry.deposit(address(usdc), 1, bytes32(0));
    }

    function testRevert_deposit_duplicateCommitment() public {
        bytes32 c = _c("dup");
        vm.startPrank(USER);
        entry.deposit(address(usdc), 1e6, c);
        vm.expectRevert(abi.encodeWithSelector(PrivacyEntry.CommitmentAlreadyInserted.selector, c));
        entry.deposit(address(usdc), 1e6, c);
        vm.stopPrank();
    }

    // T-2.1: POOL_ROLE gating
    function test_spendBalance_byPool_marksNullifierAndInserts() public {
        bytes32 nul = _c("n1");
        bytes32 res = _c("r1");
        bytes32 dst = _c("d1");

        vm.prank(POOL);
        entry.spendBalance(nul, res, dst);

        assertTrue(entry.isSpent(nul));
        assertEq(entry.nextLeafIndex(), 1, "residual inserted");
    }

    function test_spendBalance_skipsZeroResidual() public {
        bytes32 nul = _c("n2");
        vm.prank(POOL);
        entry.spendBalance(nul, bytes32(0), bytes32(0));
        assertTrue(entry.isSpent(nul));
        assertEq(entry.nextLeafIndex(), 0, "no commitment inserted");
    }

    function testRevert_spendBalance_byOutsider() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        entry.spendBalance(_c("n"), bytes32(0), bytes32(0));
    }

    function testRevert_spendBalance_replayNullifier() public {
        bytes32 nul = _c("n");
        vm.prank(POOL);
        entry.spendBalance(nul, bytes32(0), bytes32(0));

        vm.prank(POOL);
        vm.expectRevert(abi.encodeWithSelector(PrivacyEntry.NullifierAlreadySpent.selector, nul));
        entry.spendBalance(nul, bytes32(0), bytes32(0));
    }

    function test_creditBalance_byPool_inserts() public {
        bytes32 c = _c("credit-1");
        vm.prank(POOL);
        entry.creditBalance(c);
        assertEq(entry.nextLeafIndex(), 1);
    }

    function testRevert_creditBalance_byOutsider() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        entry.creditBalance(_c("c"));
    }

    function testRevert_creditBalance_zero() public {
        vm.prank(POOL);
        vm.expectRevert(PrivacyEntry.ZeroAmount.selector);
        entry.creditBalance(bytes32(0));
    }

    // ───────────── withdraw flow (uses mock verifier) ─────────────

    function _proof(uint256 leafIndex)
        internal
        pure
        returns (IZkVerifier.AggregationProof memory)
    {
        return IZkVerifier.AggregationProof({
            domainId: 1,
            aggregationId: 100,
            leaf: _c("leaf"),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: leafIndex
        });
    }

    function test_withdraw_happyPath() public {
        // Seed the vault and capture a known root.
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-seed"));
        bytes32 root = entry.currentRoot();

        proxy.setAllowed(1, 100, 0, true);
        IZkVerifier.AggregationProof memory p = _proof(0);

        vm.prank(USER);
        entry.withdraw(
            _c("withdraw-nul"),
            _c("withdraw-residual"),
            address(usdc),
            RECIPIENT,
            250e6,
            root,
            VK_WITHDRAW,
            p
        );

        assertEq(usdc.balanceOf(RECIPIENT), 250e6);
        assertEq(entry.reserves(address(usdc)), 750e6);
        assertTrue(entry.isSpent(_c("withdraw-nul")));
    }

    function test_withdraw_thenDeposit_reservesArithmetic() public {
        // T-2.2 walkthrough: deposit 1000, withdraw 250, deposit 500 -> 1250.
        vm.startPrank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-A"));
        vm.stopPrank();
        bytes32 rootA = entry.currentRoot();

        proxy.setAllowed(1, 100, 0, true);
        vm.prank(USER);
        entry.withdraw(
            _c("nA"),
            _c("rA"),
            address(usdc),
            RECIPIENT,
            250e6,
            rootA,
            VK_WITHDRAW,
            _proof(0)
        );

        vm.prank(USER);
        entry.deposit(address(usdc), 500e6, _c("c-B"));

        assertEq(entry.reserves(address(usdc)), 1_250e6);
        assertEq(usdc.balanceOf(address(entry)), 1_250e6);
    }

    function testRevert_withdraw_unknownRoot() public {
        proxy.setAllowed(1, 100, 0, true);
        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.UnknownRoot.selector);
        entry.withdraw(
            _c("n"),
            _c("r"),
            address(usdc),
            RECIPIENT,
            1,
            _c("not-a-root"),
            VK_WITHDRAW,
            _proof(0)
        );
    }

    function testRevert_withdraw_replayNullifier() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-seed"));
        bytes32 root = entry.currentRoot();

        proxy.setAllowed(1, 100, 0, true);
        vm.prank(USER);
        entry.withdraw(
            _c("dup-nul"),
            _c("r1"),
            address(usdc),
            RECIPIENT,
            100e6,
            root,
            VK_WITHDRAW,
            _proof(0)
        );

        proxy.setAllowed(1, 100, 1, true);
        bytes32 newRoot = entry.currentRoot();
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivacyEntry.NullifierAlreadySpent.selector, _c("dup-nul")
            )
        );
        entry.withdraw(
            _c("dup-nul"),
            _c("r2"),
            address(usdc),
            RECIPIENT,
            100e6,
            newRoot,
            VK_WITHDRAW,
            _proof(1)
        );
    }

    function testRevert_withdraw_proofRejected() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-seed"));
        bytes32 root = entry.currentRoot();
        // proxy not configured to allow this tuple → ZkVerifier reverts.

        vm.prank(USER);
        vm.expectRevert();
        entry.withdraw(
            _c("n"),
            _c("r"),
            address(usdc),
            RECIPIENT,
            100e6,
            root,
            VK_WITHDRAW,
            _proof(0)
        );
    }

    function testRevert_withdraw_insufficientReserves() public {
        // Pool credits a balance commitment without any token deposit — so
        // a balance note exists in the tree, but `_reserves[usdc] == 0`.
        // A withdraw against that note must hit the named guard, not a panic.
        vm.prank(POOL);
        entry.creditBalance(_c("phantom-note"));

        bytes32 root = entry.currentRoot();
        proxy.setAllowed(1, 100, 0, true);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivacyEntry.InsufficientReserves.selector,
                address(usdc),
                uint256(100e6),
                uint256(0)
            )
        );
        entry.withdraw(
            _c("n"),
            _c("r"),
            address(usdc),
            RECIPIENT,
            100e6,
            root,
            VK_WITHDRAW,
            _proof(0)
        );
    }

    function testRevert_withdraw_zeroRecipient() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-seed"));
        bytes32 root = entry.currentRoot();

        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.ZeroAddress.selector);
        entry.withdraw(
            _c("n"),
            _c("r"),
            address(usdc),
            address(0),
            1,
            root,
            VK_WITHDRAW,
            _proof(0)
        );
    }

    function testRevert_withdraw_zeroAmount() public {
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, _c("c-seed"));
        bytes32 root = entry.currentRoot();

        vm.prank(USER);
        vm.expectRevert(PrivacyEntry.ZeroAmount.selector);
        entry.withdraw(
            _c("n"),
            _c("r"),
            address(usdc),
            RECIPIENT,
            0,
            root,
            VK_WITHDRAW,
            _proof(0)
        );
    }

    function test_pause_byGuardian_blocksDeposit() public {
        vm.prank(GUARDIAN);
        entry.pause();

        vm.prank(USER);
        vm.expectRevert();
        entry.deposit(address(usdc), 1, _c("c"));

        vm.prank(ADMIN);
        entry.unpause();

        vm.prank(USER);
        entry.deposit(address(usdc), 1, _c("c"));
    }

    function testRevert_pause_byOutsider() public {
        vm.prank(OUTSIDER);
        vm.expectRevert();
        entry.pause();
    }

    function testRevert_constructor_zeroAdmin() public {
        vm.expectRevert(PrivacyEntry.ZeroAddress.selector);
        new PrivacyEntry(address(0), address(zk));
    }

    function testRevert_constructor_zeroVerifier() public {
        vm.expectRevert(PrivacyEntry.ZeroAddress.selector);
        new PrivacyEntry(ADMIN, address(0));
    }

    function test_rootHistory_keepsKnownRoots() public {
        // Insert two commitments; both roots should be reachable as `knownRoot`.
        vm.startPrank(USER);
        entry.deposit(address(usdc), 1, _c("c1"));
        bytes32 root1 = entry.currentRoot();
        entry.deposit(address(usdc), 1, _c("c2"));
        bytes32 root2 = entry.currentRoot();
        vm.stopPrank();

        assertTrue(entry.knownRoot(root1), "root1 retained");
        assertTrue(entry.knownRoot(root2), "root2 retained");
        assertTrue(root1 != root2);
    }
}
