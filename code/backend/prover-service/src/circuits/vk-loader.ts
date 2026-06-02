import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CircuitName } from "./registry.js";

/**
 * Resolves the absolute path to `code/circuits/<name>/target/`.
 * prover-service lives at `code/backend/prover-service/`, so three `..` steps
 * land at `code/`.
 */
function targetDir(name: CircuitName): string {
  const here = fileURLToPath(new URL("./", import.meta.url));
  return resolve(here, "..", "..", "..", "..", "circuits", name, "target");
}

function bytesToHex(buf: Uint8Array): `0x${string}` {
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

export async function readVkBytes(name: CircuitName): Promise<`0x${string}`> {
  const buf = await readFile(join(targetDir(name), "vk"));
  return bytesToHex(buf);
}

export async function readProofBytes(name: CircuitName): Promise<`0x${string}`> {
  const buf = await readFile(join(targetDir(name), "proof"));
  return bytesToHex(buf);
}

/**
 * Noir/bb writes public inputs as concatenated 32-byte words. Split them so
 * Kurier sees one `publicSignals[i]` per field element.
 */
export async function readPublicSignals(name: CircuitName): Promise<`0x${string}`[]> {
  const buf = await readFile(join(targetDir(name), "public_inputs"));
  if (buf.length % 32 !== 0) {
    throw new Error(
      `${name}: public_inputs length ${buf.length} is not a multiple of 32`,
    );
  }
  const out: `0x${string}`[] = [];
  for (let i = 0; i < buf.length; i += 32) {
    out.push(bytesToHex(buf.subarray(i, i + 32)));
  }
  return out;
}

export async function readPinnedVkHash(name: CircuitName): Promise<`0x${string}`> {
  const buf = await readFile(join(targetDir(name), "vk_hash"));
  if (buf.length !== 32) {
    throw new Error(`${name}: vk_hash file is ${buf.length} bytes, expected 32`);
  }
  return bytesToHex(buf);
}
