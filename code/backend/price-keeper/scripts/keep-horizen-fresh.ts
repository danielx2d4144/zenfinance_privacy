/**
 * Keeps the Horizen testnet Oracle inside its 3600s staleness window.
 *
 * Two shapes, because the hosted and local answers differ:
 *
 *   npm run horizen:push-once    # one sweep, exits — for a Railway cron
 *   npm run horizen:keep         # long-running loop — for a local demo
 *
 * A cron is the better production shape (no process to crash silently), but a
 * loop is what you want on a laptop while demoing, so both are here.
 *
 * Exit code is non-zero if any asset failed to end up fresh, so a cron run
 * that quietly did nothing shows up as a failure rather than a green tick.
 */
import { keepHorizenFresh } from "../src/oracle-push.js";
import { getHorizenConfig } from "../src/horizen-config.js";
import { log } from "../src/log.js";

async function sweep(): Promise<boolean> {
  const results = await keepHorizenFresh();
  const failed = results.filter((r) => r.priceUsd1e8 === null);
  log.info(
    {
      pushed: results.filter((r) => r.pushed).map((r) => r.assetId),
      skipped: results.filter((r) => !r.pushed && r.priceUsd1e8 !== null).map((r) => r.assetId),
      failed: failed.map((r) => r.assetId),
    },
    "horizen-keeper-sweep",
  );
  return failed.length === 0;
}

async function main() {
  const once = process.argv.includes("--once");
  const cfg = getHorizenConfig();

  if (once) {
    const ok = await sweep();
    if (!ok) process.exitCode = 1;
    return;
  }

  log.info(
    {
      oracle: cfg.ORACLE_HORIZEN,
      intervalSeconds: cfg.HORIZEN_PUSH_INTERVAL_SECONDS,
      maxAgeSeconds: cfg.HORIZEN_MAX_AGE_SECONDS,
    },
    "horizen-keeper-start",
  );

  for (;;) {
    try {
      await sweep();
    } catch (err) {
      // Never exit the loop on a transient RPC error — the next tick is well
      // inside the staleness window, so recovering beats crashing.
      log.error(
        { err: err instanceof Error ? { name: err.name, message: err.message } : err },
        "horizen-keeper-sweep-failed",
      );
    }
    await new Promise((r) =>
      setTimeout(r, cfg.HORIZEN_PUSH_INTERVAL_SECONDS * 1_000),
    );
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    "horizen-keeper-crash",
  );
  process.exitCode = 1;
});
