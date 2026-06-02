// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IZkVerifier} from "./IZkVerifier.sol";

/// @title IShieldedPositionPool
/// @notice User-facing surface of the multi-asset position pool.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (ShieldedPositionPool)
///            design-v2/subsystems/02_zk_circuits.md §2 (circuits 06-09)
///      Health-factor and per-slot accrual checks happen **inside the ZK
///      circuit**; this contract only verifies the proof and updates
///      aggregates. See S02 §4 — the contract never sees per-slot amounts.
interface IShieldedPositionPool {
    event PositionUpdated(
        bytes32 indexed oldNullifier,
        bytes32 indexed newCommitment,
        uint32 leafIndex
    );
    event CollateralDeposited(uint8 indexed assetId, uint256 amount);
    event CollateralWithdrawn(uint8 indexed assetId, uint256 amount);
    event Borrowed(uint8 indexed assetId, uint256 amount);
    event Repaid(uint8 indexed assetId, uint256 amount);
    event MerkleRootUpdated(bytes32 newRoot, uint32 nextLeafIndex);

    function depositCollateral(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    function withdrawCollateral(
        uint8 assetId,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    function borrow(
        uint8 assetId,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    function repay(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    /// @notice LIQUIDATOR_ROLE-only: applied by LiquidationBoard after a
    ///         liquidation proof verifies. Atomic seize+repay update.
    function applyLiquidation(
        uint8 collateralAsset,
        uint8 debtAsset,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 collateralSeized,
        uint256 debtCovered
    ) external;

    function totalCollateralPerAsset(uint8 assetId) external view returns (uint256);

    function totalBorrowPerAsset(uint8 assetId) external view returns (uint256);

    function isSpent(bytes32 nullifier) external view returns (bool);

    function currentRoot() external view returns (bytes32);

    function knownRoot(bytes32 root) external view returns (bool);

    function nextLeafIndex() external view returns (uint32);
}
