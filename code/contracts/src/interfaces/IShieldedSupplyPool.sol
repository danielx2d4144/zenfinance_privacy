// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IZkVerifier} from "./IZkVerifier.sol";

/// @title IShieldedSupplyPool
/// @notice User-facing surface of the supply pool.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (ShieldedSupplyPool)
///            design-v2/subsystems/02_zk_circuits.md §2 (circuits 04, 05)
///      Holds a Merkle tree of supply-note commitments per asset, plus a
///      spent-nullifier set. All token custody lives in PrivacyEntry; this
///      contract only mints/consumes commitments and updates RateModel
///      aggregates.
interface IShieldedSupplyPool {
    event SupplyDeposited(
        uint8 indexed assetId,
        uint32 leafIndex,
        bytes32 supplyCommitment,
        uint256 amount
    );
    event SupplyWithdrawn(
        uint8 indexed assetId,
        bytes32 indexed supplyNullifier,
        uint256 amount
    );
    event MerkleRootUpdated(bytes32 newRoot, uint32 nextLeafIndex);

    function supplyAsset(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 supplyCommitment,
        uint256 amount,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    function withdrawSupply(
        uint8 assetId,
        bytes32 supplyNullifier,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    function totalSupplyPerAsset(uint8 assetId) external view returns (uint256);

    function isSpent(bytes32 nullifier) external view returns (bool);

    function currentRoot() external view returns (bytes32);

    function knownRoot(bytes32 root) external view returns (bool);

    function nextLeafIndex() external view returns (uint32);
}
