/**
 * Single-shot Stork push. Useful for verifying credentials + on-chain wiring
 * before standing up the long-running loop.
 *
 * Usage: npm run push-once [-- --assets=BTCUSD,ETHUSD]
 */
import { fetchLatestPrices, toTemporalInputs } from "../src/stork-rest.js";
import { pushToStork, readStork } from "../src/pusher.js";
import { getConfig, feedSymbols } from "../src/config.js";
import { log } from "../src/log.js";

function parseAssets(): string[] {
  const arg = process.argv.find((a) => a.startsWith("--assets="));
  if (arg) {
    return arg
      .split("=")[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return feedSymbols();
}

async function main() {
  const assets = parseAssets();
  const cfg = getConfig();
  log.info({ assets, storkRest: cfg.STORK_REST_URL }, "push-once-start");

  const resp = await fetchLatestPrices(
    cfg.STORK_REST_URL,
    cfg.STORK_API_TOKEN,
    assets,
  );
  const inputs = toTemporalInputs(resp);
  log.info({ count: inputs.length }, "push-once-fetched");

  const result = await pushToStork(inputs);
  log.info(
    {
      txHash: result.txHash,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      feeWei: result.feeWei.toString(),
    },
    "push-once-onchain",
  );

  for (const u of inputs) {
    const v = await readStork(u.id);
    log.info(
      {
        id: u.id,
        storedTimestampNs: v.timestampNs.toString(),
        storedQuantized: v.quantizedValue.toString(),
        priceUsd: (Number(v.quantizedValue) / 1e18).toFixed(2),
      },
      "push-once-readback",
    );
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "push-once-crash",
  );
  process.exitCode = 1;
});
