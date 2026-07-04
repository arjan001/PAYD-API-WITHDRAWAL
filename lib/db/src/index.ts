import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql as dsql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";

// ─── Simple SSL pool ───────────────────────────────────────────────────────────
// Replit's dev PostgreSQL does NOT support SSL connections.
// Use ssl: false for dev environment.
// Production uses ssl: { rejectUnauthorized: false } for Replit managed postgres.

const isDev = process.env.REPL_ID !== undefined; // REPL_ID is set in Replit dev
const pool = new pg.Pool({
  ssl: isDev ? false : { rejectUnauthorized: false },
});

const _db = drizzle(pool, { schema });

// Export the db instance for use in routes
export const db = _db;

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
  // users
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id"            serial PRIMARY KEY NOT NULL,
      "name"          text NOT NULL,
      "email"         text NOT NULL,
      "password_hash" text NOT NULL,
      "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"    timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(dsql`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")
  `);

  // credentials — one row per user
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "credentials" (
      "id"                    serial PRIMARY KEY NOT NULL,
      "user_id"               integer NOT NULL REFERENCES "users"("id"),
      "payd_username"         text NOT NULL,
      "payd_password"         text NOT NULL,
      "payd_api_secret"       text,
      "payd_account_username" text NOT NULL,
      "is_active"             boolean NOT NULL DEFAULT false,
      "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(dsql`
    CREATE UNIQUE INDEX IF NOT EXISTS "credentials_user_id_idx" ON "credentials" ("user_id")
  `);

  // transactions
  await db.execute(dsql`
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
