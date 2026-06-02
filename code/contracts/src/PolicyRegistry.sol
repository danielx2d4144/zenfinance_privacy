// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";

/// @title PolicyRegistry
/// @notice Owner-signed (EIP-712) policy storage for AgentAccount sessions.
/// @dev Spec: design-v2/subsystems/03_smart_accounts_policies.md §3
///      The policy is signed off-chain by the owner; this contract only
///      verifies the signature and stores the immutable record. Any
///      change to a policy is a *new* policyId — there is no in-place
///      mutation surface.
///
///      `chargeSpend` is the only state-mutating function after registration.
///      AgentAccount holds SPENDER_ROLE and calls it from `validateUserOp`,
///      so a userOp that would exceed the cap reverts during the v4337
///      validation phase and is dropped by the bundler at no cost to the
///      EntryPoint.
contract PolicyRegistry is IPolicyRegistry, AccessControl, EIP712 {
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    /// @dev Hashes the AssetBudget struct exactly the way the off-chain
    ///      signer does; mismatched hashes are why most EIP-712 bugs ship.
    bytes32 private constant ASSET_BUDGET_TYPEHASH =
        keccak256("AssetBudget(uint8 assetId,uint128 capPerEpoch,uint16 hfFloorBps)");

    /// @dev Top-level Policy typehash. Order of fields MUST match the
    ///      struct definition in IPolicyRegistry verbatim.
    bytes32 private constant POLICY_TYPEHASH = keccak256(
        "Policy(address owner,bytes32 nameHash,address[] allowedContracts,bytes4[] allowedSelectors,AssetBudget[] assetBudgets,uint64 epochSeconds,uint16 globalHfFloorBps,uint64 expiresAt,bool requireConfirmation)"
        "AssetBudget(uint8 assetId,uint128 capPerEpoch,uint16 hfFloorBps)"
    );

    mapping(uint256 policyId => Policy) private _policies;
    mapping(uint256 policyId => bool) private _registered;

    /// @dev sliding-window per-asset spending: `spent[policyId][assetId][epoch]`.
    mapping(uint256 => mapping(uint8 => mapping(uint64 => uint128))) private _spent;

    /// @dev Cached `keccak256(abi.encode(target, selector))` -> bool for
    ///      O(1) allowlist lookup. Computed once at registration.
    mapping(uint256 policyId => mapping(bytes32 => bool)) private _allowed;

    /// @dev Cached asset->index-into-assetBudgets+1 (so 0 means "no budget").
    mapping(uint256 policyId => mapping(uint8 assetId => uint256)) private _budgetIndexPlusOne;

    constructor(address admin) EIP712("PolicyRegistry", "1") {
        if (admin == address(0)) revert ZeroEpochSeconds(); // reuse to avoid extra error
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Register a policy signed off-chain by `p.owner`.
    function register(Policy calldata p, bytes calldata ownerSignature)
        external
        returns (uint256 policyId)
    {
        if (p.owner == address(0)) revert UnknownPolicyOwner();
        if (p.epochSeconds == 0) revert ZeroEpochSeconds();
        if (p.assetBudgets.length == 0) revert EmptyBudgets();

        bytes32 structHash = _hashPolicy(p);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, ownerSignature);
        if (signer != p.owner) revert InvalidSignature();

        // policyId binds to (structHash, owner) so two owners cannot
        // collide on the same content. Using structHash directly already
        // includes owner via the typed encoding, so this is belt-and-braces.
        policyId = uint256(keccak256(abi.encode(structHash, p.owner)));
        if (_registered[policyId]) revert PolicyAlreadyRegistered(policyId);

        _registered[policyId] = true;
        // Solidity does not allow assigning a struct with dynamic-array
        // members from calldata to storage in a single statement, so we
        // copy field-by-field (cheaper than abi-decode round-trip).
        Policy storage stored = _policies[policyId];
        stored.owner = p.owner;
        stored.nameHash = p.nameHash;
        stored.epochSeconds = p.epochSeconds;
        stored.globalHfFloorBps = p.globalHfFloorBps;
        stored.expiresAt = p.expiresAt;
        stored.requireConfirmation = p.requireConfirmation;
        for (uint256 i = 0; i < p.allowedContracts.length; ++i) {
            stored.allowedContracts.push(p.allowedContracts[i]);
        }
        for (uint256 i = 0; i < p.allowedSelectors.length; ++i) {
            stored.allowedSelectors.push(p.allowedSelectors[i]);
        }
        for (uint256 i = 0; i < p.assetBudgets.length; ++i) {
            stored.assetBudgets.push(p.assetBudgets[i]);
            // index+1 so 0 stays the "missing" sentinel.
            _budgetIndexPlusOne[policyId][p.assetBudgets[i].assetId] = i + 1;
        }
        // Build the (target, selector) allowlist as the cross-product of
        // allowedContracts × allowedSelectors. Off-chain tooling can prune
        // selectors not relevant to a given target if the cap matters.
        for (uint256 i = 0; i < p.allowedContracts.length; ++i) {
            for (uint256 j = 0; j < p.allowedSelectors.length; ++j) {
                _allowed[policyId][_callKey(p.allowedContracts[i], p.allowedSelectors[j])] = true;
            }
        }

        emit PolicyRegistered(policyId, p.owner, p.nameHash);
    }

    function get(uint256 policyId) external view returns (Policy memory) {
        if (!_registered[policyId]) revert PolicyNotFound(policyId);
        return _policies[policyId];
    }

    function isAllowed(uint256 policyId, address target, bytes4 selector)
        external
        view
        returns (bool)
    {
        if (!_registered[policyId]) return false;
        return _allowed[policyId][_callKey(target, selector)];
    }

    function budgetFor(uint256 policyId, uint8 assetId)
        external
        view
        returns (AssetBudget memory)
    {
        if (!_registered[policyId]) revert PolicyNotFound(policyId);
        uint256 idxPlusOne = _budgetIndexPlusOne[policyId][assetId];
        if (idxPlusOne == 0) revert AssetNotInBudget(assetId);
        return _policies[policyId].assetBudgets[idxPlusOne - 1];
    }

    function spentInCurrentEpoch(uint256 policyId, uint8 assetId)
        external
        view
        returns (uint128)
    {
        if (!_registered[policyId]) revert PolicyNotFound(policyId);
        return _spent[policyId][assetId][currentEpoch(policyId)];
    }

    function currentEpoch(uint256 policyId) public view returns (uint64) {
        if (!_registered[policyId]) revert PolicyNotFound(policyId);
        // Anchored to unix epoch / epochSeconds — same epoch boundaries
        // regardless of when the policy was registered. Predictable for
        // off-chain reasoning and avoids a registration-time timestamp
        // becoming load-bearing.
        return uint64(block.timestamp / _policies[policyId].epochSeconds);
    }

    function chargeSpend(uint256 policyId, uint8 assetId, uint128 amount)
        external
        onlyRole(SPENDER_ROLE)
    {
        if (!_registered[policyId]) revert PolicyNotFound(policyId);
        Policy storage p = _policies[policyId];
        if (block.timestamp > p.expiresAt) revert PolicyExpired();

        uint256 idxPlusOne = _budgetIndexPlusOne[policyId][assetId];
        if (idxPlusOne == 0) revert AssetNotInBudget(assetId);
        AssetBudget storage b = p.assetBudgets[idxPlusOne - 1];

        uint64 epoch = uint64(block.timestamp / p.epochSeconds);
        uint128 already = _spent[policyId][assetId][epoch];
        // Sum stays inside uint128 because cap is uint128 and any
        // pre-existing `already` is bounded by cap (we revert otherwise).
        uint128 wouldBe = already + amount;
        if (wouldBe > b.capPerEpoch) {
            revert CapExceeded(assetId, amount, b.capPerEpoch - already);
        }
        _spent[policyId][assetId][epoch] = wouldBe;

        emit PolicySpent(policyId, assetId, epoch, amount);
    }

    /// @notice Returns the EIP-712 typed-data digest the owner must sign.
    /// @dev Useful for clients building the signature off-chain. We expose
    ///      it explicitly rather than asking the client to reconstruct the
    ///      type encoding; one source of truth = fewer integration bugs.
    function digestOf(Policy calldata p) external view returns (bytes32) {
        return _hashTypedDataV4(_hashPolicy(p));
    }

    function _hashPolicy(Policy calldata p) private pure returns (bytes32) {
        bytes32[] memory budgetHashes = new bytes32[](p.assetBudgets.length);
        for (uint256 i = 0; i < p.assetBudgets.length; ++i) {
            budgetHashes[i] = keccak256(
                abi.encode(
                    ASSET_BUDGET_TYPEHASH,
                    p.assetBudgets[i].assetId,
                    p.assetBudgets[i].capPerEpoch,
                    p.assetBudgets[i].hfFloorBps
                )
            );
        }
        // EIP-712 hashes dynamic arrays as keccak of the concatenated
        // child hashes; for `address[]` and `bytes4[]` it's keccak of the
        // packed *encoded* values (each padded to 32 bytes via abi.encode).
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                p.owner,
                p.nameHash,
                keccak256(abi.encodePacked(_padAddresses(p.allowedContracts))),
                keccak256(abi.encodePacked(_padBytes4(p.allowedSelectors))),
                keccak256(abi.encodePacked(budgetHashes)),
                p.epochSeconds,
                p.globalHfFloorBps,
                p.expiresAt,
                p.requireConfirmation
            )
        );
    }

    function _padAddresses(address[] calldata xs) private pure returns (bytes32[] memory out) {
        out = new bytes32[](xs.length);
        for (uint256 i = 0; i < xs.length; ++i) {
            out[i] = bytes32(uint256(uint160(xs[i])));
        }
    }

    function _padBytes4(bytes4[] calldata xs) private pure returns (bytes32[] memory out) {
        out = new bytes32[](xs.length);
        for (uint256 i = 0; i < xs.length; ++i) {
            // bytes4 lives in the high-order bytes of bytes32 per EIP-712.
            out[i] = bytes32(xs[i]);
        }
    }

    function _callKey(address target, bytes4 selector) private pure returns (bytes32) {
        return keccak256(abi.encode(target, selector));
    }
}
