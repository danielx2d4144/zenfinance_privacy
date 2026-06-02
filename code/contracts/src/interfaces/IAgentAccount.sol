// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IAgentAccount
/// @notice ERC-4337 v0.7.0 smart account with policy-bound session keys.
/// @dev Spec: design-v2/subsystems/03_smart_accounts_policies.md §3
///      Owner mints a Session against a registered policy; the agent
///      signs userOps with its session-key private key. validateUserOp
///      checks the signature, that the session is live (not revoked, not
///      expired), and that the call shape matches the policy's allowlist
///      + asset budget. Spending is recorded *during validation* via
///      PolicyRegistry.chargeSpend, so a userOp that would exceed the
///      cap is rejected before EntryPoint dispatches it.
interface IAgentAccount {
    struct Session {
        address agentPubkey;
        uint256 policyId;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 nonce;
        bool revoked;
    }

    event SessionCreated(
        uint256 indexed sessionId,
        address indexed agentPubkey,
        uint256 indexed policyId,
        uint64 expiresAt
    );
    event SessionRevoked(uint256 indexed sessionId);
    event Executed(address indexed target, uint256 value, bytes4 selector);

    error NotOwner();
    error NotEntryPoint();
    error InvalidSession();
    error SessionRevokedOrExpired();
    error PolicyMismatch();
    error CallTargetNotAllowed(address target);
    error CallSelectorNotAllowed(bytes4 selector);
    error CallDataMalformed();
    error ExecutionFailed(bytes returnData);
    error ZeroAddress();

    function owner() external view returns (address);

    function createSession(address agentPubkey, uint256 policyId, uint64 expiresAt)
        external
        returns (uint256 sessionId);

    function revokeSession(uint256 sessionId) external;

    function sessions(uint256 sessionId)
        external
        view
        returns (
            address agentPubkey,
            uint256 policyId,
            uint64 createdAt,
            uint64 expiresAt,
            uint64 nonce,
            bool revoked
        );

    function execute(address target, uint256 value, bytes calldata data) external;
}
