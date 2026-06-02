// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IZkVerifier
/// @notice Wraps zkVerify's IVerifyProofAggregation with per-circuit
///         vkHash pinning + (domainId, aggId, leafIndex) anti-replay.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §2 (ZkVerifier)
///            design-v2/subsystems/04_attestation_pipeline.md §3 (verifier interface)
///      `circuitId` is the protocol-side enum discriminator over the 11 v1
///      circuits (S02). vkHash[circuitId] is set at construction and
///      never mutates — re-keying ships as a new contract version.
interface IZkVerifier {
    enum CircuitId {
        ENTRY_DEPOSIT,
        ENTRY_WITHDRAW,
        SUPPLY_ASSET,
        WITHDRAW_SUPPLY,
        DEPOSIT_COLLATERAL,
        WITHDRAW_COLLATERAL,
        BORROW,
        REPAY,
        LIQUIDATE,
        CONSOLIDATE_BALANCE,
        COMPUTE_TRIGGERS
    }

    struct AggregationProof {
        uint256 domainId;
        uint256 aggregationId;
        bytes32 leaf;
        bytes32[] merklePath;
        uint256 leafCount;
        uint256 leafIndex;
    }

    event ProofConsumed(
        uint8 indexed circuitId,
        uint256 indexed domainId,
        uint256 indexed aggregationId,
        uint256 leafIndex
    );

    function vkHash(uint8 circuitId) external view returns (bytes32);

    function isConsumed(uint256 domainId, uint256 aggregationId, uint256 leafIndex)
        external
        view
        returns (bool);

    function verifyAndConsume(
        uint8 circuitId,
        bytes32 expectedVkHash,
        AggregationProof calldata proof
    ) external returns (bool);
}

/// @notice The on-chain verifier proxy provided by zkVerify on the host
///         chain (Horizen). Address is wired at Day 8 wiring; ABI is
///         stable today.
interface IVerifyProofAggregation {
    function verifyProofAggregation(
        uint256 domainId,
        uint256 aggregationId,
        bytes32 leaf,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 leafIndex
    ) external view returns (bool);
}
