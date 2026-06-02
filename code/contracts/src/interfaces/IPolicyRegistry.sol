// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IPolicyRegistry
/// @notice Owner-signed (EIP-712) policy storage + spending-cap accounting.
/// @dev Spec: design-v2/subsystems/03_smart_accounts_policies.md §3
///      A `Policy` enumerates exactly the contracts, selectors, and
///      per-asset budgets the agent is allowed to touch. The policy is
///      identified by `policyId = keccak256(abi.encode(structHash, owner))`
///      so it cannot collide across owners. Per-asset spending uses an
///      `epochSeconds` sliding window — once we tick into a new epoch the
///      budget refreshes implicitly (no on-chain timer reset needed).
interface IPolicyRegistry {
    /// @dev `assetId` indexes the same global asset registry every other
    ///      contract uses (S05 AssetRegistry). `capPerEpoch` is in token
    ///      units; the value flowing through the budget for any single
    ///      operation is the *amount field of the callData*, NOT a USD
    ///      notional, since the policy lives in the asset's own units.
    struct AssetBudget {
        uint8 assetId;
        uint128 capPerEpoch;
        uint16 hfFloorBps;
    }

    struct Policy {
        address owner;
        bytes32 nameHash;
        address[] allowedContracts;
        bytes4[] allowedSelectors;
        AssetBudget[] assetBudgets;
        uint64 epochSeconds;
        uint16 globalHfFloorBps;
        uint64 expiresAt;
        bool requireConfirmation;
    }

    event PolicyRegistered(uint256 indexed policyId, address indexed owner, bytes32 nameHash);
    event PolicySpent(uint256 indexed policyId, uint8 indexed assetId, uint64 epoch, uint128 amount);

    error InvalidSignature();
    error PolicyAlreadyRegistered(uint256 policyId);
    error PolicyNotFound(uint256 policyId);
    error PolicyExpired();
    error UnknownPolicyOwner();
    error AssetNotInBudget(uint8 assetId);
    error CapExceeded(uint8 assetId, uint128 attempted, uint128 available);
    error UnauthorizedSpender(address caller);
    error ZeroEpochSeconds();
    error EmptyBudgets();

    function register(Policy calldata p, bytes calldata ownerSignature)
        external
        returns (uint256 policyId);

    function get(uint256 policyId) external view returns (Policy memory);

    function isAllowed(uint256 policyId, address target, bytes4 selector)
        external
        view
        returns (bool);

    function budgetFor(uint256 policyId, uint8 assetId)
        external
        view
        returns (AssetBudget memory);

    function spentInCurrentEpoch(uint256 policyId, uint8 assetId)
        external
        view
        returns (uint128);

    function currentEpoch(uint256 policyId) external view returns (uint64);

    /// @notice Authorised AgentAccounts call this to check + record a spend.
    /// @dev Reverts on cap breach. Caller is checked via SPENDER_ROLE.
    function chargeSpend(uint256 policyId, uint8 assetId, uint128 amount) external;
}
