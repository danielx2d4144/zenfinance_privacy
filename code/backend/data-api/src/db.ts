import pg from "pg";
import { getConfig } from "./config.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const cfg = getConfig();
  pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
