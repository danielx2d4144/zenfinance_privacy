// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IInsuranceFund
/// @notice Per-asset reserve pool. Receives the protocol's cut of the
///         liquidation bonus (3%) per S01 §3 and the reserveFactor share
///         of accrued interest (S14 §4).
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (InsuranceFund)
///            design-v2/subsystems/14_interest_and_apys.md §4
interface IInsuranceFund {
    event Deposited(uint8 indexed assetId, address indexed token, uint256 amount, address from);
    event Covered(uint8 indexed assetId, address indexed token, uint256 amount, address to);

    function reserveOf(uint8 assetId) external view returns (uint256);

    function tokenOf(uint8 assetId) external view returns (address);

    function deposit(uint8 assetId, uint256 amount) external;

    /// @notice POOL_ROLE-only: book a deposit that was made via direct
    ///         token transfer (e.g. LiquidationBoard's bonus share from
    ///         PrivacyEntry custody). No transferFrom — caller is trusted
    ///         to have already moved the tokens to this contract.
    function notifyReceived(uint8 assetId, uint256 amount) external;

    function cover(uint8 assetId, uint256 amount, address to) external;
}
