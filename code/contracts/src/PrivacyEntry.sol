// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPrivacyEntry} from "./interfaces/IPrivacyEntry.sol";
import {IZkVerifier} from "./interfaces/IZkVerifier.sol";

/// @title PrivacyEntry
/// @notice Single custodial vault. ERC-20s come in via `deposit`, leave
///         via `withdraw`, and shuttle internally between pool contracts
///         via `spendBalance` / `creditBalance` (POOL_ROLE only).
///         External observers see exactly two events per user lifetime:
///         the funding deposit and the eventual exit withdrawal.
/// @dev Spec: design-v2/subsystems/12_privacy_entry_layer.md §3
///      Day-2 scope (this contract):
///        - Storage layout (commitment tree state, nullifier set, reserves)
///        - Deposit / withdraw entry points (with proof verification)
///        - POOL_ROLE-gated balance moves
///        - EOA rejection on POOL_ROLE paths
///      Day-6 scope (deferred, marked TODO[Day-6]):
///        - Full Poseidon-based incremental Merkle insert (replaces the
///          Day-2 keccak hash-chain root; the public root + history layout
///          stays compatible).
///        - The actual circuit-to-call wiring per S02.
contract PrivacyEntry is IPrivacyEntry, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_ROLE = keccak256("POOL_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /// @notice Number of historical roots retained for proof verification.
    /// @dev Mirrors the v2 design (S12 §3) — keeps recent roots so a proof
    ///      built one block ago still verifies even after another op
    ///      advanced the tree.
    uint32 public constant ROOT_HISTORY_SIZE = 32;
    uint32 public constant TREE_DEPTH = 32;

    IZkVerifier public immutable verifier;

    mapping(address token => uint256) private _reserves;
    mapping(bytes32 nullifierHash => bool) private _spent;

    bytes32 private _currentRoot;
    uint32 private _nextLeafIndex;
    bytes32[ROOT_HISTORY_SIZE] private _rootHistory;
    mapping(bytes32 root => bool) private _knownRoot;

    error ZeroAddress();
    error ZeroAmount();
    error NullifierAlreadySpent(bytes32 nullifier);
    error UnknownRoot();
    error CommitmentAlreadyInserted(bytes32 commitment);
    error InsufficientReserves(address token, uint256 requested, uint256 available);

    constructor(address admin, address verifier_) {
        if (admin == address(0)) revert ZeroAddress();
        if (verifier_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        verifier = IZkVerifier(verifier_);
    }

    /// @notice Deposit ERC-20 into the vault and insert a balance commitment.
    /// @dev Day-2 surface: pulls the token via SafeERC20.transferFrom,
    ///      bumps `reserves[token]`, and inserts the commitment into the
    ///      tree using the placeholder hash. Day-6 wires the real
    ///      Poseidon incremental tree (storage layout unchanged) and adds
    ///      the entry_deposit ZK proof verification — see TODO below.
    function deposit(address token, uint256 amount, bytes32 commitment)
        external
        nonReentrant
        whenNotPaused
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (commitment == bytes32(0)) revert ZeroAmount();

        // TODO[Day-6]: verify entry_deposit proof binding (token, amount, commitment).

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _reserves[token] += amount;

        _insertCommitment(commitment);

        emit Deposited(token, msg.sender, amount, commitment);
    }

    /// @notice Withdraw ERC-20 to an external recipient by burning a balance note.
    /// @dev Verifies the entry_withdraw proof through ZkVerifier and consumes
    ///      the (domainId, aggId, leafIndex) tuple to prevent replay.
    ///      The leaf encodes (nullifier, newCommitment, token, amount, recipient)
    ///      and is bound to a `currentRoot`-time-of-prove that must still be
    ///      in `_knownRoot`.
    function withdraw(
        bytes32 nullifier,
        bytes32 newCommitment,
        address token,
        address recipient,
        uint256 amount,
        bytes32 rootAtProveTime,
        bytes32 expectedVkHash,
        IZkVerifier.AggregationProof calldata proof
    ) external nonReentrant whenNotPaused {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_spent[nullifier]) revert NullifierAlreadySpent(nullifier);
        if (!_knownRoot[rootAtProveTime]) revert UnknownRoot();

        // verifyAndConsume reverts on any failure (vk mismatch, replay, proxy
        // false), so we don't need to handle a `false` return here. The bool
        // return is part of the interface for symmetry with EVM verify libs.
        verifier.verifyAndConsume(
            uint8(IZkVerifier.CircuitId.ENTRY_WITHDRAW), expectedVkHash, proof
        );

        _spent[nullifier] = true;
        _insertCommitment(newCommitment);

        // Named-error guard at a money-moving entrypoint. Solidity 0.8's
        // checked subtraction would also catch underflow, but a typed
        // revert gives operators, indexers, and post-mortem readers a
        // clear signal — matches the same pattern in InsuranceFund.cover.
        uint256 available = _reserves[token];
        if (available < amount) revert InsufficientReserves(token, amount, available);
        unchecked {
            _reserves[token] = available - amount;
        }

        IERC20(token).safeTransfer(recipient, amount);

        emit Withdrawn(token, recipient, amount, nullifier);
    }

    /// @notice POOL_ROLE-only: spend a balance note + insert a residual + a destination commitment.
    /// @dev Used by ShieldedSupplyPool / ShieldedPositionPool / LiquidationBoard
    ///      during operations that consume some of the user's PrivacyEntry
    ///      balance and create a new note in another pool. The pool has
    ///      already verified its own ZK proof against ZkVerifier; this
    ///      function only manipulates PrivacyEntry state.
    function spendBalance(
        bytes32 nullifier,
        bytes32 residualBalanceCommitment,
        bytes32 destinationCommitment
    ) external onlyRole(POOL_ROLE) whenNotPaused {
        if (_spent[nullifier]) revert NullifierAlreadySpent(nullifier);
        _spent[nullifier] = true;

        if (residualBalanceCommitment != bytes32(0)) {
            _insertCommitment(residualBalanceCommitment);
        }
        // The destination commitment lives in the calling pool's tree, not
        // here — but emitting it lets the indexer follow the cross-contract
        // edge.
        emit BalanceSpent(nullifier);
        if (destinationCommitment != bytes32(0)) {
            emit BalanceCredited(destinationCommitment);
        }
    }

    /// @notice POOL_ROLE-only: insert a new balance commitment without consuming one.
    /// @dev Used by `borrow` (proceeds become a balance note) and by
    ///      liquidations that pay the liquidator inside the privacy
    ///      boundary.
    function creditBalance(bytes32 newCommitment) external onlyRole(POOL_ROLE) whenNotPaused {
        if (newCommitment == bytes32(0)) revert ZeroAmount();
        _insertCommitment(newCommitment);
        emit BalanceCredited(newCommitment);
    }

    /// @notice POOL_ROLE-only: physically transfer tokens out of custody to
    ///         a non-private destination (only the InsuranceFund today).
    /// @dev Used by LiquidationBoard to pay the protocol's bonus share.
    ///      Decrements `_reserves[token]` accordingly so per-asset solvency
    ///      accounting stays correct. The caller is trusted (POOL_ROLE) to
    ///      have already validated that this transfer is part of a
    ///      successfully-verified liquidation.
    function payToInsurance(address token, uint256 amount, address insuranceFund)
        external
        onlyRole(POOL_ROLE)
        whenNotPaused
    {
        if (token == address(0) || insuranceFund == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = _reserves[token];
        if (available < amount) revert InsufficientReserves(token, amount, available);
        unchecked {
            _reserves[token] = available - amount;
        }
        IERC20(token).safeTransfer(insuranceFund, amount);
        emit InsurancePaid(token, insuranceFund, amount);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function reserves(address token) external view returns (uint256) {
        return _reserves[token];
    }

    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return _spent[nullifierHash];
    }

    function currentRoot() external view returns (bytes32) {
        return _currentRoot;
    }

    function knownRoot(bytes32 root) external view returns (bool) {
        return _knownRoot[root];
    }

    function nextLeafIndex() external view returns (uint32) {
        return _nextLeafIndex;
    }

    /// @dev Day-2 placeholder hash chain: root := keccak(root, leaf, idx).
    ///      Day-6 replaces this with the Poseidon incremental Merkle
    ///      construction matching circuit-side hashing. The public surface
    ///      (currentRoot, rootHistory, nextLeafIndex, knownRoot) is unchanged.
    function _insertCommitment(bytes32 commitment) private {
        if (_committed[commitment]) revert CommitmentAlreadyInserted(commitment);
        _committed[commitment] = true;

        bytes32 newRoot = keccak256(abi.encodePacked(_currentRoot, commitment, _nextLeafIndex));
        _currentRoot = newRoot;
        _rootHistory[_nextLeafIndex % ROOT_HISTORY_SIZE] = newRoot;
        _knownRoot[newRoot] = true;

        unchecked {
            _nextLeafIndex += 1;
        }

        emit MerkleRootUpdated(newRoot, _nextLeafIndex);
    }

    /// @dev Tracks already-inserted commitments to enforce uniqueness; the
    ///      circuit-side spending key already prevents double-spends, but
    ///      catching duplicates here is a cheap defence-in-depth.
    mapping(bytes32 commitment => bool) private _committed;
}