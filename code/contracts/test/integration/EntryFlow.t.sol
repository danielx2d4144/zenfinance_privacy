// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {PrivacyEntry} from "../../src/PrivacyEntry.sol";
import {ZkVerifier} from "../../src/ZkVerifier.sol";
import {IZkVerifier} from "../../src/interfaces/IZkVerifier.sol";
import {VkRegistry} from "../../src/libraries/VkRegistry.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockVerifyProofAggregation} from "../mocks/MockVerifyProofAggregation.sol";

/// @notice Day-6 integration: full deposit -> spend -> credit -> withdraw
///         loop through PrivacyEntry, with all 11 real circuit vkHashes
///         pinned in ZkVerifier via the VkRegistry library.
/// @dev    Spec: design-v2/subsystems/12_privacy_entry_layer.md §3
///                design-v2/roadmap/subsystem_test.md §Day-6
///         Real Noir-proof bytes are not yet exercised on-chain (the Day-8
///         attestation pipeline is what feeds aggregated proofs into the
///         zkVerify proxy). For Day 6 we drive the proxy with the
///         programmable mock and assert that:
///           1. The vkHash that PrivacyEntry passes to ZkVerifier is the
///              exact value VkRegistry exposes for ENTRY_WITHDRAW (the
///              real Pedersen-domain hash of the Noir circuit's vk).
///           2. Custody arithmetic is exact across deposit/POOL_ROLE
///              moves/withdraw.
///           3. Withdraw nullifiers cannot replay (T-6.2).
///           4. A wrong expectedVkHash on withdraw reverts (T-6.3).
///           5. The (domainId, aggId, leafIndex) replay slot in ZkVerifier
///              cannot be reused even if a caller fakes a fresh nullifier.
contract EntryFlowTest is Test {
    PrivacyEntry internal entry;
    ZkVerifier internal zk;
    MockVerifyProofAggregation internal proxy;
    MockERC20 internal usdc;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant POOL = address(0xC0DE);
    address internal constant USER = address(0x10AD);
    address internal constant RECIPIENT = address(0x9999);

    /// BN254 Fr prime: Stage-A Poseidon2 rejects inputs >= PRIME, so
    /// test commitments built from keccak("...") must be reduced into Field.
    uint256 internal constant PRIME =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    function _c(string memory s) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(bytes(s))) % PRIME);
    }

    function setUp() public {
        proxy = new MockVerifyProofAggregation();

        // Use the real, deploy-script-shape pack(): 11 entries indexed by
        // CircuitId. This is the same call DeployZkVerifier.s.sol uses.
        zk = new ZkVerifier(ADMIN, address(proxy), VkRegistry.pack());

        entry = new PrivacyEntry(ADMIN, address(zk));

        vm.startPrank(ADMIN);
        zk.grantRole(zk.CALLER_ROLE(), address(entry));
        entry.grantRole(entry.POOL_ROLE(), POOL);
        vm.stopPrank();

        usdc = new MockERC20("USDC", "USDC", 6);
        usdc.mint(USER, 10_000e6);
        vm.prank(USER);
        usdc.approve(address(entry), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // T-6.1: full deposit -> POOL_ROLE shuttle -> credit -> withdraw loop
    //        with custody balanced to the wei at every step.
    // ---------------------------------------------------------------------

    function test_T6_1_fullEntryFlow_custodyBalancedAtEveryStep() public {
        // Step 0: invariants before any user action.
        assertEq(entry.reserves(address(usdc)), 0, "reserves should start zero");
        assertEq(usdc.balanceOf(address(entry)), 0, "vault should start empty");
        assertEq(usdc.balanceOf(USER), 10_000e6, "user starts at 10k USDC");

        // Step 1: deposit 1000 USDC -> commitment c1.
        bytes32 c1 = _c("balance-note-1");
        vm.prank(USER);
        entry.deposit(address(usdc), 1_000e6, c1);

        assertEq(entry.reserves(address(usdc)), 1_000e6, "reserves +1000");
        assertEq(usdc.balanceOf(address(entry)), 1_000e6, "vault holds 1000");
        assertEq(usdc.balanceOf(USER), 9_000e6, "user pays 1000");
        assertEq(entry.nextLeafIndex(), 1, "tree advanced 1 leaf");

        // Step 2: POOL spends c1 (e.g. supply move into ShieldedSupplyPool).
        //         residual stays inside PrivacyEntry; destination commitment
        //         is in the receiving pool's tree (event-only here).
        bytes32 n1 = _c("nullifier-1");
        bytes32 c1_residual = _c("residual-after-supply");
        bytes32 c1_dest = _c("dest-in-supply-pool");
        vm.prank(POOL);
        entry.spendBalance(n1, c1_residual, c1_dest);

        assertTrue(entry.isSpent(n1), "n1 marked spent");
        assertEq(entry.reserves(address(usdc)), 1_000e6, "reserves unchanged on internal move");
        assertEq(entry.nextLeafIndex(), 2, "residual inserted as new leaf");

        // Step 3: POOL credits a fresh balance note (e.g. borrow proceeds
        //         or supply withdrawal returning value into PrivacyEntry).
        bytes32 c2 = _c("balance-note-after-borrow");
        vm.prank(POOL);
        entry.creditBalance(c2);

        assertEq(entry.reserves(address(usdc)), 1_000e6, "reserves still 1000 after credit");
        assertEq(entry.nextLeafIndex(), 3, "credit advances tree");

        // Step 4: user withdraws 1000 USDC against c2.
        //         Capture the root at "prove time" for the proof binding.
        bytes32 rootAtProveTime = entry.currentRoot();
        bytes32 nWithdraw = _c("nullifier-withdraw");
        bytes32 cResidual = _c("residual-after-withdraw");

        IZkVerifier.AggregationProof memory proof = _proof(7, 13, 21);
        proxy.setAllowed(7, 13, 21, true);

        vm.prank(USER);
        entry.withdraw(
            nWithdraw,
            cResidual,
            address(usdc),
            RECIPIENT,
            1_000e6,
            rootAtProveTime,
            VkRegistry.ENTRY_WITHDRAW,
            proof
        );

        // Final invariants: custody back to zero, recipient holds the funds,
        // nullifier consumed in PrivacyEntry, replay tuple consumed in
        // ZkVerifier.
        assertEq(entry.reserves(address(usdc)), 0, "reserves drained");
        assertEq(usdc.balanceOf(address(entry)), 0, "vault empty");
        assertEq(usdc.balanceOf(RECIPIENT), 1_000e6, "recipient receives 1000");
        assertEq(usdc.balanceOf(USER), 9_000e6, "user balance unchanged after withdraw");
        assertTrue(entry.isSpent(nWithdraw), "withdraw nullifier consumed");
        assertTrue(zk.isConsumed(7, 13, 21), "replay tuple consumed in ZkVerifier");

        // I-CRYPTO-1 (vk pinning): the on-chain pinned vkHash matches the
        // exact bytes the SDK / circuit-prover side will publish.
        assertEq(
            zk.vkHash(uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW)),
            VkRegistry.ENTRY_WITHDRAW
        );
    }

    // ---------------------------------------------------------------------
    // T-6.2: replay nullifier reverts.
    // ---------------------------------------------------------------------

    function test_T6_2_replayNullifierReverts() public {
        // Stage a withdrawable balance.
        bytes32 c1 = _c("balance-replay");
        vm.prank(USER);
        entry.deposit(address(usdc), 500e6, c1);

        bytes32 root = entry.currentRoot();
        bytes32 nW = _c("nullifier-replay");
        bytes32 cR = _c("residual-replay");

        IZkVerifier.AggregationProof memory p1 = _proof(1, 2, 3);
        proxy.setAllowed(1, 2, 3, true);

        vm.prank(USER);
        entry.withdraw(
            nW, cR, address(usdc), RECIPIENT, 500e6, root,
            VkRegistry.ENTRY_WITHDRAW, p1
        );

        // Same nullifier, fresh tuple in proxy -> PrivacyEntry's _spent
        // must short-circuit ahead of ZkVerifier.
        IZkVerifier.AggregationProof memory p2 = _proof(1, 2, 4);
        proxy.setAllowed(1, 2, 4, true);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(PrivacyEntry.NullifierAlreadySpent.selector, nW)
        );
        entry.withdraw(
            nW, _c("res-2"), address(usdc), RECIPIENT, 500e6, root,
            VkRegistry.ENTRY_WITHDRAW, p2
        );
    }

    /// @notice Even with a *fresh* nullifier, the replay slot in ZkVerifier
    ///         (domainId, aggId, leafIndex) must be single-use. Otherwise a
    ///         malicious pool with CALLER_ROLE could submit the same proof
    ///         twice via two different action paths.
    function test_T6_2b_zkVerifierReplaySlotEnforced() public {
        bytes32 c1 = _c("balance-r2");
        vm.prank(USER);
        entry.deposit(address(usdc), 200e6, c1);

        bytes32 root = entry.currentRoot();

        IZkVerifier.AggregationProof memory p = _proof(9, 9, 9);
        proxy.setAllowed(9, 9, 9, true);

        vm.prank(USER);
        entry.withdraw(
            _c("n-1st"), _c("res-1st"), address(usdc), RECIPIENT, 100e6, root,
            VkRegistry.ENTRY_WITHDRAW, p
        );

        // Fresh nullifier, same proof tuple -> ZkVerifier rejects.
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(ZkVerifier.AlreadyConsumed.selector, uint256(9), uint256(9), uint256(9))
        );
        entry.withdraw(
            _c("n-2nd"), _c("res-2nd"), address(usdc), RECIPIENT, 100e6, root,
            VkRegistry.ENTRY_WITHDRAW, p
        );
    }

    // ---------------------------------------------------------------------
    // T-6.3: mismatched vkHash reverts.
    // ---------------------------------------------------------------------

    function test_T6_3_mismatchedVkHashReverts() public {
        bytes32 c1 = _c("balance-vkmm");
        vm.prank(USER);
        entry.deposit(address(usdc), 100e6, c1);
        bytes32 root = entry.currentRoot();

        IZkVerifier.AggregationProof memory p = _proof(2, 2, 2);
        proxy.setAllowed(2, 2, 2, true);

        // Pass the BORROW vkHash to a withdraw call -- ZkVerifier compares
        // against ENTRY_WITHDRAW's pinned hash and reverts.
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ZkVerifier.VkHashMismatch.selector,
                uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW),
                VkRegistry.BORROW,                  // expected (caller's claim)
                VkRegistry.ENTRY_WITHDRAW           // pinned   (ground truth)
            )
        );
        entry.withdraw(
            _c("n-vkmm"), _c("res-vkmm"), address(usdc), RECIPIENT, 100e6, root,
            VkRegistry.BORROW,                      // wrong vkHash
            p
        );
    }

    // ---------------------------------------------------------------------
    // Sanity: every CircuitId slot has its expected hash from VkRegistry.
    // ---------------------------------------------------------------------

    function test_allElevenVkHashesPinned() public view {
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT)),       VkRegistry.ENTRY_DEPOSIT);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW)),      VkRegistry.ENTRY_WITHDRAW);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.SUPPLY_ASSET)),        VkRegistry.SUPPLY_ASSET);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.WITHDRAW_SUPPLY)),     VkRegistry.WITHDRAW_SUPPLY);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.DEPOSIT_COLLATERAL)),  VkRegistry.DEPOSIT_COLLATERAL);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.WITHDRAW_COLLATERAL)), VkRegistry.WITHDRAW_COLLATERAL);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.BORROW)),              VkRegistry.BORROW);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.REPAY)),               VkRegistry.REPAY);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.LIQUIDATE)),           VkRegistry.LIQUIDATE);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.CONSOLIDATE_BALANCE)), VkRegistry.CONSOLIDATE_BALANCE);
        assertEq(zk.vkHash(uint8(IZkVerifier.CircuitId.COMPUTE_TRIGGERS)),    VkRegistry.COMPUTE_TRIGGERS);
    }

    // ---------------------------------------------------------------------
    // Helpers.
    // ---------------------------------------------------------------------

    function _proof(uint256 dom, uint256 agg, uint256 leafIdx)
        internal
        pure
        returns (IZkVerifier.AggregationProof memory p)
    {
        p.domainId = dom;
        p.aggregationId = agg;
        p.leafIndex = leafIdx;
        p.leaf = keccak256(abi.encodePacked(dom, agg, leafIdx));
        p.leafCount = 1;
        p.merklePath = new bytes32[](0);
    }
}
