// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {IZkVerifier} from "../../src/interfaces/IZkVerifier.sol";

/// @notice Stand-in for ShieldedSupplyPool / ShieldedPositionPool that
///         exposes the real ABI-shape pool functions but does nothing.
///         AgentAccount's _enforcePolicy decoder reads (assetId, amount)
///         out of the calldata — what the function does is irrelevant for
///         policy testing, only the signature shape and call success.
contract MockPool {
    event Called(bytes4 indexed selector, uint8 assetId, uint256 amount);

    function supplyAsset(
        uint8 assetId,
        bytes32, // balanceNullifier
        bytes32, // residualBalanceCommitment
        bytes32, // supplyCommitment
        uint256 amount,
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.supplyAsset.selector, assetId, amount);
    }

    function withdrawSupply(
        uint8 assetId,
        bytes32, // supplyNullifier
        bytes32, // newBalanceCommitment
        uint256 amount,
        bytes32, // rootAtProveTime
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.withdrawSupply.selector, assetId, amount);
    }

    function depositCollateral(
        uint8 assetId,
        bytes32,
        bytes32,
        bytes32,
        bytes32,
        uint256 amount,
        bytes32,
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.depositCollateral.selector, assetId, amount);
    }

    function withdrawCollateral(
        uint8 assetId,
        bytes32,
        bytes32,
        bytes32,
        uint256 amount,
        bytes32,
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.withdrawCollateral.selector, assetId, amount);
    }

    function borrow(
        uint8 assetId,
        bytes32,
        bytes32,
        bytes32,
        uint256 amount,
        bytes32,
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.borrow.selector, assetId, amount);
    }

    function repay(
        uint8 assetId,
        bytes32,
        bytes32,
        bytes32,
        bytes32,
        uint256 amount,
        bytes32,
        IZkVerifier.AggregationProof calldata
    ) external {
        emit Called(this.repay.selector, assetId, amount);
    }
}
