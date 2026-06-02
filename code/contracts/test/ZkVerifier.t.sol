// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {ZkVerifier} from "../src/ZkVerifier.sol";
import {IZkVerifier} from "../src/interfaces/IZkVerifier.sol";
import {MockVerifyProofAggregation} from "./mocks/MockVerifyProofAggregation.sol";

/// @notice subsystem_test.md Day-2 T-2.3 (vkHash mismatch) + T-2.4 (replay).
contract ZkVerifierTest is Test {
    ZkVerifier internal zk;
    MockVerifyProofAggregation internal proxy;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant CALLER = address(0xB0B);
    address internal constant OUTSIDER = address(0xDEAD);

    bytes32 internal constant VK_0 = keccak256("vk-circuit-0");
    bytes32 internal constant VK_1 = keccak256("vk-circuit-1");

    function setUp() public {
        proxy = new MockVerifyProofAggregation();

        bytes32[] memory vks = new bytes32[](11);
        vks[0] = VK_0;
        vks[1] = VK_1;
        // Slots 2-10 left as zero — covers VkHashUnset error path.

        zk = new ZkVerifier(ADMIN, address(proxy), vks);
        bytes32 callerRole = zk.CALLER_ROLE();
        vm.prank(ADMIN);
        zk.grantRole(callerRole, CALLER);
    }

    function _proof(uint256 domainId, uint256 aggId, uint256 leafIndex)
        internal
        pure
        returns (IZkVerifier.AggregationProof memory)
    {
        return IZkVerifier.AggregationProof({
            domainId: domainId,
            aggregationId: aggId,
            leaf: keccak256("leaf"),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: leafIndex
        });
    }

    function test_constructor_pinsAllVkHashes() public view {
        assertEq(zk.vkHash(0), VK_0);
        assertEq(zk.vkHash(1), VK_1);
        assertEq(zk.vkHash(10), bytes32(0));
        assertEq(zk.NUM_CIRCUITS(), 11);
    }

    function testRevert_constructor_zeroAdmin() public {
        bytes32[] memory vks = new bytes32[](11);
        vm.expectRevert(ZkVerifier.ZeroAddress.selector);
        new ZkVerifier(address(0), address(proxy), vks);
    }

    function testRevert_constructor_zeroProxy() public {
        bytes32[] memory vks = new bytes32[](11);
        vm.expectRevert(ZkVerifier.ZeroAddress.selector);
        new ZkVerifier(ADMIN, address(0), vks);
    }

    function testRevert_constructor_wrongVkLength() public {
        bytes32[] memory vks = new bytes32[](5);
        vm.expectRevert(
            abi.encodeWithSelector(ZkVerifier.VkHashLengthMismatch.selector, uint256(11), uint256(5))
        );
        new ZkVerifier(ADMIN, address(proxy), vks);
    }

    // T-2.3
    function testRevert_verifyAndConsume_vkHashMismatch() public {
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);
        proxy.setAllowed(1, 42, 0, true);

        bytes32 wrongVk = keccak256("not-vk-0");
        vm.prank(CALLER);
        vm.expectRevert(
            abi.encodeWithSelector(ZkVerifier.VkHashMismatch.selector, uint8(0), wrongVk, VK_0)
        );
        zk.verifyAndConsume(0, wrongVk, p);
    }

    function testRevert_verifyAndConsume_vkHashUnset() public {
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);
        vm.prank(CALLER);
        vm.expectRevert(abi.encodeWithSelector(ZkVerifier.VkHashUnset.selector, uint8(5)));
        zk.verifyAndConsume(5, bytes32(0), p);
    }

    function testRevert_verifyAndConsume_invalidCircuitId() public {
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);
        vm.prank(CALLER);
        vm.expectRevert(abi.encodeWithSelector(ZkVerifier.InvalidCircuitId.selector, uint8(11)));
        zk.verifyAndConsume(11, VK_0, p);
    }

    // T-2.4
    function testRevert_verifyAndConsume_doubleConsume() public {
        proxy.setAllowed(1, 42, 0, true);
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);

        vm.prank(CALLER);
        zk.verifyAndConsume(0, VK_0, p);

        assertTrue(zk.isConsumed(1, 42, 0));

        vm.prank(CALLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ZkVerifier.AlreadyConsumed.selector, uint256(1), uint256(42), uint256(0)
            )
        );
        zk.verifyAndConsume(0, VK_0, p);
    }

    function test_verifyAndConsume_succeedsAndEmits() public {
        proxy.setAllowed(7, 99, 3, true);
        IZkVerifier.AggregationProof memory p = _proof(7, 99, 3);

        vm.expectEmit(true, true, true, true);
        emit IZkVerifier.ProofConsumed(uint8(0), uint256(7), uint256(99), uint256(3));

        vm.prank(CALLER);
        bool ok = zk.verifyAndConsume(0, VK_0, p);
        assertTrue(ok);
        assertTrue(zk.isConsumed(7, 99, 3));
    }

    function testRevert_verifyAndConsume_proxyReturnsFalse() public {
        // proxy is left with no allowed entries -> always false
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);
        vm.prank(CALLER);
        vm.expectRevert(ZkVerifier.AggregationVerifyFailed.selector);
        zk.verifyAndConsume(0, VK_0, p);
    }

    function testRevert_verifyAndConsume_byNonCaller() public {
        IZkVerifier.AggregationProof memory p = _proof(1, 42, 0);
        vm.prank(OUTSIDER);
        vm.expectRevert();
        zk.verifyAndConsume(0, VK_0, p);
    }

    function testRevert_vkHash_invalidCircuitId() public {
        vm.expectRevert(abi.encodeWithSelector(ZkVerifier.InvalidCircuitId.selector, uint8(11)));
        zk.vkHash(11);
    }
}
