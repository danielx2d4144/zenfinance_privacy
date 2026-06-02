// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IOracle} from "./interfaces/IOracle.sol";

/// @title Oracle
/// @notice Stork adapter for per-asset USD prices.
/// @dev Day-1 stub: prices are pushed by an off-chain keeper holding the
///      MANAGER_ROLE. The Day-9 work replaces `pushPrice` with a direct
///      Stork pull adapter that calls
///      `Stork.updateTemporalNumericValuesV1` and reads the on-chain feed.
///      The IOracle interface stays unchanged across the swap.
///
///      Spec: design-v2/subsystems/05_oracle_and_keepers.md §2
///      Architectural invariant: protocol fails closed when prices stale
///      (PriceStale revert) — required for Aave-aligned solvency math
///      (architecture_context.md §4.2 I-SOLV-5).
contract Oracle is IOracle, AccessControl {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    uint32 public constant DEFAULT_STALENESS_WINDOW = 60;
    uint32 public constant MAX_STALENESS_WINDOW = 3_600;

    mapping(uint8 => PriceData) private _priceData;
    mapping(uint8 => uint32) private _stalenessWindow;
    mapping(uint8 => address) private _feed;

    error PriceStale(uint8 assetId, uint64 updatedAt, uint64 nowTs, uint32 window);
    error PriceUnset(uint8 assetId);
    error InvalidWindow(uint32 windowSeconds);
    error ZeroAddress();
    error ZeroPrice();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function configureFeed(uint8 assetId, address feedAddress, uint32 windowSeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (feedAddress == address(0)) revert ZeroAddress();
        if (windowSeconds == 0 || windowSeconds > MAX_STALENESS_WINDOW) {
            revert InvalidWindow(windowSeconds);
        }
        _feed[assetId] = feedAddress;
        _stalenessWindow[assetId] = windowSeconds;
        emit FeedConfigured(assetId, feedAddress);
        emit StalenessWindowSet(assetId, windowSeconds);
    }

    function setStalenessWindow(uint8 assetId, uint32 windowSeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (windowSeconds == 0 || windowSeconds > MAX_STALENESS_WINDOW) {
            revert InvalidWindow(windowSeconds);
        }
        _stalenessWindow[assetId] = windowSeconds;
        emit StalenessWindowSet(assetId, windowSeconds);
    }

    /// @notice Push a price for `assetId`. Day-1 surface only.
    /// @dev Day-9 replaces this with a Stork pull adapter; the keeper holding
    ///      MANAGER_ROLE goes away at that point.
    function pushPrice(uint8 assetId, uint128 priceUsd1e8) external onlyRole(MANAGER_ROLE) {
        if (priceUsd1e8 == 0) revert ZeroPrice();
        uint64 ts = uint64(block.timestamp);
        _priceData[assetId] = PriceData({priceUsd1e8: priceUsd1e8, updatedAt: ts});
        emit PriceUpdated(assetId, priceUsd1e8, ts);
    }

    function getPrice(uint8 assetId) external view returns (uint128) {
        PriceData memory p = _priceData[assetId];
        if (p.updatedAt == 0) revert PriceUnset(assetId);

        uint32 window = _stalenessWindow[assetId];
        if (window == 0) window = DEFAULT_STALENESS_WINDOW;

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs > p.updatedAt + window) {
            revert PriceStale(assetId, p.updatedAt, nowTs, window);
        }
        return p.priceUsd1e8;
    }

    function priceData(uint8 assetId) external view returns (PriceData memory) {
        return _priceData[assetId];
    }

    function stalenessWindow(uint8 assetId) external view returns (uint32) {
        uint32 w = _stalenessWindow[assetId];
        return w == 0 ? DEFAULT_STALENESS_WINDOW : w;
    }

    function feed(uint8 assetId) external view returns (address) {
        return _feed[assetId];
    }
}
