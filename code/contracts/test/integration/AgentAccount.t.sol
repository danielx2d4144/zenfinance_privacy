// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test, Vm} from "forge-std/Test.sol";

import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from
    "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {AgentAccount} from "../../src/AgentAccount.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {IAgentAccount} from "../../src/interfaces/IAgentAccount.sol";
import {IZkVerifier} from "../../src/interfaces/IZkVerifier.sol";

import {MockPool} from "../mocks/MockPool.sol";
import {MockHfChecker} from "../mocks/MockHfChecker.sol";

/// @title AgentAccount integration test
/// @notice Day-7 spec tests T-7.1 .. T-7.4 (subsystem_test.md §7).
/// @dev Uses the real eth-infinitism EntryPoint v0.7.0 deployed locally,
///      so the validateUserOp path exercises the full v0.7.0 contract.
contract AgentAccountTest is Test {
    using MessageHashUtils for bytes32;

    EntryPoint internal entryPoint;
    PolicyRegistry internal registry;
    AgentAccount internal account;
    MockPool internal pool;
    MockHfChecker internal hfChecker;

    address internal ownerAddr;
    uint256 internal ownerPk;
    address internal agentAddr;
    uint256 internal agentPk;

    uint8 internal constant ASSET_USDC = 1;
    uint8 internal constant ASSET_DAI = 2;
    uint128 internal constant CAP_USDC = 500_000e6; // $500k @ 6dp
    uint16 internal constant HF_FLOOR_BPS = 20_000; // 2.0

    uint256 internal policyId;
    uint256 internal sessionId;

    function setUp() public {
        (ownerAddr, ownerPk) = makeAddrAndKey("owner");
        (agentAddr, agentPk) = makeAddrAndKey("agent");

        entryPoint = new EntryPoint();
        registry = new PolicyRegistry(address(this));
        account = new AgentAccount(ownerAddr, address(entryPoint), address(registry));
        pool = new MockPool();
        hfChecker = new MockHfChecker();

        // Authorise the AgentAccount to charge spends against the registry.
        registry.grantRole(registry.SPENDER_ROLE(), address(account));

        // Fund the account so EntryPoint can take its prefund.
        vm.deal(address(account), 10 ether);
        // Fund the agent EOA for any direct txs (none in v0.7.0 paymaster-less
        // flow but useful for vm.prank patterns).
        vm.deal(agentAddr, 1 ether);

        policyId = _registerPolicy();
        vm.prank(ownerAddr);
        sessionId = account.createSession(agentAddr, policyId, uint64(block.timestamp + 30 days));
    }

    // ------------------------------------------------------------------
    // T-7.1 — Valid userOp accepted, spending recorded
    // ------------------------------------------------------------------
    function test_T7_1_validUserOpAcceptedAndSpendingRecorded() public {
        uint128 amount = 100_000e6;
        bytes memory innerCall = _supplyAssetCall(ASSET_USDC, amount);
        PackedUserOperation memory op = _buildOp(address(pool), 0, innerCall, sessionId, agentPk);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(address(this)));

        assertEq(
            registry.spentInCurrentEpoch(policyId, ASSET_USDC),
            amount,
            "spending row not updated"
        );
    }

    // ------------------------------------------------------------------
    // T-7.2 — Over-cap userOp rejected during validation
    // ------------------------------------------------------------------
    function test_T7_2_overCapRejected() public {
        uint128 amount = CAP_USDC + 1;
        bytes memory innerCall = _supplyAssetCall(ASSET_USDC, amount);
        PackedUserOperation memory op = _buildOp(address(pool), 0, innerCall, sessionId, agentPk);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;

        // EntryPoint wraps the inner revert in FailedOpWithRevert (or similar);
        // we just check that the op does NOT execute and no spending is recorded.
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));

        assertEq(
            registry.spentInCurrentEpoch(policyId, ASSET_USDC),
            0,
            "no spending should be recorded on rejection"
        );
    }

    // ------------------------------------------------------------------
    // T-7.3 — HF-floor breach on borrow rejected
    // ------------------------------------------------------------------
    function test_T7_3_hfFloorBreachRejected() public {
        // Wire the HF checker; report 1.8 (18000 bps) which is below the
        // policy's 2.0 floor → AgentAccount.HfFloorBreached.
        vm.prank(ownerAddr);
        account.setHfChecker(address(hfChecker));
        hfChecker.setHfBps(18_000);

        bytes memory innerCall = _borrowCall(ASSET_USDC, 50_000e6);
        PackedUserOperation memory op = _buildOp(address(pool), 0, innerCall, sessionId, agentPk);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;

        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));

        // Sanity: same op succeeds when HF is at floor.
        hfChecker.setHfBps(20_000);
        op = _buildOp(address(pool), 0, innerCall, sessionId, agentPk); // re-sign for new nonce-equivalent state
        ops[0] = op;
        entryPoint.handleOps(ops, payable(address(this)));
        assertEq(registry.spentInCurrentEpoch(policyId, ASSET_USDC), 50_000e6);
    }

    // ------------------------------------------------------------------
    // T-7.4 — Session revocation is instant
    // ------------------------------------------------------------------
    function test_T7_4_revocationIsInstant() public {
        // Pre-revocation: a normal op succeeds.
        bytes memory innerCall = _supplyAssetCall(ASSET_USDC, 1_000e6);
        PackedUserOperation memory op = _buildOp(address(pool), 0, innerCall, sessionId, agentPk);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(address(this)));

        // Revoke; next op MUST fail.
        vm.prank(ownerAddr);
        account.revokeSession(sessionId);

        bytes memory innerCall2 = _supplyAssetCall(ASSET_USDC, 1_000e6);
        PackedUserOperation memory op2 =
            _buildOp(address(pool), 0, innerCall2, sessionId, agentPk);
        ops[0] = op2;
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _registerPolicy() internal returns (uint256) {
        address[] memory contracts = new address[](1);
        contracts[0] = address(pool);
        bytes4[] memory sels = new bytes4[](2);
        sels[0] = MockPool.supplyAsset.selector;
        sels[1] = MockPool.borrow.selector;

        IPolicyRegistry.AssetBudget[] memory budgets =
            new IPolicyRegistry.AssetBudget[](1);
        budgets[0] = IPolicyRegistry.AssetBudget({
            assetId: ASSET_USDC,
            capPerEpoch: CAP_USDC,
            hfFloorBps: HF_FLOOR_BPS
        });

        IPolicyRegistry.Policy memory p = IPolicyRegistry.Policy({
            owner: ownerAddr,
            nameHash: keccak256("agent-policy-v1"),
            allowedContracts: contracts,
            allowedSelectors: sels,
            assetBudgets: budgets,
            epochSeconds: 1 days,
            globalHfFloorBps: HF_FLOOR_BPS,
            expiresAt: uint64(block.timestamp + 30 days),
            requireConfirmation: false
        });

        bytes32 digest = registry.digestOf(p);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        return registry.register(p, sig);
    }

    function _supplyAssetCall(uint8 assetId, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        IZkVerifier.AggregationProof memory proof = IZkVerifier.AggregationProof({
            domainId: 1,
            aggregationId: 1,
            leaf: bytes32(0),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: 0
        });
        return abi.encodeCall(
            MockPool.supplyAsset,
            (assetId, bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), amount, proof)
        );
    }

    function _borrowCall(uint8 assetId, uint256 amount) internal pure returns (bytes memory) {
        IZkVerifier.AggregationProof memory proof = IZkVerifier.AggregationProof({
            domainId: 1,
            aggregationId: 1,
            leaf: bytes32(0),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: 0
        });
        return abi.encodeCall(
            MockPool.borrow,
            (
                assetId,
                bytes32(uint256(11)),
                bytes32(uint256(12)),
                bytes32(uint256(13)),
                amount,
                bytes32(uint256(14)),
                proof
            )
        );
    }

    /// @dev Builds a v0.7.0 PackedUserOperation that calls
    ///      `account.execute(target, value, innerCall)`, signed by `signerPk`
    ///      with the given sessionId. The returned op carries a valid v4337
    ///      `accountGasLimits` and `gasFees` packing.
    function _buildOp(
        address target,
        uint256 value,
        bytes memory innerCall,
        uint256 sid,
        uint256 signerPk
    ) internal view returns (PackedUserOperation memory op) {
        bytes memory outer =
            abi.encodeCall(IAgentAccount.execute, (target, value, innerCall));

        op = PackedUserOperation({
            sender: address(account),
            nonce: entryPoint.getNonce(address(account), 0),
            initCode: bytes(""),
            callData: outer,
            // accountGasLimits packs (verificationGasLimit << 128) | callGasLimit
            accountGasLimits: bytes32((uint256(500_000) << 128) | uint256(1_000_000)),
            preVerificationGas: 100_000,
            // gasFees packs (maxPriorityFeePerGas << 128) | maxFeePerGas
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(2 gwei)),
            paymasterAndData: bytes(""),
            signature: bytes("")
        });
        bytes32 opHash = entryPoint.getUserOpHash(op);
        bytes32 ethSigned = opHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethSigned);
        op.signature = abi.encode(sid, abi.encodePacked(r, s, v));
    }

    receive() external payable {}
}
