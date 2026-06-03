import { z } from "zod";

export const ProofTypeSchema = z.enum(["ultrahonk"]);
export type ProofType = z.infer<typeof ProofTypeSchema>;

const HexString = z.string().regex(/^0x[a-fA-F0-9]+$/, "must be 0x-prefixed hex");

export const ProofDataSchema = z.object({
  proof: HexString,
  publicSignals: z.array(HexString),
  vk: HexString,
});
export type ProofData = z.infer<typeof ProofDataSchema>;

export const UltrahonkVariant = z.enum(["ZK", "Plain"]);
export type UltrahonkVariant = z.infer<typeof UltrahonkVariant>;

export const UltrahonkVersion = z.enum(["V0_84", "V3_0", "Legacy"]);
export type UltrahonkVersion = z.infer<typeof UltrahonkVersion>;

export const ProofOptionsSchema = z.object({
  variant: UltrahonkVariant,
  version: UltrahonkVersion,
});
export type ProofOptions = z.infer<typeof ProofOptionsSchema>;

export const RegisterVkRequestSchema = z.object({
  proofType: ProofTypeSchema,
  proofOptions: ProofOptionsSchema,
  vk: HexString,
});
export type RegisterVkRequest = z.infer<typeof RegisterVkRequestSchema>;

export const RegisterVkResponseSchema = z.object({
  vkHash: HexString,
});
export type RegisterVkResponse = z.infer<typeof RegisterVkResponseSchema>;

export const SubmitProofRequestSchema = z.object({
  proofType: ProofTypeSchema,
  proofOptions: ProofOptionsSchema,
  vkRegistered: z.boolean(),
  chainId: z.number().int().positive().optional(),
  proofData: ProofDataSchema,
});
export type SubmitProofRequest = z.infer<typeof SubmitProofRequestSchema>;

export const SubmitProofResponseSchema = z.object({
  jobId: z.string().min(1),
});
export type SubmitProofResponse = z.infer<typeof SubmitProofResponseSchema>;

// Kurier returns the merkle-tree witness for the aggregation a proof landed in.
// Fields seen on Volta testnet (2026-06-02):
//   receipt           — bytes32, the aggregation root that was published on-chain
//   receiptBlockHash  — block on Volta containing the AggregationPublished event
//   root              — duplicate of receipt
//   leaf              — bytes32, this proof's statement hash
//   leafIndex         — position of this leaf in the merkle tree
//   numberOfLeaves    — total leaves in the aggregation
//   merkleProof       — sibling hashes needed to verify (leaf, leafIndex) against root
export const AggregationDetailsSchema = z.object({
  receipt: HexString,
  receiptBlockHash: HexString,
  root: HexString,
  leaf: HexString,
  leafIndex: z.number().int().nonnegative(),
  numberOfLeaves: z.number().int().positive(),
  merkleProof: z.array(HexString),
});
export type AggregationDetails = z.infer<typeof AggregationDetailsSchema>;

export const JobStatusResponseSchema = z.object({
  status: z.string(),
  aggregationId: z.union([z.string(), z.number()]).nullish(),
  aggregationDetails: AggregationDetailsSchema.nullish(),
  error: z.string().nullish(),
});
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

// Status semantics (verified empirically on Base Sepolia 2026-06-03):
//   Aggregated            — root is on the destination chain proxy and
//                           verifyProofAggregation() returns true. Terminal
//                           success for our pipeline.
//   AggregationPublished  — defined in zkVerify docs but never observed on
//                           Base Sepolia testnet; treated as terminal success
//                           if it ever appears so we don't get stuck.
// Earlier docs reading distinguished Aggregated (zkVerify-side) from
// AggregationPublished (destination-chain-side). On Base Sepolia the relayer
// pushes during Aggregated; the proxy already accepts the proof.
export const TerminalStatus = {
  Aggregated: "Aggregated",
  AggregationPublished: "AggregationPublished",
  Failed: "Failed",
} as const;

export const InProgressStatus = {
  Queued: "Queued",
  Valid: "Valid",
  Submitted: "Submitted",
  IncludedInBlock: "IncludedInBlock",
  Finalized: "Finalized",
  AggregationPending: "AggregationPending",
  Aggregating: "Aggregating",
} as const;
