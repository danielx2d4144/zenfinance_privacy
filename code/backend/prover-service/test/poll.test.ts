import { describe, expect, it } from "vitest";
import { classify } from "../src/pipeline/poll.js";

describe("poll.classify", () => {
  const sampleDetails = {
    receipt: "0xb87e",
    receiptBlockHash: "0x871f",
    root: "0xb87e",
    leaf: "0x1e53",
    leafIndex: 0,
    numberOfLeaves: 1,
    merkleProof: [] as string[],
  };

  it("Aggregated with id+details → succeeded", () => {
    const s = classify({
      status: "Aggregated",
      aggregationId: 42,
      aggregationDetails: sampleDetails,
    });
    expect(s.kind).toBe("succeeded");
    if (s.kind === "succeeded") expect(s.aggregationId).toBe(42);
  });

  it("AggregationPublished with id+details → succeeded", () => {
    const s = classify({
      status: "AggregationPublished",
      aggregationId: "0x01",
      aggregationDetails: { ...sampleDetails, leafIndex: 3 },
    });
    expect(s.kind).toBe("succeeded");
  });

  it("Finalized → in-progress (proof finalized, aggregation still pending)", () => {
    const s = classify({ status: "Finalized" });
    expect(s.kind).toBe("in-progress");
  });

  it("Aggregated WITHOUT details → in-progress (wait for details to propagate)", () => {
    const s = classify({ status: "Aggregated" });
    expect(s.kind).toBe("in-progress");
  });

  it("IncludedInBlock → in-progress", () => {
    const s = classify({ status: "IncludedInBlock" });
    expect(s.kind).toBe("in-progress");
  });

  it("AggregationPending → in-progress", () => {
    const s = classify({ status: "AggregationPending" });
    expect(s.kind).toBe("in-progress");
  });

  it("Failed → failed with server error propagated", () => {
    const s = classify({ status: "Failed", error: "proof rejected by verifier" });
    expect(s.kind).toBe("failed");
    if (s.kind === "failed") expect(s.error).toBe("proof rejected by verifier");
  });

  it("Submitted → in-progress", () => {
    const s = classify({ status: "Submitted" });
    expect(s.kind).toBe("in-progress");
  });

  it("Aggregating → in-progress", () => {
    const s = classify({ status: "Aggregating" });
    expect(s.kind).toBe("in-progress");
  });

  it("Queued → in-progress", () => {
    const s = classify({ status: "Queued" });
    expect(s.kind).toBe("in-progress");
  });

  it("unknown status → in-progress (logs warning; poll keeps going until deadline)", () => {
    const s = classify({ status: "WhoKnows" });
    expect(s.kind).toBe("in-progress");
  });
});
