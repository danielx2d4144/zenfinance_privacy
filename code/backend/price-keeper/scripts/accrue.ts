/**
 * Day-9 accrue-keeper. Calls `RateModel.accrue(assetId)` for each asset on a
 * cadence (default 5 min). Anyone can call accrue; we just guarantee someone
 * does. Reuses the price-keeper's signer + RPC + log.
 *
 * Usage:
 *   npm run accrue                   # one shot for whatever's in ACCRUE_ASSETS
 *   npm run accrue -- --loop         # continuous loop
 *   npm run accrue -- --assets=0,1   # override asset id list
 *
 * Requires RATE_MODEL_BASE_SEPOLIA in .env. If unset the script reports a
 * clear error rather than crashing in the RPC layer.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { getConfig } from "../src/config.js";
import { log } from "../src/log.js";

const RATE_MODEL_ABI = [
  {
    type: "function",
    name: "accrue",
    stateMutability: "nonpayable",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [],
  },
] as const;

function parseFlags(): { loop: boolean; assets: number[] } {
  const loop = process.argv.includes("--loop");
  const arg = process.argv.find((a) => a.startsWith("--assets="));
  if (arg) {
    const ids = arg
      .split("=")[1]!
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < 256);
    return { loop, assets: ids };
  }
  const envList = (process.env.ACCRUE_ASSETS ?? "0,1")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 256);
  return { loop, assets: envList };
}

async function accrueOnce(rateModel: Address, assets: number[]): Promise<void> {
  const cfg = getConfig();
  const account = privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(cfg.BASE_SEPOLIA_HTTPS);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  for (const assetId of assets) {
    const t0 = Date.now();
    try {
      await publicClient.simulateContract({
        address: rateModel,
        abi: RATE_MODEL_ABI,
        functionName: "accrue",
        args: [assetId],
        account,
      });
      const txHash = await walletClient.writeContract({
        address: rateModel,
        abi: RATE_MODEL_ABI,
        functionName: "accrue",
        args: [assetId],
        account,
        chain: baseSepolia,
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      log.info(
        {
          assetId,
          txHash,
          gasUsed: r.gasUsed.toString(),
          elapsedMs: Date.now() - t0,
        },
        "accrue-ok",
      );
    } catch (err) {
      log.warn(
        {
          assetId,
          elapsedMs: Date.now() - t0,
          err: err instanceof Error ? { name: err.name, message: err.message } : err,
        },
        "accrue-failed",
      );
    }
  }
}

async function main() {
  // Load .env (and validate the keeper config) before touching process.env —
  // getConfig() triggers dotenv.config() internally.
  getConfig();
  const rateModelEnv = process.env.RATE_MODEL_BASE_SEPOLIA;
  if (!rateModelEnv || !/^0x[a-fA-F0-9]{40}$/.test(rateModelEnv)) {
    throw new Error(
      "RATE_MODEL_BASE_SEPOLIA not set in .env — deploy RateModel first.",
    );
  }
  const rateModel = rateModelEnv as Address;
  const { loop, assets } = parseFlags();
  log.info({ rateModel, assets, loop }, "accrue-keeper-start");

  await accrueOnce(rateModel, assets);
  if (!loop) return;

  const intervalMs =
    Number.parseInt(process.env.ACCRUE_INTERVAL_SECONDS ?? "300", 10) * 1_000;
  setInterval(() => {
    void accrueOnce(rateModel, assets);
  }, intervalMs);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "accrue-keeper-crash",
  );
  process.exit(1);
});
