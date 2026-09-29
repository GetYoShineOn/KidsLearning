import { SCHEMA_SQL } from './schema';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function makePglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) (await import('node:fs')).mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<T>(sql, params);
      return r.rows as T[];
    },
    async exec(sql) { await pg.exec(sql); },
    async close() { await pg.close(); },
  };
}

async function makePg(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 10 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params as unknown[]);
      return r.rows as T[];
    },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

/** Create a fresh in-memory database (tests). */
export async function createMemoryDb(): Promise<Db> {
  const db = await makePglite();
  await db.exec(SCHEMA_SQL);
  return db;
}

const g = globalThis as unknown as { __rrDb?: Promise<Db> };

/** Process-wide DB: Postgres via DATABASE_URL, else embedded PGlite persisted in .data/ (dev only). */
export function getDb(): Promise<Db> {
  if (!g.__rrDb) {
    g.__rrDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (!url && process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== '1') throw new Error('DATABASE_URL is required in production (embedded PGlite is dev-only and loses data on redeploy)');
      const db = url ? await makePg(url) : await makePglite(process.env.PGLITE_DIR ?? '.data/pglite');
      await db.exec(SCHEMA_SQL);
      return db;
    })();
  }
  return g.__rrDb;
}

/** Test hook: inject a DB. */
export function setDb(db: Db) { g.__rrDb = Promise.resolve(db); }
