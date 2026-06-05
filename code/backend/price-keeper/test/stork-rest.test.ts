import { describe, expect, it } from "vitest";
import {
  decodeAssetId,
  parseV,
  quoteLargeIntegers,
  toBytes32,
  toTemporalInput,
  toTemporalInputs,
} from "../src/stork-rest.js";

describe("decodeAssetId", () => {
  it("passes through a 0x-prefixed hex bytes32", () => {
    const id = "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
    expect(decodeAssetId(id)).toBe(id);
  });

  it("normalizes an unprefixed hex bytes32", () => {
    const id = "7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
    expect(decodeAssetId(id)).toBe(`0x${id}`);
  });

  it("decodes base64-encoded bytes32", () => {
    const hex = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("hex");
    const b64 = Buffer.from(hex, "hex").toString("base64");
    expect(decodeAssetId(b64)).toBe(`0x${hex}`);
  });

  it("rejects wrong-length input", () => {
    expect(() => decodeAssetId("0xdead")).toThrow(/32 bytes/);
  });
});

describe("toBytes32", () => {
  it("0x-normalizes a 32-byte hex string", () => {
    const v = toBytes32("0x" + "ab".repeat(32), "x");
    expect(v).toBe("0x" + "ab".repeat(32));
  });

  it("rejects wrong-length input", () => {
    expect(() => toBytes32("0xdead", "x")).toThrow(/32 bytes/);
  });
});

describe("quoteLargeIntegers", () => {
  it("quotes a bare 19-digit timestamp so precision survives JSON.parse", () => {
    const before = '{"timestamp":1780668878594320812,"price":"60"}';
    const after = quoteLargeIntegers(before);
    expect(after).toContain('"timestamp":"1780668878594320812"');
    const parsed = JSON.parse(after) as { timestamp: string };
    expect(parsed.timestamp).toBe("1780668878594320812");
  });

  it("leaves already-quoted numeric strings alone", () => {
    const before = '{"v":"1780668878594320812"}';
    expect(quoteLargeIntegers(before)).toBe(before);
  });

  it("leaves small integers alone", () => {
    const before = '{"v":27,"w":1733184000}';
    expect(quoteLargeIntegers(before)).toBe(before);
  });

  it("quotes negative large integers", () => {
    const before = '{"q":-1780668878594320812}';
    expect(quoteLargeIntegers(before)).toContain('"q":"-1780668878594320812"');
  });

  it("quotes elements inside arrays", () => {
    const before = '{"a":[1780668878594320812,1780668878594320813]}';
    const after = quoteLargeIntegers(before);
    const parsed = JSON.parse(after) as { a: string[] };
    expect(parsed.a).toEqual(["1780668878594320812", "1780668878594320813"]);
  });
});

describe("parseV", () => {
  it("accepts decimal string 27/28", () => {
    expect(parseV("27")).toBe(27);
    expect(parseV("28")).toBe(28);
  });

  it("normalizes 0/1 → 27/28", () => {
    expect(parseV("0")).toBe(27);
    expect(parseV("1")).toBe(28);
  });

  it("accepts numeric input", () => {
    expect(parseV(27)).toBe(27);
    expect(parseV(0)).toBe(27);
  });

  it("accepts 0x1b hex", () => {
    expect(parseV("0x1b")).toBe(27);
    expect(parseV("0x1c")).toBe(28);
  });

  it("rejects out-of-range v", () => {
    expect(() => parseV("42")).toThrow(/v must normalize/);
  });
});

describe("toTemporalInput", () => {
  const fixture = {
    stork_signed_price: {
      encoded_asset_id:
        "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de",
      price: "60000500000000000000000",
      timestamped_signature: {
        signature: { r: "0x" + "ab".repeat(32), s: "0x" + "cd".repeat(32), v: "27" },
        timestamp: "1733184000000000000",
      },
      publisher_merkle_root: "0x" + "ef".repeat(32),
      calculation_alg: { checksum: "9c".repeat(32) },
    },
  };

  it("maps a single AggregatedSignedPrice to TemporalNumericValueInput", () => {
    const inp = toTemporalInput(fixture as never);
    expect(inp.id).toBe(
      "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de",
    );
    expect(inp.temporalNumericValue.timestampNs).toBe(1733184000000000000n);
    expect(inp.temporalNumericValue.quantizedValue).toBe(60000500000000000000000n);
    expect(inp.publisherMerkleRoot).toBe("0x" + "ef".repeat(32));
    expect(inp.valueComputeAlgHash).toBe("0x" + "9c".repeat(32));
    expect(inp.r).toBe("0x" + "ab".repeat(32));
    expect(inp.s).toBe("0x" + "cd".repeat(32));
    expect(inp.v).toBe(27);
  });

  it("toTemporalInputs preserves all entries in data map", () => {
    const resp = { data: { BTCUSD: fixture, ETHUSD: fixture } } as never;
    const inputs = toTemporalInputs(resp);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.r).toBe(inputs[1]!.r);
  });
});
