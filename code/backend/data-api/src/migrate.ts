/**
 * Minimal migration runner. Numbered files under ./migrations are applied
 * in lexical order for `up` and reverse order for `down`.
 *
 * `runMigrations` records what it applied in `schema_migrations` and skips
 * anything already there. That became necessary in M3: the hosted deploy runs
 * `migrate up` on every release, and `01__init.up.sql` is not idempotent
 * (`CREATE TYPE` on an existing type is an error), so without tracking the
 * second deploy would fail.
 *
 * `loadMigrations` stays a pure file read, which is what the migration test
 * drives directly.
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx src/migrate.ts up
 *   DATABASE_URL=postgres://... tsx src/migrate.ts down
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv();

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

interface QueryClient {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * Create the bookkeeping table and return the set of already-applied `up`
 * filenames.
 *
 * One special case: a database created before tracking existed has `intents`
 * but no `schema_migrations`. Re-applying `01__init.up.sql` there would fail
 * on `CREATE TYPE`, so it is marked applied on the spot. `01` is the only
 * migration that predates tracking, which is why the backfill can name it.
 */
async function appliedMigrations(client: QueryClient): Promise<Set<string>> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const legacy = await client.query(
    `SELECT to_regclass('public.intents') IS NOT NULL AS has_intents,
            (SELECT count(*) FROM schema_migrations) = 0 AS untracked`,
  );
  const row = legacy.rows[0] as { has_intents: boolean; untracked: boolean } | undefined;
  if (row?.has_intents && row.untracked) {
    console.log("[migrate] pre-tracking database detected; marking 01__init.up.sql applied");
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ('01__init.up.sql')
       ON CONFLICT DO NOTHING`,
    );
  }

  const r = await client.query(`SELECT filename FROM schema_migrations`);
  return new Set((r.rows as { filename: string }[]).map((x) => x.filename));
}

export async function runMigrations(
  client: QueryClient,
  migrations: MigrationFile[],
  direction: Direction = "up",
): Promise<void> {
  const applied = await appliedMigrations(client);

  for (const m of migrations) {
    if (direction === "up") {
      if (applied.has(m.filename)) {
        console.log(`[migrate] skipping ${m.filename} (already applied)`);
        continue;
      }
      console.log(`[migrate] applying ${m.filename}`);
      await client.query(m.sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [m.filename]);
    } else {
      console.log(`[migrate] reverting ${m.filename}`);
      await client.query(m.sql);
      await client.query(`DELETE FROM schema_migrations WHERE filename = $1`, [
        m.filename.replace(".down.sql", ".up.sql"),
      ]);
    }
  }

  if (direction === "down") {
    await client.query(`DROP TABLE IF EXISTS schema_migrations`);
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
    await runMigrations(client, loadMigrations(MIGRATIONS_DIR, direction), direction);
    console.log(`[migrate] ${direction} complete`);
  } finally {
    await client.end();
  }
}

import { pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
