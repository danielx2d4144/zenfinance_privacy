/**
 * Dump the live MCP_TOOLS catalog to docs/mcp-catalog.json.
 *
 * Single source of truth: src/mcp/tools.ts. Run from data-api root:
 *   npx tsx scripts/export-mcp-catalog.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOLS } from "../src/mcp/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "..", "..", "..", "docs", "mcp-catalog.json");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ jsonrpc: "2.0", catalogVersion: "day12", tools: MCP_TOOLS }, null, 2) + "\n",
);
console.log(`[mcp] wrote ${MCP_TOOLS.length} tools → ${out}`);
