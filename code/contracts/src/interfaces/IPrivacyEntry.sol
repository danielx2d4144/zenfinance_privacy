// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IPrivacyEntry
/// @notice Public surface of the PrivacyEntry custody contract.
/// @dev Spec: design-v2/subsystems/12_privacy_entry_layer.md §3
///      Holds all custodial assets. Pool contracts (POOL_ROLE) move
///      tokens through `spendBalance` / `creditBalance`. EOAs only see
///      one-shot `deposit` / `withdraw`.
interface IPrivacyEntry {
    event Deposited(address indexed token, address indexed from, uint256 amount, bytes32 commitment);
    event Withdrawn(address indexed token, address indexed to, uint256 amount, bytes32 nullifier);
    event BalanceSpent(bytes32 indexed nullifier);
    event BalanceCredited(bytes32 indexed commitment);
    event InsurancePaid(address indexed token, address indexed to, uint256 amount);
    event MerkleRootUpdated(bytes32 newRoot, uint32 nextLeafIndex);

    function deposit(address token, uint256 amount, bytes32 commitment) external;

    function spendBalance(
        bytes32 nullifier,
        bytes32 residualBalanceCommitment,
        bytes32 destinationCommitment
    ) external;

    function creditBalance(bytes32 newCommitment) external;

    function payToInsurance(address token, uint256 amount, address insuranceFund) external;

    function reserves(address token) external view returns (uint256);

    function isSpent(bytes32 nullifierHash) external view returns (bool);

    function currentRoot() external view returns (bytes32);

    function knownRoot(bytes32 root) external view returns (bool);

    function nextLeafIndex() external view returns (uint32);
}
