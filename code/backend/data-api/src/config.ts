import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

/**
 * Centralised, schema-validated environment. Every variable is required
 * unless explicitly defaulted; the server crashes at boot if anything is
 * missing rather than 500-ing later.
 */
const Schema = z
  .object({
    // Server
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    // Database
    DATABASE_URL: z.string().min(1),

    // Auth (Day-11 API-key-only; SIWE lands Day 14)
    API_KEY: z.string().min(16),

    // ---- destination chain -------------------------------------------------
    // Anvil 31337 for local dev, Horizen testnet 2651420 for the hosted demo.
    // Named CHAIN_* rather than ANVIL_* since M3: the code path is identical,
    // and the old name made the public deployment read like a local fixture.
    CHAIN_HTTPS: z.string().default("http://localhost:8545"),
    CHAIN_ID: z.coerce.number().default(31337),
    RELAYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    PRIVACY_ENTRY_ADDRESS: hexAddress,
    MOCK_USDC_ADDRESS: hexAddress,
    SHIELDED_SUPPLY_POOL_ADDRESS: hexAddress,
    SHIELDED_POSITION_POOL_ADDRESS: hexAddress,
    LIQUIDATION_BOARD_ADDRESS: hexAddress,
    ZK_VERIFIER_ADDRESS: hexAddress,

    /**
     * How a proof gets attested before the pool call.
     *
     *   kurier — the real path. Submit to Kurier, wait for zkVerify to
     *            aggregate and publish to the destination chain's proxy, then
     *            call the pool with the genuine merkle witness.
     *   mock   — Anvil only. A synthetic receipt plus `setAllowed` on
     *            `MockVerifyProofAggregation`. **No cryptography is checked.**
     *
     * One flag rather than two, because the synthetic receipt and the mock
     * proxy are two halves of the same shortcut: enabling one without the
     * other produces a stack that fails in a way nobody can read.
     */
    ATTESTATION_MODE: z.enum(["kurier", "mock"]).default("mock"),

    /** Required in `mock` mode; unused (and should be unset) in `kurier` mode. */
    MOCK_PROXY_ADDRESS: hexAddress.optional().or(z.literal("")),

    /**
     * zkVerify on-chain aggregation domain for the destination chain.
     * Domains are per-destination-chain containers: Base Sepolia = 2,
     * Horizen testnet = 175 (proven on-chain 2026-08-03, see GROUND_TRUTH.md).
     * Defaults to 175 because Horizen testnet is the deploy target; the local
     * Anvil fixture overrides it to 2 for continuity with older receipts.
     */
    ZK_DOMAIN_ID: z.coerce.number().default(175),

    // ---- Kurier (only read in `kurier` mode) -------------------------------
    KURIER_BASE_URL: z
      .string()
      .url()
      .default("https://relayer-api-testnet.horizenlabs.io/api/v1"),
    KURIER_API_KEY: z.string().optional(),
    KURIER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
    /**
     * Measured time-to-Aggregated on Horizen testnet was 2m 54s (Phase-0
     * probe). 20 minutes is ~7x headroom for a busy domain; past that a job is
     * far more likely stuck than slow, and the intent should fail visibly.
     */
    KURIER_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(20 * 60_000),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.ATTESTATION_MODE === "mock" && !cfg.MOCK_PROXY_ADDRESS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MOCK_PROXY_ADDRESS"],
        message: "required when ATTESTATION_MODE=mock",
      });
    }
    if (cfg.ATTESTATION_MODE === "kurier" && !cfg.KURIER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KURIER_API_KEY"],
        message: "required when ATTESTATION_MODE=kurier",
      });
    }
  });

export type Config = z.infer<typeof Schema>;

let cached: Config | null = null;
export function getConfig(): Config {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `data-api env validation failed:\n${parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoised config so a test can re-read process.env. */
export function resetConfigCache(): void {
  cached = null;
}
