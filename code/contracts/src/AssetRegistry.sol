// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";

/// @title AssetRegistry
/// @notice Per-asset configuration registry for the privacy-lending protocol.
///         Holds risk parameters, oracle feed pointers, and enable/disable flags
///         per asset. Mutated only by MANAGER_ROLE (held by KMS-backed keepers
///         for routine ops) or ADMIN_ROLE (held by the Den Safe).
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 + §4.3
///            design-v2/subsystems/14_interest_and_apys.md §4
///      v1 launch enables USDC (id=0) and cbBTC (id=1); WETH (id=2) and ZEN
///      (id=3) added post-launch via Safe per S10. Max 16 assets in v1.
contract AssetRegistry is IAssetRegistry, AccessControl, Pausable {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint8 public constant MAX_ASSETS = 16;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    mapping(uint8 => AssetConfig) private _assets;
    uint8 private _numAssets;

    error InvalidAssetId(uint8 assetId);
    error AssetAlreadyExists(uint8 assetId);
    error AssetNotConfigured(uint8 assetId);
    error MaxAssetsReached();
    error ZeroAddress();
    // Per S14 §4: reserveFactor must be strictly below 100% or lenders earn negative APR.
    error InvalidBps(string field, uint16 value);
    // Per S01 §3: LT must be ≥ LTV (otherwise positions open under-water).
    error LiquidationThresholdBelowLtv(uint16 ltvBps, uint16 liquidationThresholdBps);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Enable a new asset id with full config.
    /// @dev Caller must hold MANAGER_ROLE. Reverts if id already configured
    ///      or if any bps field is out of range per S01/S14 constraints.
    function enableAsset(uint8 assetId, AssetConfig calldata config)
        external
        whenNotPaused
        onlyRole(MANAGER_ROLE)
    {
        if (assetId >= MAX_ASSETS) revert InvalidAssetId(assetId);
        if (_assets[assetId].token != address(0)) revert AssetAlreadyExists(assetId);
        if (_numAssets >= MAX_ASSETS) revert MaxAssetsReached();

        _validateConfig(config);

        AssetConfig memory c = config;
        c.enabled = true;
        _assets[assetId] = c;
        unchecked {
            _numAssets += 1;
        }

        emit AssetEnabled(assetId, c.token);
        emit AssetConfigUpdated(assetId);
    }

    /// @notice Update an existing asset's full config.
    /// @dev Timelock enforcement on loosening (LTV up, LT up, bonus down) is
    ///      a Safe-side concern per S10. This contract validates ranges only;
    ///      governance gates which call paths exist.
    function updateAssetConfig(uint8 assetId, AssetConfig calldata config)
        external
        whenNotPaused
        onlyRole(MANAGER_ROLE)
    {
        if (assetId >= MAX_ASSETS) revert InvalidAssetId(assetId);
        if (_assets[assetId].token == address(0)) revert AssetNotConfigured(assetId);

        _validateConfig(config);

        bool wasEnabled = _assets[assetId].enabled;
        _assets[assetId] = config;
        _assets[assetId].enabled = wasEnabled;

        emit AssetConfigUpdated(assetId);
    }

    /// @notice Pause new supplies/borrows for a single asset without affecting
    ///         others. Existing positions in this asset are unaffected; only
    ///         new entry points refuse the asset id.
    function disableAsset(uint8 assetId) external onlyRole(MANAGER_ROLE) {
        if (_assets[assetId].token == address(0)) revert AssetNotConfigured(assetId);
        _assets[assetId].enabled = false;
        emit AssetDisabled(assetId);
    }

    /// @notice Re-enable a previously disabled asset.
    function reenableAsset(uint8 assetId) external onlyRole(MANAGER_ROLE) {
        if (_assets[assetId].token == address(0)) revert AssetNotConfigured(assetId);
        _assets[assetId].enabled = true;
        emit AssetConfigUpdated(assetId);
    }

    /// @notice Global pause; reachable only by GUARDIAN_ROLE per
    ///         architecture_context.md §4.3 I-AC-3.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function assets(uint8 assetId) external view returns (AssetConfig memory) {
        return _assets[assetId];
    }

    function numAssets() external view returns (uint8) {
        return _numAssets;
    }

    function isEnabled(uint8 assetId) external view returns (bool) {
        return _assets[assetId].enabled;
    }

    function _validateConfig(AssetConfig calldata config) private pure {
        if (config.token == address(0)) revert ZeroAddress();
        if (config.oracleFeed == address(0)) revert ZeroAddress();

        if (config.ltvBps >= BPS_DENOMINATOR) revert InvalidBps("ltvBps", config.ltvBps);
        if (config.liquidationThresholdBps >= BPS_DENOMINATOR) {
            revert InvalidBps("liquidationThresholdBps", config.liquidationThresholdBps);
        }
        if (config.liquidationThresholdBps < config.ltvBps) {
            revert LiquidationThresholdBelowLtv(config.ltvBps, config.liquidationThresholdBps);
        }
        if (config.liquidationBonusBps > 2_000) {
            // Capped at 20% per S01 launch params (highest is ZEN at 12%).
            revert InvalidBps("liquidationBonusBps", config.liquidationBonusBps);
        }
        if (config.protocolFeeOfBonusBps > BPS_DENOMINATOR) {
            revert InvalidBps("protocolFeeOfBonusBps", config.protocolFeeOfBonusBps);
        }
        // Per S14 §4: reserveFactor < 100% (10_000 bps) — enforces I-SOLV-4.
        if (config.reserveFactorBps >= BPS_DENOMINATOR) {
            revert InvalidBps("reserveFactorBps", config.reserveFactorBps);
        }
        if (config.closeFactorHfThresholdBps > BPS_DENOMINATOR) {
            revert InvalidBps("closeFactorHfThresholdBps", config.closeFactorHfThresholdBps);
        }
    }
}
