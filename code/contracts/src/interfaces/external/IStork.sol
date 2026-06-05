// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IStork
/// @notice Minimal Stork verifier interface — just the surface our Oracle uses.
/// @dev Full source: https://github.com/Stork-Oracle/stork-external
///      Base Sepolia deployment: 0x647DFd812BC1e116c6992CB2bC353b2112176fD6
///      Quantization: `quantizedValue` is the price scaled by 1e18.
///      Feed id derivation: `bytes32 id = keccak256(bytes(asset_symbol))`
///      e.g. BTCUSD → 0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de
///
///      Struct layout MUST match Stork SDK exactly — see
///      stork-external/chains/evm/sdks/stork_evm_sdk/StorkStructs.sol.
interface IStork {
    struct TemporalNumericValue {
        uint64 timestampNs;
        int192 quantizedValue;
    }

    struct TemporalNumericValueInput {
        TemporalNumericValue temporalNumericValue;
        bytes32 id;
        bytes32 publisherMerkleRoot;
        bytes32 valueComputeAlgHash;
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    function updateTemporalNumericValuesV1(TemporalNumericValueInput[] calldata updateData)
        external
        payable;

    function getUpdateFeeV1(TemporalNumericValueInput[] calldata updateData)
        external
        view
        returns (uint256 feeAmount);

    function getTemporalNumericValueUnsafeV1(bytes32 id)
        external
        view
        returns (TemporalNumericValue memory value);
}
