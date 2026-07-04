import { drizzle } from "drizzle-orm/node-postgres";
import { sql as dsql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
export { systemSettingsTable } from "./schema";

// Replit runtime-injects PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
// pg reads those env vars automatically when no connectionString is given — no URL needed.
//
// SSL notes: Replit's managed PostgreSQL (both dev and prod) runs on the same internal host
// ("helium") and supports SSL with a self-signed/internal certificate. Production REQUIRES
// SSL; dev accepts but does not require it. Using ssl: { rejectUnauthorized: false }
// unconditionally works in both environments and avoids any NODE_ENV guessing.
const pool = new pg.Pool({
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

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
  // 1. users
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
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx"
      ON "users" USING btree ("email")
  `);

  // 2. credentials — one per user
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "credentials" (
      "id"                    serial PRIMARY KEY NOT NULL,
      "user_id"               integer REFERENCES "users"("id"),
      "payd_username"         text NOT NULL,
      "payd_password"         text NOT NULL,
      "payd_api_secret"       text,
      "payd_account_username" text NOT NULL,
      "is_active"             boolean DEFAULT false NOT NULL,
      "withdrawals_enabled"   boolean DEFAULT false NOT NULL,
      "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(dsql`
    CREATE UNIQUE INDEX IF NOT EXISTS "credentials_user_id_idx"
      ON "credentials" USING btree ("user_id")
  `);
  await db.execute(dsql`DROP INDEX IF EXISTS "credentials_account_username_idx"`);
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "credentials" DROP CONSTRAINT IF EXISTS "credentials_payd_account_username_key";
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$
  `);
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "credentials" ADD COLUMN "user_id" integer REFERENCES "users"("id");
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);

  // 3. system_settings
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "system_settings" (
      "id"         serial PRIMARY KEY NOT NULL,
      "key"        text NOT NULL UNIQUE,
      "value"      text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(dsql`
    INSERT INTO "system_settings" ("key", "value")
    VALUES ('global_withdrawals_enabled', 'true')
    ON CONFLICT ("key") DO NOTHING
  `);

  // 4. transactions
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "transactions" (
      "id"                   serial PRIMARY KEY NOT NULL,
      "user_id"              integer REFERENCES "users"("id"),
      "reference"            text UNIQUE,
      "correlator_id"        text UNIQUE,
      "type"                 text NOT NULL,
      "status"               text DEFAULT 'pending' NOT NULL,
      "amount"               numeric(14,2) NOT NULL,
      "currency"             text DEFAULT 'KES' NOT NULL,
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
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "transactions" ADD COLUMN "user_id" integer REFERENCES "users"("id");
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
}

export function ensureCredentialsTable(): Promise<void> {
  return initializeDatabase();
}

// ─── Global withdrawal toggle ─────────────────────────────────────────────────

export async function getGlobalWithdrawalsEnabled(): Promise<boolean> {
  try {
    const rows = await db.execute(
      dsql`SELECT "value" FROM "system_settings" WHERE "key" = 'global_withdrawals_enabled' LIMIT 1`,
    );
    const row = (rows as { rows: Array<{ value: string }> }).rows[0];
    return row ? row.value !== "false" : true;
  } catch {
    return true;
  }
}

export async function setGlobalWithdrawalsEnabled(enabled: boolean): Promise<void> {
  await db.execute(
    dsql`INSERT INTO "system_settings" ("key", "value")
         VALUES ('global_withdrawals_enabled', ${enabled ? "true" : "false"})
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`,
  );
}

export * from "./schema";
