/**
 * Minimal migration runner. Numbered files under ./migrations are applied
 * in lexical order for `up` and reverse order for `down`. There's no
 * version table (Day-10 has one migration) — when we move to Day 11+
 * we'll add `schema_migrations` and a single-step rolling apply, but a
 * version table now is over-engineering for one file.
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx src/migrate.ts up
 *   DATABASE_URL=postgres://... tsx src/migrate.ts down
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

type Direction = "up" | "down";

export interface MigrationFile {
  filename: string;
  sql: string;
}

export function loadMigrations(dir: string, direction: Direction): MigrationFile[] {
  const suffix = direction === "up" ? ".up.sql" : ".down.sql";
  const files = readdirSync(dir).filter((f) => f.endsWith(suffix));
  files.sort();
  if (direction === "down") files.reverse();
  return files.map((filename) => ({
    filename,
    sql: readFileSync(join(dir, filename), "utf8"),
  }));
}

export async function runMigrations(
  client: { query: (sql: string) => Promise<unknown> },
  migrations: MigrationFile[],
): Promise<void> {
  for (const m of migrations) {
    console.log(`[migrate] applying ${m.filename}`);
    await client.query(m.sql);
  }
}

async function main() {
  const direction = (process.argv[2] ?? "up") as Direction;
  if (direction !== "up" && direction !== "down") {
    throw new Error(`unknown direction: ${direction}`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runMigrations(client, loadMigrations(MIGRATIONS_DIR, direction));
    console.log(`[migrate] ${direction} complete`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
