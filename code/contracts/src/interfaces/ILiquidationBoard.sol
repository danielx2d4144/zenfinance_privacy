// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IZkVerifier} from "./IZkVerifier.sol";

/// @title ILiquidationBoard
/// @notice Per-position liquidation triggers + Aave-style `liquidate` entry.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (LiquidationBoard)
///            design-v2/subsystems/02_zk_circuits.md §6 (trigger derivation)
///      Close factor and bonus split logic per S01 §3.
interface ILiquidationBoard {
    struct LiquidationTrigger {
        uint8 assetId;
        uint128 priceThresholdUsd1e8;
    }

    struct PositionInfo {
        bytes32 commitment;
        LiquidationTrigger[] triggers;
        uint64 lastUpdateBlock;
        bool active;
    }

    event PositionRegistered(
        bytes32 indexed commitment, LiquidationTrigger[] triggers
    );
    event PositionTriggersUpdated(
        bytes32 indexed commitment, LiquidationTrigger[] triggers
    );
    event PositionRemoved(bytes32 indexed commitment);
    event PositionLiquidated(
        bytes32 indexed targetCommitment,
        address indexed liquidator,
        uint8 collateralAssetSeized,
        uint8 debtAssetRepaid,
        uint256 collateralSeized,
        uint256 debtCovered,
        uint256 liquidatorBonusUsd1e8,
        uint256 insuranceFundShareUsd1e8
    );

    function liquidate(
        bytes32 targetCommitment,
        bytes32 residualCommitment,
        bytes32 liquidatorBalanceCommitment,
        uint8 collateralAsset,
        uint8 debtAsset,
        uint128 debtToCover,
        uint16 currentHealthFactorBps,
        LiquidationTrigger[] calldata newTriggers,
        IZkVerifier.AggregationProof calldata proof
    ) external;

    /// @notice REGISTRAR_ROLE-only: positions register their triggers when
    ///         a borrow / withdrawCollateral / repay updates them.
    function registerPosition(
        bytes32 commitment, LiquidationTrigger[] calldata triggers
    ) external;

    /// @notice REGISTRAR_ROLE-only: called when a position is fully closed
    ///         (debt → 0) or replaced by a new commitment.
    function removePosition(bytes32 commitment) external;

    function positionCount() external view returns (uint256);

    function positionAt(uint256 idx) external view returns (PositionInfo memory);

    function positionByCommitment(bytes32 commitment)
        external
        view
        returns (PositionInfo memory);
}
