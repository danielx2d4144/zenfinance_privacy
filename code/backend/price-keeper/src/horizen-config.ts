import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Config for the Horizen testnet keeper.
 *
 * Deliberately separate from `config.ts` rather than bolted onto it. That
 * schema requires the whole Stork stack (`STORK_REST_URL`, `STORK_API_TOKEN`,
 * `STORK_BASE_SEPOLIA`), because on Base Sepolia the Oracle reads prices
 * *through* Stork. Horizen's Oracle was deployed with `stork_ = address(0)` —
 * push mode — so there is no Stork contract, no signed update payload and no
 * API token. Sharing one schema would force operators to invent values for
 * five variables that are never read.
 */

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte hex address");
const hexPrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hex private key");

const EnvSchema = z.object({
  HORIZEN_TESTNET_HTTPS: z
    .string()
    .url()
    .default("https://horizen-testnet.rpc.caldera.xyz/http"),
  HORIZEN_TESTNET_CHAIN_ID: z.coerce.number().int().default(2651420),

  /**
   * Signer for `Oracle.pushPrice`, which is `onlyRole(MANAGER_ROLE)`.
   *
   * Use the relayer, NOT the deployer. The deployer also holds
   * `DEFAULT_ADMIN_ROLE` and lives outside the repo on purpose; putting it in
   * a hosting dashboard would give anyone with dashboard access the ability to
   * pause the protocol. The relayer was granted `MANAGER_ROLE` on 2026-08-03
   * precisely so this process needs nothing more.
   */
  RELAYER_PRIVATE_KEY: hexPrivateKey,
  ORACLE_HORIZEN: hexAddress,

  /**
   * Asset ids to keep fresh, in `AssetRegistry` order: 0 = tUSDC, 1 = tcbBTC.
   */
  HORIZEN_ASSET_IDS: z.string().min(1).default("0,1"),

  /**
   * `Oracle.MAX_STALENESS_WINDOW` is 3600s and every borrow / collateral flow
   * reverts once a price crosses it. Push at a fraction of the window so a
   * single failed run is not an outage: at 900s we can miss three consecutive
   * runs and still be inside the window.
   */
  HORIZEN_PUSH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),

  /** Re-push regardless of price movement once a value is this old. */
  HORIZEN_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(1_800),

  /** Also push early if spot moved this far since the last on-chain value. */
  PRICE_MOVE_THRESHOLD_BPS: z.coerce.number().int().nonnegative().default(50),

  /**
   * Spot source for tcbBTC. CoinGecko's public endpoint needs no key, which
   * matters because this runs unattended. If it is unreachable the keeper
   * re-pushes the last on-chain value instead of skipping — see
   * `oracle-push.ts`. tUSDC is pinned to $1 and never queried.
   */
  BTC_PRICE_URL: z
    .string()
    .url()
    .default(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ),
  BTC_PRICE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type HorizenConfig = z.infer<typeof EnvSchema>;

let cached: HorizenConfig | null = null;

/** Lazy loader so tests can inject overrides without touching .env. */
export function getHorizenConfig(): HorizenConfig {
  if (cached !== null) return cached;
  loadDotenv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Horizen keeper config; check .env against .env.example.\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoised config. */
export function resetHorizenConfigCache(): void {
  cached = null;
}

export function horizenAssetIds(cfg: HorizenConfig = getHorizenConfig()): number[] {
  return cfg.HORIZEN_ASSET_IDS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n > 255) {
        throw new Error(`HORIZEN_ASSET_IDS: "${s}" is not a uint8 asset id`);
      }
      return n;
    });
}
