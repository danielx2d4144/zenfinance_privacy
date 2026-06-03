import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte hex address");

const hexPrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hex private key");

const httpsUrl = z.string().url().startsWith("https://");
const wssUrl = z.string().url().startsWith("wss://");

const EnvSchema = z.object({
  KURIER_API_KEY: z.string().min(20, "API key looks truncated"),
  KURIER_BASE_URL: httpsUrl,
  KURIER_TARGET_CHAIN_ID: z.coerce.number().int().positive(),

  ZKVERIFY_VOLTA_WSS: wssUrl,
  ZKVERIFY_EXPLORER: httpsUrl,

  BASE_SEPOLIA_HTTPS: httpsUrl,
  BASE_SEPOLIA_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((n) => n === 84532, "expected Base Sepolia chain id 84532"),
  BASE_SEPOLIA_EXPLORER: httpsUrl,
  ZKVERIFY_PROXY_BASE_SEPOLIA: hexAddress,
  ZKVERIFY_TESTNET_DOMAIN_ID: z.coerce.number().int().positive(),
  ZKVERIFIER_BASE_SEPOLIA: hexAddress.optional().or(z.literal("")),

  HORIZEN_TESTNET_HTTPS: httpsUrl,
  HORIZEN_TESTNET_WSS: wssUrl,
  HORIZEN_TESTNET_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((n) => n === 2651420, "expected Horizen testnet chain id 2651420"),
  HORIZEN_EXPLORER: httpsUrl,

  RELAYER_PRIVATE_KEY: hexPrivateKey,
  RELAYER_ADDRESS: hexAddress,
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | null = null;

/**
 * Lazy config loader. The first call reads `.env` and validates it. Subsequent
 * calls return the cached object. Made lazy so that test modules (which pass
 * explicit overrides to `KurierClient`) don't trigger env validation at import
 * time.
 */
export function getConfig(): Config {
  if (cached !== null) return cached;
  loadDotenv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid prover-service config; check .env against .env.example.\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}
