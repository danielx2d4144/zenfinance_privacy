// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IHfChecker} from "../../src/interfaces/IHfChecker.sol";

/// @notice Test double for IHfChecker. Tests poke the returned HF in bps
///         to drive both pass and fail paths through AgentAccount.
contract MockHfChecker is IHfChecker {
    uint16 public hfBps;

    function setHfBps(uint16 v) external {
        hfBps = v;
    }

    function postOpHfBps(uint8, uint8, uint128, bytes calldata)
        external
        view
        returns (uint16)
    {
        return hfBps;
    }
}
