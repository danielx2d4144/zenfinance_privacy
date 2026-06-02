// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IHfChecker
/// @notice Pluggable hook AgentAccount calls during borrow validation.
/// @dev Spec: design-v2/subsystems/03_smart_accounts_policies.md §3 step 4
///      Day-9 scope replaces the v1 stub with a wrapper around S05 Oracle:
///      `hfBpsAfter = currentPrice[asset] * MIN_TRIGGER / debtAmount`.
///      For Day 7, AgentAccount.t.sol installs a MockHfChecker that lets
///      tests assert both pass and fail paths against the policy's
///      hfFloorBps without standing up an oracle.
interface IHfChecker {
    /// @return hfBpsAfter The post-op health factor in basis points, OR
    ///                    type(uint16).max when borrow is unbounded by HF
    ///                    (e.g. for stablecoin same-asset borrows).
    function postOpHfBps(
        uint8 collateralAssetId,
        uint8 debtAssetId,
        uint128 debtAmount,
        bytes calldata circuitPublicInputs
    ) external view returns (uint16 hfBpsAfter);
}
