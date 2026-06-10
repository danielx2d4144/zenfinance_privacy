#!/usr/bin/env node
// Stage E.1 -- copy compiled Noir circuit artifacts to the dapp's
// public/ folder so the Web Worker can fetch them at proof time.
//
// Source:  code/circuits/<name>/target/<name>.json   (one per circuit)
// Dest:    code/dapp/public/circuits/<name>.json
//
// The artifact JSON carries the ACIR bytecode + ABI metadata. bb.js's
// UltraHonkBackend takes it directly. We don't ship .vk files -- bb.js
// regenerates the verification key on the fly (the on-chain vkHash is
// pinned in VkRegistry.sol and re-checked against the regenerated vk).
//
// Wired into package.json as `prebuild` so production builds always
// pick up the freshest target/<name>.json output. The dev server also
// re-copies if the script is invoked manually after a `nargo compile`.
//
// Run with: node scripts/copy-circuit-artifacts.mjs

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = resolve(__dirname, "../../circuits");
const DEST_DIR = resolve(__dirname, "../public/circuits");

const CIRCUIT_NAMES = [
  "entry_deposit",
  "entry_withdraw",
  "supply_asset",
  "withdraw_supply",
  "deposit_collateral",
  "withdraw_collateral",
  "borrow",
  "repay",
  "liquidate",
  "consolidate_balance",
  "compute_triggers",
];

function main() {
  if (!existsSync(DEST_DIR)) {
    mkdirSync(DEST_DIR, { recursive: true });
    console.log(`[copy-circuits] created ${DEST_DIR}`);
  }

  let copied = 0;
  let skipped = 0;
  const missing = [];

  for (const name of CIRCUIT_NAMES) {
    const src = join(CIRCUITS_DIR, name, "target", `${name}.json`);
    const dst = join(DEST_DIR, `${name}.json`);

    if (!existsSync(src)) {
      missing.push(name);
      continue;
    }

    // Only copy if the source is newer than the destination -- saves
    // a meaningless write on every dev rebuild.
    if (existsSync(dst)) {
      const srcMtime = statSync(src).mtimeMs;
      const dstMtime = statSync(dst).mtimeMs;
      if (srcMtime <= dstMtime) {
        skipped += 1;
        continue;
      }
    }

    copyFileSync(src, dst);
    copied += 1;
  }

  if (missing.length > 0) {
    console.warn(
      `[copy-circuits] WARN missing artifacts (run nargo compile first): ${missing.join(", ")}`,
    );
  }

  console.log(
    `[copy-circuits] ${copied} copied, ${skipped} up-to-date, ${missing.length} missing`,
  );
}

main();
