// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IInsuranceFund} from "./interfaces/IInsuranceFund.sol";
import {ILiquidationBoard} from "./interfaces/ILiquidationBoard.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IPrivacyEntry} from "./interfaces/IPrivacyEntry.sol";
import {IShieldedPositionPool} from "./interfaces/IShieldedPositionPool.sol";
import {IZkVerifier} from "./interfaces/IZkVerifier.sol";

/// @title LiquidationBoard
/// @notice Public per-position trigger registry + Aave-style liquidation.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (LiquidationBoard)
///            design-v2/subsystems/02_zk_circuits.md §6 (trigger derivation)
///      Close-factor logic per S01 §3:
///        - HF < closeFactorHfThresholdBps (default 9500 = 0.95) → 100% close factor
///        - else → 50% close factor
///      Bonus split per S01 §3:
///        - liquidationBonusBps (e.g. 800 = 8% for cbBTC) total bonus
///        - protocolFeeOfBonusBps (e.g. 3750 = 37.5% of bonus) → InsuranceFund
///        - remainder → liquidator
contract LiquidationBoard is ILiquidationBoard, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant DEFAULT_CLOSE_FACTOR_BPS = 5_000; // 50%
    uint16 public constant FULL_CLOSE_FACTOR_BPS = 10_000; // 100%

    IAssetRegistry public immutable assetRegistry;
    IOracle public immutable oracle;
    IPrivacyEntry public immutable privacyEntry;
    IShieldedPositionPool public immutable positionPool;
    IInsuranceFund public immutable insuranceFund;
    IZkVerifier public immutable verifier;

    PositionInfo[] private _positions;
    mapping(bytes32 => uint256) private _idx; // 1-indexed; 0 = absent

    error ZeroAddress();
    error ZeroAmount();
    error UnknownPosition(bytes32 commitment);
    error PositionInactive(bytes32 commitment);
    error AssetNotEnabled(uint8 assetId);
    error InvalidHealthFactor(uint16 hfBps);
    error InvalidLiquidatorCommitment();

    constructor(
        address admin,
        address assetRegistry_,
        address oracle_,
        address privacyEntry_,
        address positionPool_,
        address insuranceFund_,
        address verifier_
    ) {
        if (
            admin == address(0) || assetRegistry_ == address(0)
                || oracle_ == address(0) || privacyEntry_ == address(0)
                || positionPool_ == address(0) || insuranceFund_ == address(0)
                || verifier_ == address(0)
        ) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        assetRegistry = IAssetRegistry(assetRegistry_);
        oracle = IOracle(oracle_);
        privacyEntry = IPrivacyEntry(privacyEntry_);
        positionPool = IShieldedPositionPool(positionPool_);
        insuranceFund = IInsuranceFund(insuranceFund_);
        verifier = IZkVerifier(verifier_);
    }

    /// @notice REGISTRAR_ROLE-only: position pool calls this when a borrow
    ///         / withdrawCollateral / repay updates a position's triggers.
    function registerPosition(
        bytes32 commitment, LiquidationTrigger[] calldata triggers
    ) external onlyRole(REGISTRAR_ROLE) {
        if (commitment == bytes32(0)) revert ZeroAmount();
        uint256 existing = _idx[commitment];
        if (existing != 0) {
            _positions[existing - 1].triggers = triggers;
            _positions[existing - 1].lastUpdateBlock = uint64(block.number);
            _positions[existing - 1].active = true;
            emit PositionTriggersUpdated(commitment, triggers);
            return;
        }

        _positions.push();
        uint256 newIdx = _positions.length - 1;
        _positions[newIdx].commitment = commitment;
        for (uint256 i = 0; i < triggers.length; ++i) {
            _positions[newIdx].triggers.push(triggers[i]);
        }
        _positions[newIdx].lastUpdateBlock = uint64(block.number);
        _positions[newIdx].active = true;
        _idx[commitment] = newIdx + 1;
        emit PositionRegistered(commitment, triggers);
    }

    /// @notice REGISTRAR_ROLE-only: marks the position inactive.
    function removePosition(bytes32 commitment) external onlyRole(REGISTRAR_ROLE) {
        uint256 i = _idx[commitment];
        if (i == 0) revert UnknownPosition(commitment);
        _positions[i - 1].active = false;
        emit PositionRemoved(commitment);
    }

    /// @notice Liquidate an unhealthy position. Anyone may call.
    /// @param currentHealthFactorBps  HF reported in bps (10000 = 1.0). The
    ///        circuit-verified proof binds this to the position's current
    ///        state via public inputs; contract uses it to pick the close
    ///        factor only.
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
    ) external nonReentrant whenNotPaused {
        if (debtToCover == 0) revert ZeroAmount();
        if (liquidatorBalanceCommitment == bytes32(0)) revert InvalidLiquidatorCommitment();
        if (currentHealthFactorBps >= BPS_DENOMINATOR) revert InvalidHealthFactor(currentHealthFactorBps);

        uint256 i = _idx[targetCommitment];
        if (i == 0) revert UnknownPosition(targetCommitment);
        if (!_positions[i - 1].active) revert PositionInactive(targetCommitment);

        IAssetRegistry.AssetConfig memory collCfg = assetRegistry.assets(collateralAsset);
        if (!collCfg.enabled) revert AssetNotEnabled(collateralAsset);
        if (!assetRegistry.assets(debtAsset).enabled) revert AssetNotEnabled(debtAsset);

        // Verify proof.
        bytes32 expectedVk = verifier.vkHash(uint8(IZkVerifier.CircuitId.LIQUIDATE));
        verifier.verifyAndConsume(uint8(IZkVerifier.CircuitId.LIQUIDATE), expectedVk, proof);

        // Compute USD-denominated seizure and bonus split.
        Seizure memory s = _computeSeizure(collateralAsset, debtAsset, debtToCover, collCfg);

        // Apply state changes. Pulled into a helper so this function's
        // stack stays under the via-IR limit.
        _applyLiquidation(
            ApplyArgs({
                targetCommitment: targetCommitment,
                residualCommitment: residualCommitment,
                liquidatorBalanceCommitment: liquidatorBalanceCommitment,
                positionIdx: i - 1,
                collateralAsset: collateralAsset,
                debtAsset: debtAsset,
                debtToCover: debtToCover,
                token: collCfg.token,
                s: s,
                newTriggers: newTriggers
            })
        );
    }

    struct ApplyArgs {
        bytes32 targetCommitment;
        bytes32 residualCommitment;
        bytes32 liquidatorBalanceCommitment;
        uint256 positionIdx;
        uint8 collateralAsset;
        uint8 debtAsset;
        uint128 debtToCover;
        address token;
        Seizure s;
        LiquidationTrigger[] newTriggers;
    }

    struct Seizure {
        uint256 collateralSeized;
        uint256 liquidatorBonusUsd1e8;
        uint256 insuranceShareUsd1e8;
        uint256 insuranceShareCollateralUnits;
    }

    function _applyLiquidation(ApplyArgs memory a) private {
        // 1. position pool: spend old position, insert residual, update aggregates.
        positionPool.applyLiquidation(
            a.collateralAsset,
            a.debtAsset,
            _positionNullifierOf(a.targetCommitment, a.positionIdx),
            a.residualCommitment,
            a.s.collateralSeized,
            a.debtToCover
        );

        // 2. PrivacyEntry: credit liquidator's seized collateral as a balance note.
        privacyEntry.creditBalance(a.liquidatorBalanceCommitment);

        // 3. PrivacyEntry: pay the protocol's bonus share to InsuranceFund.
        if (a.s.insuranceShareCollateralUnits > 0) {
            privacyEntry.payToInsurance(
                a.token, a.s.insuranceShareCollateralUnits, address(insuranceFund)
            );
            insuranceFund.notifyReceived(a.collateralAsset, a.s.insuranceShareCollateralUnits);
        }

        // 4. registry: mark old entry inactive; record residual as a new entry.
        _positions[a.positionIdx].active = false;
        if (a.residualCommitment != bytes32(0)) {
            _positions.push();
            uint256 newIdx = _positions.length - 1;
            _positions[newIdx].commitment = a.residualCommitment;
            for (uint256 j = 0; j < a.newTriggers.length; ++j) {
                _positions[newIdx].triggers.push(a.newTriggers[j]);
            }
            _positions[newIdx].lastUpdateBlock = uint64(block.number);
            _positions[newIdx].active = true;
            _idx[a.residualCommitment] = newIdx + 1;
        }

        emit PositionLiquidated(
            a.targetCommitment,
            msg.sender,
            a.collateralAsset,
            a.debtAsset,
            a.s.collateralSeized,
            a.debtToCover,
            a.s.liquidatorBonusUsd1e8,
            a.s.insuranceShareUsd1e8
        );
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positionAt(uint256 idx) external view returns (PositionInfo memory) {
        return _positions[idx];
    }

    function positionByCommitment(bytes32 commitment)
        external
        view
        returns (PositionInfo memory)
    {
        uint256 i = _idx[commitment];
        if (i == 0) revert UnknownPosition(commitment);
        return _positions[i - 1];
    }

    /// @notice Compute close-factor for an HF, exposed for tests and tooling.
    function closeFactorBpsFor(uint8 collateralAsset, uint16 hfBps)
        external
        view
        returns (uint16)
    {
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(collateralAsset);
        return hfBps < cfg.closeFactorHfThresholdBps
            ? FULL_CLOSE_FACTOR_BPS
            : DEFAULT_CLOSE_FACTOR_BPS;
    }

    function _computeSeizure(
        uint8 collateralAsset,
        uint8 debtAsset,
        uint128 debtToCover,
        IAssetRegistry.AssetConfig memory collCfg
    ) private view returns (Seizure memory s) {
        IAssetRegistry.AssetConfig memory debtCfg = assetRegistry.assets(debtAsset);
        uint256 debtPrice1e8 = oracle.getPrice(debtAsset);
        uint256 collPrice1e8 = oracle.getPrice(collateralAsset);

        uint256 debtValueUsd1e8 =
            (uint256(debtToCover) * debtPrice1e8) / (10 ** debtCfg.decimals);

        uint256 bonusValueUsd1e8 =
            (debtValueUsd1e8 * collCfg.liquidationBonusBps) / BPS_DENOMINATOR;

        uint256 seizedValueUsd1e8 = debtValueUsd1e8 + bonusValueUsd1e8;
        s.collateralSeized =
            (seizedValueUsd1e8 * (10 ** collCfg.decimals)) / collPrice1e8;

        s.insuranceShareUsd1e8 =
            (bonusValueUsd1e8 * collCfg.protocolFeeOfBonusBps) / BPS_DENOMINATOR;
        s.liquidatorBonusUsd1e8 = bonusValueUsd1e8 - s.insuranceShareUsd1e8;
        s.insuranceShareCollateralUnits =
            (s.insuranceShareUsd1e8 * (10 ** collCfg.decimals)) / collPrice1e8;
    }

    /// @dev The "nullifier" for a position is its commitment under the
    ///      Day-3 placeholder mapping. On Day 6 the circuit-side nullifier
    ///      derivation replaces this; the registry still keys by commitment
    ///      so external API is stable.
    function _positionNullifierOf(bytes32 commitment, uint256 /*idx*/ )
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("position-nullifier", commitment));
    }
}
