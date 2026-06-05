/**
 * Long-running keeper loop. Pushes Stork updates every PUSH_INTERVAL_SECONDS.
 * Soft-fails individual cycles so a single REST or RPC blip doesn't kill the
 * service — the next tick retries.
 *
 * Run under systemd / pm2 / k8s — no internal restart logic.
 */
import { fetchLatestPrices, toTemporalInputs } from "../src/stork-rest.js";
import { pushToStork } from "../src/pusher.js";
import { getConfig, feedSymbols } from "../src/config.js";
import { log } from "../src/log.js";

async function tick(): Promise<void> {
  const cfg = getConfig();
  const assets = feedSymbols(cfg);
  const t0 = Date.now();
  try {
    const resp = await fetchLatestPrices(
      cfg.STORK_REST_URL,
      cfg.STORK_API_TOKEN,
      assets,
    );
    const inputs = toTemporalInputs(resp);
    const result = await pushToStork(inputs);
    log.info(
      {
        assets,
        count: inputs.length,
        txHash: result.txHash,
        gasUsed: result.gasUsed.toString(),
        feeWei: result.feeWei.toString(),
        elapsedMs: Date.now() - t0,
      },
      "keeper-tick-ok",
    );
  } catch (err) {
    log.warn(
      {
        assets,
        elapsedMs: Date.now() - t0,
        err: err instanceof Error ? { name: err.name, message: err.message } : err,
      },
      "keeper-tick-failed",
    );
  }
}

async function main() {
  const cfg = getConfig();
  log.info(
    {
      intervalSeconds: cfg.PUSH_INTERVAL_SECONDS,
      assets: feedSymbols(cfg),
      stork: cfg.STORK_BASE_SEPOLIA,
    },
    "keeper-start",
  );

  // Run immediately, then on a fixed cadence.
  await tick();
  const intervalMs = cfg.PUSH_INTERVAL_SECONDS * 1_000;
  setInterval(() => {
    void tick();
  }, intervalMs);

  // Hold the event loop open until SIGINT/SIGTERM.
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      log.info("keeper-shutdown-sigint");
      resolve();
    });
    process.once("SIGTERM", () => {
      log.info("keeper-shutdown-sigterm");
      resolve();
    });
  });
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "keeper-fatal",
  );
  process.exit(1);
});
