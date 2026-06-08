/**
 * Inlined ABIs for the four pool contracts the data-API calls into.
 * Each entry covers only the methods Day-14b handlers actually invoke.
 * Source of truth is `code/contracts/src/*.sol`.
 */

const AGGREGATION_PROOF_TUPLE = {
  name: "proof",
  type: "tuple",
  components: [
    { name: "domainId", type: "uint256" },
    { name: "aggregationId", type: "uint256" },
    { name: "leaf", type: "bytes32" },
    { name: "merklePath", type: "bytes32[]" },
    { name: "leafCount", type: "uint256" },
    { name: "leafIndex", type: "uint256" },
  ],
} as const;

export const SHIELDED_SUPPLY_POOL_ABI = [
  {
    type: "function",
    name: "supplyAsset",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "balanceNullifier", type: "bytes32" },
      { name: "residualBalanceCommitment", type: "bytes32" },
      { name: "supplyCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawSupply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "supplyNullifier", type: "bytes32" },
      { name: "newBalanceCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
] as const;

export const SHIELDED_POSITION_POOL_ABI = [
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "balanceNullifier", type: "bytes32" },
      { name: "residualBalanceCommitment", type: "bytes32" },
      { name: "oldPositionNullifier", type: "bytes32" },
      { name: "newPositionCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "oldPositionNullifier", type: "bytes32" },
      { name: "newPositionCommitment", type: "bytes32" },
      { name: "newBalanceCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "oldPositionNullifier", type: "bytes32" },
      { name: "newPositionCommitment", type: "bytes32" },
      { name: "newBalanceCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "balanceNullifier", type: "bytes32" },
      { name: "residualBalanceCommitment", type: "bytes32" },
      { name: "oldPositionNullifier", type: "bytes32" },
      { name: "newPositionCommitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
] as const;

export const LIQUIDATION_BOARD_ABI = [
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "targetCommitment", type: "bytes32" },
      { name: "residualCommitment", type: "bytes32" },
      { name: "liquidatorBalanceCommitment", type: "bytes32" },
      { name: "collateralAsset", type: "uint8" },
      { name: "debtAsset", type: "uint8" },
      { name: "debtToCover", type: "uint128" },
      { name: "currentHealthFactorBps", type: "uint16" },
      {
        name: "newTriggers",
        type: "tuple[]",
        components: [
          { name: "assetId", type: "uint8" },
          { name: "triggerPrice1e8", type: "uint128" },
        ],
      },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
] as const;

export const PRIVACY_ENTRY_WITHDRAW_ABI = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nullifier", type: "bytes32" },
      { name: "newCommitment", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "rootAtProveTime", type: "bytes32" },
      { name: "expectedVkHash", type: "bytes32" },
      AGGREGATION_PROOF_TUPLE,
    ],
    outputs: [],
  },
] as const;
