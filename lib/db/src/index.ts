import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql as dsql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";

// ─── Smart SSL pool ───────────────────────────────────────────────────────────
// Replit's dev PostgreSQL (helium) does NOT support SSL connections.
// Replit's production PostgreSQL REQUIRES SSL.
// We cannot distinguish via NODE_ENV (it's "production" in both environments).
// Solution: try connecting with SSL; if the server reports it doesn't support SSL,
// fall back to a non-SSL pool. Works transparently in dev and production.

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

async function getPool(): Promise<pg.Pool> {
  if (_pool) return _pool;

  // Try SSL first (production path)
  const sslPool = new pg.Pool({ ssl: { rejectUnauthorized: false } });
  try {
    await sslPool.query("SELECT 1");
    _pool = sslPool;
    return _pool;
  } catch (err: unknown) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("does not support SSL")) {
      // Dev path — server has no SSL listener
      await sslPool.end().catch(() => undefined);
      _pool = new pg.Pool({ ssl: false });
      return _pool;
    }
    // Any other error (bad credentials, host unreachable, etc.) — propagate
    await sslPool.end().catch(() => undefined);
    throw err;
  }
}

async function getDb(): Promise<NodePgDatabase<typeof schema>> {
  if (_db) return _db;
  const pool = await getPool();
  _db = drizzle(pool, { schema });
  return _db;
}

// Convenience: synchronous `db` proxy — works after initializeDatabase() resolves
// (all routes call initializeDatabase on startup before serving requests)
export let db: NodePgDatabase<typeof schema>;

// ─── Auto-setup: idempotent full schema init ──────────────────────────────────
let _initPromise: Promise<void> | null = null;

export function initializeDatabase(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _run().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

async function _run(): Promise<void> {
  const instance = await getDb();
  // Assign the module-level db so routes can import it synchronously
  db = instance;

  // users
  await instance.execute(dsql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id"            serial PRIMARY KEY NOT NULL,
      "name"          text NOT NULL,
      "email"         text NOT NULL,
      "password_hash" text NOT NULL,
      "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"    timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await instance.execute(dsql`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")
  `);

  // credentials — one row per user
  await instance.execute(dsql`
    CREATE TABLE IF NOT EXISTS "credentials" (
      "id"                    serial PRIMARY KEY NOT NULL,
      "user_id"               integer NOT NULL REFERENCES "users"("id"),
      "payd_username"         text NOT NULL,
      "payd_password"         text NOT NULL,
      "payd_api_secret"       text,
      "payd_account_username" text NOT NULL,
      "is_active"             boolean NOT NULL DEFAULT false,
      "withdrawals_enabled"   boolean NOT NULL DEFAULT false,
      "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await instance.execute(dsql`
    CREATE UNIQUE INDEX IF NOT EXISTS "credentials_user_id_idx" ON "credentials" ("user_id")
  `);

  // transactions
  await instance.execute(dsql`
    CREATE TABLE IF NOT EXISTS "transactions" (
      "id"                   serial PRIMARY KEY NOT NULL,
      "user_id"              integer REFERENCES "users"("id"),
      "reference"            text UNIQUE,
      "correlator_id"        text UNIQUE,
      "type"                 text NOT NULL,
      "status"               text NOT NULL DEFAULT 'pending',
      "amount"               numeric(14,2) NOT NULL,
      "currency"             text NOT NULL DEFAULT 'KES',
      "phone_number"         text,
      "narration"            text,
      "channel"              text,
      "business_account"     text,
      "business_type"        text,
      "receiver_username"    text,
      "wallet_type"          text,
      "result_code"          integer,
      "remarks"              text,
      "third_party_trans_id" text,
      "created_at"           timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"           timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
}

// Alias kept for call-sites that import by this name
export const ensureCredentialsTable = initializeDatabase;

export * from "./schema";
