// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IZkVerifier, IVerifyProofAggregation} from "./interfaces/IZkVerifier.sol";

/// @title ZkVerifier
/// @notice Per-circuit vk-pinning + on-chain anti-replay around the
///         zkVerify aggregation proxy.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §2 (ZkVerifier)
///            design-v2/subsystems/04_attestation_pipeline.md §3
///      Each circuit has a fixed `vkHash` set in the constructor.
///      Pool callers must pass the `expectedVkHash` they were built
///      against — guarantees that an admin who silently rotates a vk
///      cannot retroactively make stale proofs verify under a new vk.
///      (vkHash is `immutable` per circuitId in this v1 contract: rotating
///      requires a new ZkVerifier deployment + Safe-driven pointer swap
///      in pool contracts; no in-place mutation surface exists.)
contract ZkVerifier is IZkVerifier, AccessControl {
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    IVerifyProofAggregation public immutable proxy;

    /// @notice Number of circuit slots reserved (must match CircuitId enum size).
    uint8 public constant NUM_CIRCUITS = 11;

    bytes32[NUM_CIRCUITS] private _vkHashes;

    /// @dev Replay defence: a (domainId, aggId, leafIndex) tuple cannot be
    ///      consumed twice. This is in addition to any per-pool nullifier
    ///      sets — a single proof verifying twice into two pools would
    ///      otherwise be a generic re-entry vector.
    mapping(uint256 domainId => mapping(uint256 aggId => mapping(uint256 leafIndex => bool)))
        private _consumed;

    error ZeroAddress();
    error VkHashMismatch(uint8 circuitId, bytes32 expected, bytes32 actual);
    error VkHashUnset(uint8 circuitId);
    error AlreadyConsumed(uint256 domainId, uint256 aggId, uint256 leafIndex);
    error InvalidCircuitId(uint8 circuitId);
    error AggregationVerifyFailed();
    error VkHashLengthMismatch(uint256 expected, uint256 actual);

    constructor(address admin, address proxy_, bytes32[] memory vkHashesPerCircuit) {
        if (admin == address(0)) revert ZeroAddress();
        if (proxy_ == address(0)) revert ZeroAddress();
        if (vkHashesPerCircuit.length != NUM_CIRCUITS) {
            revert VkHashLengthMismatch(NUM_CIRCUITS, vkHashesPerCircuit.length);
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        proxy = IVerifyProofAggregation(proxy_);

        for (uint256 i = 0; i < NUM_CIRCUITS; ++i) {
            _vkHashes[i] = vkHashesPerCircuit[i];
        }
    }

    /// @notice Verify an aggregated proof and consume its replay slot.
    /// @dev Reverts on:
    ///        - circuitId out of range
    ///        - expectedVkHash mismatch with the pinned hash
    ///        - tuple already consumed
    ///        - proxy returning false
    ///      Returns `true` on success so callers can use the boolean form
    ///      without ignoring it.
    function verifyAndConsume(
        uint8 circuitId,
        bytes32 expectedVkHash,
        AggregationProof calldata proof
    ) external onlyRole(CALLER_ROLE) returns (bool) {
        if (circuitId >= NUM_CIRCUITS) revert InvalidCircuitId(circuitId);

        bytes32 pinned = _vkHashes[circuitId];
        if (pinned == bytes32(0)) revert VkHashUnset(circuitId);
        if (pinned != expectedVkHash) {
            revert VkHashMismatch(circuitId, expectedVkHash, pinned);
        }

        if (_consumed[proof.domainId][proof.aggregationId][proof.leafIndex]) {
            revert AlreadyConsumed(proof.domainId, proof.aggregationId, proof.leafIndex);
        }

        bool ok = proxy.verifyProofAggregation(
            proof.domainId,
            proof.aggregationId,
            proof.leaf,
            proof.merklePath,
            proof.leafCount,
            proof.leafIndex
        );
        if (!ok) revert AggregationVerifyFailed();

        _consumed[proof.domainId][proof.aggregationId][proof.leafIndex] = true;

        emit ProofConsumed(circuitId, proof.domainId, proof.aggregationId, proof.leafIndex);
        return true;
    }

    function vkHash(uint8 circuitId) external view returns (bytes32) {
        if (circuitId >= NUM_CIRCUITS) revert InvalidCircuitId(circuitId);
        return _vkHashes[circuitId];
    }

    function isConsumed(uint256 domainId, uint256 aggregationId, uint256 leafIndex)
        external
        view
        returns (bool)
    {
        return _consumed[domainId][aggregationId][leafIndex];
    }
}
