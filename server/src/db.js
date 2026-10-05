import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export const q = (text, params) => pool.query(text, params);

// 事务封装：fn 收到一个 client，抛错则回滚
export async function tx(fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

// 极简迁移：按文件名顺序执行 migrations/*.sql，记录在 schema_migrations
export async function migrate(log = console) {
  await q("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = path.join(here, "..", "migrations");
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  const done = new Set((await q("SELECT name FROM schema_migrations")).rows.map(r => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(dir, f), "utf8");
    await tx(async c => { await c.query(sql); await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]); });
    log.info(`migration applied: ${f}`);
  }
}
