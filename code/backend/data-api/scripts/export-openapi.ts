/**
 * Dump the data-API's live OpenAPI spec to docs/openapi.json so SDK
 * codegen and the dapp pick up the new schemas. Run from the data-api
 * root:
 *   npx tsx scripts/export-openapi.ts
 *
 * This is the data-API's source-of-truth handoff: zod schemas →
 * buildOpenApiSpec() → docs/openapi.json → SDK types.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiSpec } from "../src/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "..", "..", "..", "docs", "openapi.json");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApiSpec(), null, 2) + "\n");
console.log(`[openapi] wrote spec → ${out}`);
