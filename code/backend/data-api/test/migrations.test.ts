/**
 * T-10.3 — Postgres migrations apply up, then roll back down, leaving an
 * empty public schema.
 *
 * Uses @electric-sql/pglite — real Postgres compiled to WASM — so triggers
 * and information_schema work the same as production. No Docker required.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "../src/migrate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

interface CountRow {
  n: number;
}

async function publicCounts(pg: PGlite) {
  const tables = (await pg.query<CountRow>(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
  )).rows[0]!.n;
  const enums = (await pg.query<CountRow>(
    "SELECT count(*)::int AS n FROM pg_type WHERE typname IN ('intent_kind','intent_status')",
  )).rows[0]!.n;
  const functions = (await pg.query<CountRow>(
    "SELECT count(*)::int AS n FROM information_schema.routines WHERE routine_schema='public' AND routine_name='touch_updated_at'",
  )).rows[0]!.n;
  const triggers = (await pg.query<CountRow>(
    "SELECT count(*)::int AS n FROM information_schema.triggers WHERE trigger_schema='public'",
  )).rows[0]!.n;
  return { tables, enums, functions, triggers };
}

async function runFile(pg: PGlite, sql: string) {
  // pglite, like libpq, accepts the multi-statement transaction we wrote.
  await pg.exec(sql);
}

describe("T-10.3 — migrations up + down leave an empty schema", () => {
  it("up creates the expected objects; down drops them all", async () => {
    const pg = new PGlite();
    try {
      // Initial state: nothing.
      const before = await publicCounts(pg);
      expect(before).toEqual({ tables: 0, enums: 0, functions: 0, triggers: 0 });

      // Apply 01__init.up.sql.
      const ups = loadMigrations(MIGRATIONS_DIR, "up");
      for (const m of ups) await runFile(pg, m.sql);

      const afterUp = await publicCounts(pg);
      // 3 tables: intents, jobs, idempotency_keys.
      expect(afterUp.tables).toBe(3);
      // 2 enum types: intent_kind, intent_status.
      expect(afterUp.enums).toBe(2);
      // 1 plpgsql function.
      expect(afterUp.functions).toBe(1);
      // information_schema.triggers reports a row per UPDATE / INSERT /
      // DELETE event per trigger. Our two BEFORE UPDATE triggers therefore
      // show up as 2 rows.
      expect(afterUp.triggers).toBe(2);

      // Trigger behaviour: updated_at changes on UPDATE.
      await pg.exec(
        "INSERT INTO intents (account_address, kind, asset_id, amount) VALUES ('\\x00', 'entry_deposit', 0, 1)",
      );
      const t0 = (await pg.query<{ updated_at: string }>(
        "SELECT updated_at FROM intents LIMIT 1",
      )).rows[0]!.updated_at;
      // pg_sleep is supported by pglite; tiny delay so updated_at advances.
      await pg.query("SELECT pg_sleep(0.05)");
      await pg.exec("UPDATE intents SET status = 'proving'");
      const t1 = (await pg.query<{ updated_at: string }>(
        "SELECT updated_at FROM intents LIMIT 1",
      )).rows[0]!.updated_at;
      expect(new Date(t1).getTime()).toBeGreaterThan(new Date(t0).getTime());

      // Rollback.
      const downs = loadMigrations(MIGRATIONS_DIR, "down");
      for (const m of downs) await runFile(pg, m.sql);

      const afterDown = await publicCounts(pg);
      expect(afterDown).toEqual({ tables: 0, enums: 0, functions: 0, triggers: 0 });
    } finally {
      await pg.close();
    }
  });
});
