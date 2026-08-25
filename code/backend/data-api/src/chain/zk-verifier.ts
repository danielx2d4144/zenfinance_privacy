import type { Hex } from "viem";

/**
 * ZkVerifier.verifyAndConsume ABI — copied from
 * `code/backend/prover-service/src/pipeline/consume.ts` so the data-API
 * doesn't need to import the prover-service package.
 *
 * The pool contracts (ShieldedSupplyPool, ShieldedPositionPool,
 * LiquidationBoard, PrivacyEntry.withdraw) all gate their externals on a
 * `verifyAndConsume` call. Handlers wrap their pool call with a
 * pre-verification step against this ABI.
 */
export const ZK_VERIFIER_ABI = [
  {
    type: "function",
    name: "verifyAndConsume",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circuitId", type: "uint8" },
      { name: "expectedVkHash", type: "bytes32" },
      {
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
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "vkHash",
    stateMutability: "view",
    inputs: [{ name: "circuitId", type: "uint8" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "proxy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/**
 * The zkVerify aggregation proxy's membership check — the exact call
 * `ZkVerifier.verifyAndConsume` makes internally (ZkVerifier.sol:84).
 *
 * `view`, so we can dry-run it before spending gas. See
 * `waitForAggregationOnChain` in `intent/handlers/verify-and-call.ts`.
 */
export const AGGREGATION_PROXY_ABI = [
  {
    type: "function",
    name: "verifyProofAggregation",
    stateMutability: "view",
    inputs: [
      { name: "domainId", type: "uint256" },
      { name: "aggregationId", type: "uint256" },
      { name: "leaf", type: "bytes32" },
      { name: "merklePath", type: "bytes32[]" },
      { name: "leafCount", type: "uint256" },
      { name: "leafIndex", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface AggregationProofTuple {
  domainId: bigint;
  aggregationId: bigint;
  leaf: Hex;
  merklePath: Hex[];
  leafCount: bigint;
  leafIndex: bigint;
}
