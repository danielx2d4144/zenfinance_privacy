// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IInsuranceFund} from "./interfaces/IInsuranceFund.sol";

/// @title InsuranceFund
/// @notice Per-asset reserve pool. Funded by:
///           - LiquidationBoard depositing the protocol's 3% bonus cut
///           - RateModel transferring the reserveFactor share of accrued interest
///         Drained by:
///           - cover(assetId, amount, to) on bad-debt events (S15, S16)
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (InsuranceFund)
///            design-v2/subsystems/14_interest_and_apys.md §4
///      Per-asset isolation: USDC reserves only cover USDC bad debt,
///      cbBTC only cbBTC, etc. The token address per asset is read from
///      AssetRegistry at deposit/cover time, so re-binding is impossible
///      without a registry update.
contract InsuranceFund is IInsuranceFund, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_ROLE = keccak256("POOL_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IAssetRegistry public immutable assetRegistry;

    mapping(uint8 assetId => uint256) private _reserve;

    error ZeroAddress();
    error ZeroAmount();
    error AssetNotConfigured(uint8 assetId);
    error InsufficientReserve(uint8 assetId, uint256 requested, uint256 available);

    constructor(address admin, address assetRegistry_) {
        if (admin == address(0)) revert ZeroAddress();
        if (assetRegistry_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        assetRegistry = IAssetRegistry(assetRegistry_);
    }

    /// @notice Add `amount` to `assetId`'s reserve. Caller is debited;
    ///         the underlying ERC-20 is pulled via SafeERC20.transferFrom.
    /// @dev Anyone may top up — reserves are public goods. The asset must
    ///      be configured in AssetRegistry so we know the token address.
    function deposit(uint8 assetId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        address token = assetRegistry.assets(assetId).token;
        if (token == address(0)) revert AssetNotConfigured(assetId);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _reserve[assetId] += amount;

        emit Deposited(assetId, token, amount, msg.sender);
    }

    /// @notice POOL_ROLE-only: book a deposit that already arrived via
    ///         direct transfer. Used by LiquidationBoard after
    ///         PrivacyEntry.payToInsurance moves the bonus share.
    /// @dev No transferFrom path — caller is responsible for ensuring the
    ///      token balance changes match the claimed `amount`.
    function notifyReceived(uint8 assetId, uint256 amount)
        external
        onlyRole(POOL_ROLE)
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        address token = assetRegistry.assets(assetId).token;
        if (token == address(0)) revert AssetNotConfigured(assetId);
        _reserve[assetId] += amount;
        emit Deposited(assetId, token, amount, msg.sender);
    }

    /// @notice Pay `amount` of `assetId`'s reserve to `to`. POOL_ROLE only.
    /// @dev Triggered by LiquidationBoard when seized collateral is
    ///      insufficient to cover debt + bonus, or by ShieldedSupplyPool
    ///      when supplyIndex would otherwise need to socialize a loss.
    ///      Per S15: if the reserve is empty for the affected asset, the
    ///      caller falls back to supplyIndex burn — that's not this
    ///      contract's concern; we just refuse and let the caller decide.
    function cover(uint8 assetId, uint256 amount, address to)
        external
        onlyRole(POOL_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        address token = assetRegistry.assets(assetId).token;
        if (token == address(0)) revert AssetNotConfigured(assetId);

        uint256 available = _reserve[assetId];
        if (available < amount) revert InsufficientReserve(assetId, amount, available);

        unchecked {
            _reserve[assetId] = available - amount;
        }

        IERC20(token).safeTransfer(to, amount);
        emit Covered(assetId, token, amount, to);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function reserveOf(uint8 assetId) external view returns (uint256) {
        return _reserve[assetId];
    }

    function tokenOf(uint8 assetId) external view returns (address) {
        return assetRegistry.assets(assetId).token;
    }
}
