/**
 * Serialize the OpenAPI spec to ./openapi/openapi.json so spectral can
 * lint it without needing the server to be running.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec } from "../src/openapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../openapi");
mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, "openapi.json");
writeFileSync(outPath, JSON.stringify(buildOpenApiSpec(), null, 2));
console.log(`wrote ${outPath}`);
