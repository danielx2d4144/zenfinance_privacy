import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte hex address");
const hexPrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hex private key");
const httpsUrl = z.string().url().startsWith("https://");

const EnvSchema = z.object({
  BASE_SEPOLIA_HTTPS: httpsUrl,
  RELAYER_PRIVATE_KEY: hexPrivateKey,
  ORACLE_BASE_SEPOLIA: hexAddress,
  STORK_BASE_SEPOLIA: hexAddress,
  STORK_REST_URL: httpsUrl,
  STORK_API_TOKEN: z.string().min(1, "Stork token required for live runs"),
  STORK_FEEDS: z.string().min(1).default("BTCUSD"),
  PUSH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  PRICE_MOVE_THRESHOLD_BPS: z.coerce.number().int().nonnegative().default(50),
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | null = null;

/** Lazy config loader so tests can pass overrides without reading .env. */
export function getConfig(): Config {
  if (cached !== null) return cached;
  loadDotenv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid price-keeper config; check .env against .env.example.\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}

export function feedSymbols(cfg: Config = getConfig()): string[] {
  return cfg.STORK_FEEDS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
