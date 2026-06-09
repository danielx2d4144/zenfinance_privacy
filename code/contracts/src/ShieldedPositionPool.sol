// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IPrivacyEntry} from "./interfaces/IPrivacyEntry.sol";
import {IRateModel} from "./interfaces/IRateModel.sol";
import {IShieldedPositionPool} from "./interfaces/IShieldedPositionPool.sol";
import {IZkVerifier} from "./interfaces/IZkVerifier.sol";
import {PoseidonIMT} from "./libraries/PoseidonIMT.sol";

/// @title ShieldedPositionPool
/// @notice Holds the Merkle tree of multi-slot position commitments.
///         Each position commitment encodes per-asset collaterals + debts
///         + borrowIndices snapshot (S02 §3). Health-factor check happens
///         **inside the ZK circuit** -- this contract verifies the proof
///         and updates per-asset aggregates only.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (ShieldedPositionPool)
///            design-v2/subsystems/02_zk_circuits.md §3, §4, §5
///      Day 14c Stage C: keccak hash-chain swapped for the depth-20
///      Poseidon2 IMT in `libraries/PoseidonIMT.sol`.
contract ShieldedPositionPool is
    IShieldedPositionPool,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    using PoseidonIMT for PoseidonIMT.State;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    IAssetRegistry public immutable assetRegistry;
    IRateModel public immutable rateModel;
    IPrivacyEntry public immutable privacyEntry;
    IZkVerifier public immutable verifier;

    mapping(uint8 => uint256) private _totalCollateralPerAsset;
    mapping(uint8 => uint256) private _totalBorrowPerAsset;
    mapping(bytes32 => bool) private _spent;
    mapping(bytes32 => bool) private _committed;

    PoseidonIMT.State private _imt;

    error ZeroAddress();
    error ZeroAmount();
    error AssetNotEnabled(uint8 assetId);
    error AssetNotCollateralizable(uint8 assetId);
    error AssetNotBorrowable(uint8 assetId);
    error NullifierAlreadySpent(bytes32 nullifier);
    error UnknownRoot();
    error CommitmentAlreadyInserted(bytes32 commitment);
    error PositionDoesNotExist();

    constructor(
        address admin,
        address assetRegistry_,
        address rateModel_,
        address privacyEntry_,
        address verifier_
    ) {
        if (
            admin == address(0) || assetRegistry_ == address(0)
                || rateModel_ == address(0) || privacyEntry_ == address(0)
                || verifier_ == address(0)
        ) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        assetRegistry = IAssetRegistry(assetRegistry_);
        rateModel = IRateModel(rateModel_);
        privacyEntry = IPrivacyEntry(privacyEntry_);
        verifier = IZkVerifier(verifier_);
        _imt.init();
    }

    /// @notice Add collateral to a position (or create one). Consumes a
    ///         balance note in PrivacyEntry, replaces oldPositionCommitment
    ///         with newPositionCommitment.
    /// @dev oldPositionNullifier == bytes32(0) signals first-time position
    ///      creation; the circuit accepts that as a fresh-position witness.
    function depositCollateral(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        if (!cfg.collateralizable) revert AssetNotCollateralizable(assetId);
        if (amount == 0) revert ZeroAmount();
        if (newPositionCommitment == bytes32(0)) revert ZeroAmount();
        // balanceNullifier double-spend is caught by PrivacyEntry's own
        // nullifier set via spendBalance below.

        if (oldPositionNullifier != bytes32(0)) {
            if (_spent[oldPositionNullifier]) revert NullifierAlreadySpent(oldPositionNullifier);
            if (!_imt.known(rootAtProveTime)) revert UnknownRoot();
        }

        _accrueAll();
        _verify(IZkVerifier.CircuitId.DEPOSIT_COLLATERAL, proof);

        if (oldPositionNullifier != bytes32(0)) {
            _spent[oldPositionNullifier] = true;
        }
        privacyEntry.spendBalance(
            balanceNullifier, residualBalanceCommitment, newPositionCommitment
        );
        uint32 leafIdx = _insertCommitment(newPositionCommitment);

        uint256 newTotal = _totalCollateralPerAsset[assetId] + amount;
        _totalCollateralPerAsset[assetId] = newTotal;

        emit CollateralDeposited(assetId, amount);
        emit PositionUpdated(oldPositionNullifier, newPositionCommitment, leafIdx);
    }

    /// @notice Reduce collateral, credit a balance note in PrivacyEntry.
    function withdrawCollateral(
        uint8 assetId,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (newPositionCommitment == bytes32(0)) revert ZeroAmount();
        if (newBalanceCommitment == bytes32(0)) revert ZeroAmount();
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        if (_spent[oldPositionNullifier]) revert NullifierAlreadySpent(oldPositionNullifier);
        if (!_imt.known(rootAtProveTime)) revert UnknownRoot();

        _accrueAll();
        _verify(IZkVerifier.CircuitId.WITHDRAW_COLLATERAL, proof);

        _spent[oldPositionNullifier] = true;
        uint32 leafIdx = _insertCommitment(newPositionCommitment);
        privacyEntry.creditBalance(newBalanceCommitment);

        uint256 prev = _totalCollateralPerAsset[assetId];
        _totalCollateralPerAsset[assetId] = prev >= amount ? prev - amount : 0;

        emit CollateralWithdrawn(assetId, amount);
        emit PositionUpdated(oldPositionNullifier, newPositionCommitment, leafIdx);
    }

    /// @notice Increase debt in `assetId`, credit a balance note for the
    ///         borrowed amount in PrivacyEntry. HF (against LTV) checked
    ///         inside the circuit per S02 §5.
    function borrow(
        uint8 assetId,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (newPositionCommitment == bytes32(0)) revert ZeroAmount();
        if (newBalanceCommitment == bytes32(0)) revert ZeroAmount();
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        if (!cfg.borrowable) revert AssetNotBorrowable(assetId);
        if (_spent[oldPositionNullifier]) revert NullifierAlreadySpent(oldPositionNullifier);
        if (!_imt.known(rootAtProveTime)) revert UnknownRoot();

        _accrueAll();
        // BORROW circuit asserts HF >= 1.0 against LTV; if the user tries
        // an over-LTV borrow, the prover refuses to produce a valid proof,
        // and our mock verifier returns false -> ZkVerifier reverts.
        _verify(IZkVerifier.CircuitId.BORROW, proof);

        _spent[oldPositionNullifier] = true;
        uint32 leafIdx = _insertCommitment(newPositionCommitment);
        privacyEntry.creditBalance(newBalanceCommitment);

        uint256 newBorrow = _totalBorrowPerAsset[assetId] + amount;
        _totalBorrowPerAsset[assetId] = newBorrow;
        _pushBorrowTotal(assetId, newBorrow);

        emit Borrowed(assetId, amount);
        emit PositionUpdated(oldPositionNullifier, newPositionCommitment, leafIdx);
    }

    /// @notice Reduce debt in `assetId`, consuming a balance note in PrivacyEntry.
    function repay(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (newPositionCommitment == bytes32(0)) revert ZeroAmount();
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        // balanceNullifier checked by PrivacyEntry.spendBalance.
        if (_spent[oldPositionNullifier]) revert NullifierAlreadySpent(oldPositionNullifier);
        if (!_imt.known(rootAtProveTime)) revert UnknownRoot();

        _accrueAll();
        _verify(IZkVerifier.CircuitId.REPAY, proof);

        _spent[oldPositionNullifier] = true;
        privacyEntry.spendBalance(
            balanceNullifier, residualBalanceCommitment, newPositionCommitment
        );
        uint32 leafIdx = _insertCommitment(newPositionCommitment);

        uint256 prev = _totalBorrowPerAsset[assetId];
        uint256 newBorrow = prev >= amount ? prev - amount : 0;
        _totalBorrowPerAsset[assetId] = newBorrow;
        _pushBorrowTotal(assetId, newBorrow);

        emit Repaid(assetId, amount);
        emit PositionUpdated(oldPositionNullifier, newPositionCommitment, leafIdx);
    }

    /// @notice LIQUIDATOR_ROLE-only: applied by LiquidationBoard after a
    ///         liquidate proof verifies. Consumes the target position
    ///         nullifier, inserts the residual commitment, and decrements
    ///         per-asset aggregates.
    function applyLiquidation(
        uint8 collateralAsset,
        uint8 debtAsset,
        bytes32 oldPositionNullifier,
        bytes32 newPositionCommitment,
        uint256 collateralSeized,
        uint256 debtCovered
    ) external onlyRole(LIQUIDATOR_ROLE) whenNotPaused {
        if (newPositionCommitment == bytes32(0)) revert ZeroAmount();
        if (_spent[oldPositionNullifier]) revert NullifierAlreadySpent(oldPositionNullifier);

        _spent[oldPositionNullifier] = true;
        uint32 leafIdx = _insertCommitment(newPositionCommitment);

        if (collateralSeized > 0) {
            uint256 prev = _totalCollateralPerAsset[collateralAsset];
            _totalCollateralPerAsset[collateralAsset] =
                prev >= collateralSeized ? prev - collateralSeized : 0;
        }
        if (debtCovered > 0) {
            uint256 prevDebt = _totalBorrowPerAsset[debtAsset];
            uint256 newDebt = prevDebt >= debtCovered ? prevDebt - debtCovered : 0;
            _totalBorrowPerAsset[debtAsset] = newDebt;
            _pushBorrowTotal(debtAsset, newDebt);
        }

        emit CollateralWithdrawn(collateralAsset, collateralSeized);
        emit Repaid(debtAsset, debtCovered);
        emit PositionUpdated(oldPositionNullifier, newPositionCommitment, leafIdx);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function totalCollateralPerAsset(uint8 assetId) external view returns (uint256) {
        return _totalCollateralPerAsset[assetId];
    }

    function totalBorrowPerAsset(uint8 assetId) external view returns (uint256) {
        return _totalBorrowPerAsset[assetId];
    }

    function isSpent(bytes32 nullifier) external view returns (bool) {
        return _spent[nullifier];
    }

    function currentRoot() external view returns (bytes32) {
        return _imt.currentRoot;
    }

    function knownRoot(bytes32 root) external view returns (bool) {
        return _imt.known(root);
    }

    function nextLeafIndex() external view returns (uint32) {
        return _imt.nextLeafIndex;
    }

    function _verify(IZkVerifier.CircuitId cid, IZkVerifier.AggregationProof calldata p) private {
        bytes32 expectedVk = verifier.vkHash(uint8(cid));
        verifier.verifyAndConsume(uint8(cid), expectedVk, p);
    }

    function _accrueAll() private {
        // Accrue every enabled asset so the circuit's snapshot indices
        // match on-chain at proof verification time (S14 §5.1).
        uint8 n = assetRegistry.numAssets();
        for (uint8 i = 0; i < n; ++i) {
            if (assetRegistry.assets(i).enabled) {
                rateModel.accrue(i);
            }
        }
    }

    function _pushBorrowTotal(uint8 assetId, uint256 newBorrow) private {
        IRateModel.AssetRateState memory s = rateModel.state(assetId);
        rateModel.setTotals(assetId, s.totalSupply, _safe128(newBorrow));
    }

    function _insertCommitment(bytes32 commitment) private returns (uint32) {
        if (_committed[commitment]) revert CommitmentAlreadyInserted(commitment);
        _committed[commitment] = true;

        (uint32 idx, bytes32 newRoot) = _imt.insert(commitment);
        emit MerkleRootUpdated(newRoot, idx + 1);
        return idx;
    }

    function _safe128(uint256 v) private pure returns (uint128) {
        require(v <= type(uint128).max, "overflow128");
        return uint128(v);
    }
}
