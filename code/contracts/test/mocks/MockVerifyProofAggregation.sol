// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IVerifyProofAggregation} from "../../src/interfaces/IZkVerifier.sol";

/// @notice Programmable mock of zkVerify's on-chain proxy. Tests configure
///         which (domainId, aggId, leafIndex) tuples should verify true.
contract MockVerifyProofAggregation is IVerifyProofAggregation {
    mapping(bytes32 => bool) public allowed;

    function setAllowed(uint256 domainId, uint256 aggregationId, uint256 leafIndex, bool ok)
        external
    {
        allowed[keccak256(abi.encodePacked(domainId, aggregationId, leafIndex))] = ok;
    }

    function verifyProofAggregation(
        uint256 domainId,
        uint256 aggregationId,
        bytes32, /* leaf */
        bytes32[] calldata, /* merklePath */
        uint256, /* leafCount */
        uint256 leafIndex
    ) external view returns (bool) {
        return allowed[keccak256(abi.encodePacked(domainId, aggregationId, leafIndex))];
    }
}
