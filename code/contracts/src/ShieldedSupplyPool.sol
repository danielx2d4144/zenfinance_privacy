// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IPrivacyEntry} from "./interfaces/IPrivacyEntry.sol";
import {IRateModel} from "./interfaces/IRateModel.sol";
import {IShieldedSupplyPool} from "./interfaces/IShieldedSupplyPool.sol";
import {IZkVerifier} from "./interfaces/IZkVerifier.sol";
import {PoseidonIMT} from "./libraries/PoseidonIMT.sol";

/// @title ShieldedSupplyPool
/// @notice Holds the Merkle tree of supply-note commitments per asset
///         plus the spent-nullifier set. Calls into PrivacyEntry for
///         balance-note moves and into RateModel for accrual + aggregate
///         pushes.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (ShieldedSupplyPool)
///            design-v2/subsystems/14_interest_and_apys.md §6 (per-note interest)
///      Day 14c Stage C: keccak hash-chain swapped for the depth-20
///      Poseidon2 IMT in `libraries/PoseidonIMT.sol`; root layout
///      matches `lib_common::merkle_root`. Contract never sees per-user
///      amounts -- only assetId, public amount, commitments, and
///      nullifiers (per S01 §5).
contract ShieldedSupplyPool is IShieldedSupplyPool, AccessControl, ReentrancyGuard, Pausable {
    using PoseidonIMT for PoseidonIMT.State;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IAssetRegistry public immutable assetRegistry;
    IRateModel public immutable rateModel;
    IPrivacyEntry public immutable privacyEntry;
    IZkVerifier public immutable verifier;

    mapping(uint8 => uint256) private _totalSupplyPerAsset;
    mapping(bytes32 => bool) private _spent;
    mapping(bytes32 => bool) private _committed;

    PoseidonIMT.State private _imt;

    error ZeroAddress();
    error ZeroAmount();
    error AssetNotEnabled(uint8 assetId);
    error AssetNotSuppliable(uint8 assetId);
    error NullifierAlreadySpent(bytes32 nullifier);
    error UnknownRoot();
    error CommitmentAlreadyInserted(bytes32 commitment);

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

    /// @notice Consume a balance note in PrivacyEntry, mint a supply note here.
    /// @dev Flow:
    ///        1. accrue interest so indices are fresh
    ///        2. verify SUPPLY_ASSET proof (leaf binds assetId|amount|nullifier|commitments)
    ///        3. PrivacyEntry.spendBalance consumes balanceNullifier and inserts residual
    ///        4. insert supplyCommitment into our own tree
    ///        5. bump totalSupplyPerAsset and push to RateModel
    function supplyAsset(
        uint8 assetId,
        bytes32 balanceNullifier,
        bytes32 residualBalanceCommitment,
        bytes32 supplyCommitment,
        uint256 amount,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (supplyCommitment == bytes32(0)) revert ZeroAmount();
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        if (!cfg.suppliable) revert AssetNotSuppliable(assetId);
        // Note: balanceNullifier double-spend is caught by PrivacyEntry's
        // own nullifier set (called via spendBalance below); we don't
        // duplicate the check here.

        rateModel.accrue(assetId);

        bytes32 expectedVk = verifier.vkHash(uint8(IZkVerifier.CircuitId.SUPPLY_ASSET));
        verifier.verifyAndConsume(
            uint8(IZkVerifier.CircuitId.SUPPLY_ASSET), expectedVk, proof
        );

        privacyEntry.spendBalance(
            balanceNullifier, residualBalanceCommitment, supplyCommitment
        );

        uint32 leafIdx = _insertCommitment(supplyCommitment);

        uint256 newTotal = _totalSupplyPerAsset[assetId] + amount;
        _totalSupplyPerAsset[assetId] = newTotal;
        _pushTotals(assetId, newTotal);

        emit SupplyDeposited(assetId, leafIdx, supplyCommitment, amount);
    }

    /// @notice Consume a supply note here, credit a balance note in PrivacyEntry.
    /// @dev Per S14 §6.2, the circuit asserts amount_out ≤ note.amount × supplyIndex_now
    ///      / supplyIndex_at_deposit. Contract only sees the public amount.
    function withdrawSupply(
        uint8 assetId,
        bytes32 supplyNullifier,
        bytes32 newBalanceCommitment,
        uint256 amount,
        bytes32 rootAtProveTime,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (newBalanceCommitment == bytes32(0)) revert ZeroAmount();
        IAssetRegistry.AssetConfig memory cfg = assetRegistry.assets(assetId);
        if (!cfg.enabled) revert AssetNotEnabled(assetId);
        if (_spent[supplyNullifier]) revert NullifierAlreadySpent(supplyNullifier);
        if (!_imt.known(rootAtProveTime)) revert UnknownRoot();

        rateModel.accrue(assetId);

        bytes32 expectedVk = verifier.vkHash(uint8(IZkVerifier.CircuitId.WITHDRAW_SUPPLY));
        verifier.verifyAndConsume(
            uint8(IZkVerifier.CircuitId.WITHDRAW_SUPPLY), expectedVk, proof
        );

        _spent[supplyNullifier] = true;
        privacyEntry.creditBalance(newBalanceCommitment);

        uint256 prev = _totalSupplyPerAsset[assetId];
        uint256 newTotal = prev >= amount ? prev - amount : 0;
        _totalSupplyPerAsset[assetId] = newTotal;
        _pushTotals(assetId, newTotal);

        emit SupplyWithdrawn(assetId, supplyNullifier, amount);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function totalSupplyPerAsset(uint8 assetId) external view returns (uint256) {
        return _totalSupplyPerAsset[assetId];
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

    function _pushTotals(uint8 assetId, uint256 newTotal) private {
        IRateModel.AssetRateState memory s = rateModel.state(assetId);
        // Keep RateModel's per-asset totalSupply in sync. totalBorrow stays
        // owned by ShieldedPositionPool — we read it through and pass it
        // back unchanged.
        rateModel.setTotals(assetId, _safe128(newTotal), s.totalBorrow);
    }

    function _insertCommitment(bytes32 commitment) private returns (uint32) {
        if (_committed[commitment]) revert CommitmentAlreadyInserted(commitment);
        _committed[commitment] = true;

        (uint32 idx, bytes32 newRoot) = _imt.insert(commitment);
        emit MerkleRootUpdated(newRoot, idx + 1);
        return idx;
    }

    function _safe128(uint256 v) private pure returns (uint128) {
        // Per S01 §3, asset aggregates fit in uint128 by design (token max
        // supplies × index growth comfortably under 2^128). Revert hard if
        // ever violated.
        require(v <= type(uint128).max, "overflow128");
        return uint128(v);
    }
}
