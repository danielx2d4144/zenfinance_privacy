/**
 * Substitute {{TOKEN}} placeholders in subgraph.anvil.yaml.template with
 * the addresses emitted by the foundry deploy script (anvil-addrs.json),
 * writing the final subgraph.anvil.yaml.
 *
 * Usage: tsx scripts/render-anvil.ts [path/to/anvil-addrs.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REQUIRED = [
  "PRIVACY_ENTRY",
  "SHIELDED_SUPPLY_POOL",
  "SHIELDED_POSITION_POOL",
  "ZK_VERIFIER",
  "RATE_MODEL",
  "ORACLE",
  "ASSET_REGISTRY",
  "INSURANCE_FUND",
] as const;

function main() {
  const addrsPath = process.argv[2] ?? join(ROOT, "anvil-addrs.json");
  const tplPath = join(ROOT, "subgraph.anvil.yaml.template");
  const outPath = join(ROOT, "subgraph.anvil.yaml");

  const raw = readFileSync(addrsPath, "utf8");
  const addrs = JSON.parse(raw) as Record<string, string>;
  const missing = REQUIRED.filter((k) => !addrs[k] || !/^0x[a-fA-F0-9]{40}$/.test(addrs[k]!));
  if (missing.length) {
    throw new Error(`anvil-addrs.json missing or malformed addresses: ${missing.join(", ")}`);
  }

  let out = readFileSync(tplPath, "utf8");
  for (const k of REQUIRED) {
    out = out.replaceAll(`{{${k}}}`, addrs[k]!);
  }

  writeFileSync(outPath, out);
  console.log(`rendered ${outPath} from ${tplPath}`);
}

main();
