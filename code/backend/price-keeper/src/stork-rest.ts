import { request } from "undici";
import { z } from "zod";
import type { Hex } from "viem";

/** Shape of the JSON Stork returns at GET /v1/prices/latest. */
const EvmSignatureSchema = z.object({
  r: z.string(),
  s: z.string(),
  v: z.union([z.string(), z.number()]),
});

const TimestampedSignatureSchema = z.object({
  signature: EvmSignatureSchema,
  timestamp: z.union([z.string(), z.number()]),
  msg_hash: z.string().optional(),
});

const CalculationAlgSchema = z.object({
  checksum: z.string(),
  type: z.string().optional(),
});

const StorkSignedPriceSchema = z.object({
  public_key: z.string().optional(),
  encoded_asset_id: z.string(),
  price: z.string(),
  timestamped_signature: TimestampedSignatureSchema,
  publisher_merkle_root: z.string(),
  calculation_alg: CalculationAlgSchema,
});

const AggregatedSignedPriceSchema = z.object({
  timestamp: z.union([z.string(), z.number()]).optional(),
  asset_id: z.string().optional(),
  signature_type: z.string().optional(),
  price: z.string().optional(),
  stork_signed_price: StorkSignedPriceSchema,
  signed_prices: z.unknown().optional(),
});

const LatestResponseSchema = z.object({
  data: z.record(z.string(), AggregatedSignedPriceSchema),
});

export type AggregatedSignedPrice = z.infer<typeof AggregatedSignedPriceSchema>;
export type LatestResponse = z.infer<typeof LatestResponseSchema>;

/**
 * EVM-side input expected by IStork.updateTemporalNumericValuesV1. Mirrors the
 * canonical StorkStructs.TemporalNumericValueInput exactly — nested temporal
 * value, plus publisherMerkleRoot, valueComputeAlgHash, and r/s/v as separate
 * fields (NOT a packed 65-byte signature).
 */
export interface TemporalNumericValueInput {
  temporalNumericValue: {
    timestampNs: bigint;
    quantizedValue: bigint;
  };
  id: Hex;
  publisherMerkleRoot: Hex;
  valueComputeAlgHash: Hex;
  r: Hex;
  s: Hex;
  v: number;
}

/**
 * Fetch the latest signed prices for a list of asset symbols.
 *
 * The endpoint requires HTTP Basic auth via the `Authorization: Basic <token>`
 * header (the token is opaque — Stork-issued, not user:pass base64).
 */
export async function fetchLatestPrices(
  baseUrl: string,
  token: string,
  assets: string[],
): Promise<LatestResponse> {
  if (assets.length === 0) throw new Error("at least one asset required");
  const url = `${baseUrl.replace(/\/$/, "")}/v1/prices/latest?assets=${encodeURIComponent(
    assets.join(","),
  )}`;
  const res = await request(url, {
    headers: { Authorization: `Basic ${token}` },
  });
  const status = res.statusCode;
  const body = await res.body.text();
  if (status < 200 || status >= 300) {
    throw new Error(`stork rest ${status}: ${body.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    // Stork returns nanosecond timestamps (~1.78e18) as bare JSON numbers, which
    // exceed Number.MAX_SAFE_INTEGER (2^53 ≈ 9e15). JSON.parse silently rounds
    // them, losing ~tens of ns of precision. The signed payload commits to the
    // exact value, so any round-trip through a JS Number breaks signature
    // verification. Quote large bare integers before parsing so they survive
    // as strings; downstream code already accepts string|number via Zod.
    parsed = JSON.parse(quoteLargeIntegers(body));
  } catch {
    throw new Error(`stork rest: non-JSON body: ${body.slice(0, 200)}`);
  }
  return LatestResponseSchema.parse(parsed);
}

/**
 * Wrap any bare-integer JSON value >= 16 digits in double quotes so JSON.parse
 * keeps it as a string (preserving exact precision) instead of a lossy Number.
 *
 * The regex matches integer tokens (possibly negative) preceded by a value
 * position (after `:` or `[` or `,`) and not already inside quotes. We require
 * 16+ digits because Number.MAX_SAFE_INTEGER has 16 digits and any 16-digit
 * value could already be unsafe.
 */
export function quoteLargeIntegers(json: string): string {
  return json.replace(
    /([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
    (_m, lead: string, num: string) => `${lead}"${num}"`,
  );
}

/** Strip whitespace and an optional 0x prefix; lowercase the rest. */
function stripHex(s: string): string {
  return s.trim().replace(/^0x/i, "").toLowerCase();
}

/** Decode a base64 string into hex (lowercase, no 0x prefix). */
function base64ToHex(b64: string): string {
  return Buffer.from(b64, "base64").toString("hex");
}

/**
 * The asset id Stork hands back is base64-encoded bytes32. EVM wants it as
 * a 0x-prefixed 32-byte hex. Some Stork deployments also send hex strings
 * with or without the 0x prefix — we handle both.
 */
export function decodeAssetId(encoded: string): Hex {
  let hex: string;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(encoded)) {
    hex = stripHex(encoded);
  } else {
    hex = base64ToHex(encoded);
  }
  if (hex.length !== 64) {
    throw new Error(`asset id is not 32 bytes: got ${hex.length / 2} bytes`);
  }
  return `0x${hex}` as Hex;
}

/** Normalize an arbitrary hex-ish 32-byte string to 0x-prefixed lower-hex. */
export function toBytes32(input: string, label: string): Hex {
  const hex = stripHex(input);
  if (hex.length !== 64) {
    throw new Error(`${label} must be 32 bytes; got ${hex.length / 2}`);
  }
  return `0x${hex}` as Hex;
}

/**
 * Parse a v value that the REST returns as either "27"/"28" (decimal) or
 * "0x1b"/"0x1c" (hex) or 0/1. Normalize to 27/28.
 */
export function parseV(v: string | number): number {
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    const t = v.trim();
    if (/^0x/i.test(t)) {
      n = Number.parseInt(t.slice(2), 16);
    } else {
      n = Number.parseInt(t, 10);
      if (Number.isNaN(n)) n = Number.parseInt(t, 16);
    }
  }
  if (n === 0 || n === 1) n += 27;
  if (n !== 27 && n !== 28) throw new Error(`v must normalize to 27 or 28, got ${n}`);
  return n;
}

/**
 * Convert one AggregatedSignedPrice from the REST response into the EVM
 * struct shape consumed by Stork.updateTemporalNumericValuesV1.
 */
export function toTemporalInput(p: AggregatedSignedPrice): TemporalNumericValueInput {
  const sp = p.stork_signed_price;
  const ts = sp.timestamped_signature;
  const sig = ts.signature;
  return {
    temporalNumericValue: {
      timestampNs: BigInt(typeof ts.timestamp === "string" ? ts.timestamp : ts.timestamp),
      quantizedValue: BigInt(sp.price),
    },
    id: decodeAssetId(sp.encoded_asset_id),
    publisherMerkleRoot: toBytes32(sp.publisher_merkle_root, "publisher_merkle_root"),
    valueComputeAlgHash: toBytes32(sp.calculation_alg.checksum, "calculation_alg.checksum"),
    r: toBytes32(sig.r, "signature.r"),
    s: toBytes32(sig.s, "signature.s"),
    v: parseV(sig.v),
  };
}

export function toTemporalInputs(resp: LatestResponse): TemporalNumericValueInput[] {
  return Object.values(resp.data).map(toTemporalInput);
}
