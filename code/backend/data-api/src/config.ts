import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

/**
 * Centralised, schema-validated environment. Every variable is required
 * unless explicitly defaulted; the server crashes at boot if anything is
 * missing rather than 500-ing later.
 */
const Schema = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Database
  DATABASE_URL: z.string().min(1),

  // Auth (Day-11 API-key-only; SIWE lands Day 14)
  API_KEY: z.string().min(16),

  // Anvil deposit fixture (T-11.1 path)
  ANVIL_HTTPS: z.string().default("http://localhost:8545"),
  ANVIL_CHAIN_ID: z.coerce.number().default(31337),
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  PRIVACY_ENTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  MOCK_USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  // Day-14b lending handler addresses. All four are deployed by
  // EmitTestEvents.s.sol; the relayer needs them to call into pools +
  // the mock proxy.
  SHIELDED_SUPPLY_POOL_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  SHIELDED_POSITION_POOL_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  LIQUIDATION_BOARD_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ZK_VERIFIER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  MOCK_PROXY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // zkVerify on-chain domainId — 2 on Base Sepolia per the existing
  // memory; same value is used by the mock proxy for symmetry.
  ZK_DOMAIN_ID: z.coerce.number().default(2),
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
