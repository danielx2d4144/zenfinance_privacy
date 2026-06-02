import type { AggregationDetails } from "../kurier/schemas.js";

export type JobState =
  | { kind: "in-progress"; status: string }
  | {
      kind: "succeeded";
      status: string;
      aggregationId: string | number;
      details: AggregationDetails;
    }
  | { kind: "failed"; status: string; error?: string };

export interface AggregationReceipt {
  jobId: string;
  circuit: string;
  status: string;
  aggregationId: string | number;
  details: AggregationDetails;
}
