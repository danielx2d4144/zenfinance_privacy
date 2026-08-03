/**
 * T-11.5 — the M3 crash-recovery storage layer.
 *
 * Everything the boot sweep depends on lives in SQL: the stored request body,
 * the persisted Kurier job id, the resumable-status query, and a `migrate up`
 * that can run twice. None of it is exercised by the Anvil integration tests,
 * and all of it only matters on the one path we cannot easily rehearse — a
 * restart in the middle of a multi-minute aggregation.
 *
 * Uses @electric-sql/pglite (real Postgres in WASM) like T-10.3, so enum
 * arrays, jsonb and `to_regclass` behave as they do in production. No Docker.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMigrations, runMigrations } from "../src/migrate";
import {
  getKurierJobId,
  getResumableIntents,
  insertIntent,
  insertJobWithTx,
  recordKurierJobId,
  updateIntentStatus,
} from "../src/intent/state";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

/**
 * node-pg turns a JS array bound to an array-typed parameter into the `{a,b}`
 * literal Postgres expects; pglite passes it through as a bare comma string
 * and the server rejects it. `getResumableIntents` relies on that conversion,
 * so the bridge has to reproduce it.
 */
function prepareValue(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return `{${v.map((x) => `"${String(x)}"`).join(",")}}`;
}

/**
 * pglite splits its API: `query` is single-statement + parameterised, `exec`
 * takes a multi-statement script. node-pg's `query` does both, which is the
 * shape `runMigrations` and `state.ts` are written against. Bridge on the
 * presence of bound values.
 */
function asClient(pg: PGlite) {
  return {
    query: async (sql: string, values?: unknown[]) => {
      if (values === undefined) {
        const results = await pg.exec(sql);
        return { rows: results.at(-1)?.rows ?? [] };
      }
      return await pg.query(sql, values.map(prepareValue));
    },
  };
}

/** Same object, typed as a Pool for the `state.ts` helpers. */
function asPool(pg: PGlite): Pool {
  return asClient(pg) as unknown as Pool;
}

const ADDR = Buffer.alloc(20);

const DEPOSIT_BODY = {
  kind: "entry_deposit",
  asset: "USDC",
  amount: "1000000",
} as const;

describe("T-11.5 — crash-recovery storage layer", () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite();
    await runMigrations(asClient(pg), loadMigrations(MIGRATIONS_DIR, "up"), "up");
  });

  it("migrate up is idempotent — a second release does not re-run 01", async () => {
    // `01__init.up.sql` does CREATE TYPE, which errors on an existing type.
    // If tracking regressed this throws and the hosted redeploy breaks.
    await expect(
      runMigrations(asClient(pg), loadMigrations(MIGRATIONS_DIR, "up"), "up"),
    ).resolves.toBeUndefined();

    const applied = await pg.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(applied.rows.map((r) => r.filename)).toEqual([
      "01__init.up.sql",
      "02__intent_resume.up.sql",
    ]);
  });

  it("backfills a pre-tracking database instead of re-applying 01", async () => {
    // Simulate the database that already exists locally: schema from 01, no
    // schema_migrations table at all.
    const legacy = new PGlite();
    try {
      const [init] = loadMigrations(MIGRATIONS_DIR, "up");
      await legacy.exec(init!.sql);

      await runMigrations(asClient(legacy), loadMigrations(MIGRATIONS_DIR, "up"), "up");

      const applied = await legacy.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations ORDER BY filename",
      );
      expect(applied.rows.map((r) => r.filename)).toEqual([
        "01__init.up.sql",
        "02__intent_resume.up.sql",
      ]);
      // 02 must actually have run — the backfill only covers 01.
      const col = await legacy.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name='intents' AND column_name='request_body'",
      );
      expect(col.rows).toHaveLength(1);
    } finally {
      await legacy.close();
    }
  });

  it("round-trips the request body so a restart can rebuild the call", async () => {
    const pool = asPool(pg);
    const intent = await insertIntent(pool, {
      accountAddress: ADDR,
      kind: "entry_deposit",
      assetId: 0,
      amount: "1000000",
      requestBody: DEPOSIT_BODY,
    });
    expect(intent.request_body).toEqual(DEPOSIT_BODY);
  });

  it("lists exactly the non-terminal intents, oldest first", async () => {
    const pool = asPool(pg);
    const mk = async (kind: string) =>
      insertIntent(pool, {
        accountAddress: ADDR,
        kind,
        assetId: 0,
        amount: "1",
        requestBody: { ...DEPOSIT_BODY, kind },
      });

    const proving = await mk("supply");
    const confirmed = await mk("borrow");
    const failed = await mk("repay");
    const received = await mk("entry_deposit");

    await updateIntentStatus(pool, proving.id, "proving");
    await updateIntentStatus(pool, confirmed.id, "confirmed");
    await updateIntentStatus(pool, failed.id, "failed", "nope");

    const stranded = await getResumableIntents(pool);
    // `received` counts: the crash may have landed before the first update.
    expect(stranded.map((i) => i.id)).toEqual([proving.id, received.id]);
    // The sweep replays this body, so it must survive the round trip.
    expect(stranded[0]!.request_body).toMatchObject({ kind: "supply" });
  });

  it("persists the Kurier job id once, even if recorded twice", async () => {
    const pool = asPool(pg);
    const intent = await insertIntent(pool, {
      accountAddress: ADDR,
      kind: "supply",
      assetId: 0,
      amount: "1",
      requestBody: DEPOSIT_BODY,
    });

    await recordKurierJobId(pool, intent.id, "job-abc");
    // A resumed handler that somehow re-submits must not leave two rows
    // claiming the intent — `attest()` reads the first one back.
    await recordKurierJobId(pool, intent.id, "job-def");

    expect(await getKurierJobId(pool, intent.id)).toBe("job-abc");
    const jobs = await pg.query("SELECT id FROM jobs WHERE intent_id = $1", [intent.id]);
    expect(jobs.rows).toHaveLength(1);
  });

  it("returns null when no Kurier leg ran, so attest() submits fresh", async () => {
    const pool = asPool(pg);
    const intent = await insertIntent(pool, {
      accountAddress: ADDR,
      kind: "entry_deposit",
      assetId: 0,
      amount: "1",
      requestBody: DEPOSIT_BODY,
    });
    expect(await getKurierJobId(pool, intent.id)).toBeNull();
  });

  it("attaches the tx to the existing Kurier job row rather than adding one", async () => {
    const pool = asPool(pg);
    const intent = await insertIntent(pool, {
      accountAddress: ADDR,
      kind: "borrow",
      assetId: 0,
      amount: "1",
      requestBody: DEPOSIT_BODY,
    });

    await recordKurierJobId(pool, intent.id, "job-xyz");
    const job = await insertJobWithTx(pool, intent.id, Buffer.alloc(32, 0xab), { ok: true });

    expect(job.kurier_job_id).toBe("job-xyz");
    const jobs = await pg.query("SELECT id FROM jobs WHERE intent_id = $1", [intent.id]);
    expect(jobs.rows).toHaveLength(1);
  });

  it("falls back to an insert when there is no Kurier leg", async () => {
    const pool = asPool(pg);
    const intent = await insertIntent(pool, {
      accountAddress: ADDR,
      kind: "entry_deposit",
      assetId: 0,
      amount: "1",
      requestBody: DEPOSIT_BODY,
    });

    const job = await insertJobWithTx(pool, intent.id, Buffer.alloc(32, 0x01), { ok: true });
    expect(job.kurier_job_id).toBeNull();
    expect(job.tx_hash).not.toBeNull();
  });
});
