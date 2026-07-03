import { drizzle } from "drizzle-orm/node-postgres";
import { sql as dsql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
export { systemSettingsTable } from "./schema";

const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error(
    "DATABASE_URL is not set. Replit injects this automatically — check that the built-in PostgreSQL database is provisioned.",
  );
}

// Force SSL in the connection URL so pg's own URL parser also sees sslmode=require.
// pg parses the connectionString internally and its sslmode logic can override the
// explicit `ssl` pool config option — injecting it into the URL fixes both code paths.
// The only exception is explicit sslmode=disable (local dev opt-out).
function injectSsl(connStr: string): { connectionString: string; ssl: pg.PoolConfig["ssl"] } {
  try {
    const url = new URL(connStr);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode === "disable") {
      return { connectionString: connStr, ssl: false };
    }
    // Overwrite to require — this is read by pg's own URL parser
    url.searchParams.set("sslmode", "require");
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    };
  } catch {
    // URL parse failed — pass as-is with explicit ssl config
    return { connectionString: connStr, ssl: { rejectUnauthorized: false } };
  }
}

const { connectionString, ssl: poolSsl } = injectSsl(rawConnectionString);
const pool = new pg.Pool({ connectionString, ssl: poolSsl });

export const db = drizzle(pool, { schema });

// ─── Auto-setup: idempotent full schema init ──────────────────────────────────
// Called once at server startup. Safe to run on every boot — all statements
// use IF NOT EXISTS / IF NOT EXISTS index guards, so re-running is a no-op.
// When the project is forked or cloned and run fresh, this creates every table
// and index automatically without any manual migration step.

let _initPromise: Promise<void> | null = null;

export function initializeDatabase(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _run().catch((err) => {
      _initPromise = null; // allow retry on transient failure
      throw err;
    });
  }
  return _initPromise;
}

async function _run(): Promise<void> {
  // 1. users — must exist before credentials (FK)
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

  // 2. credentials — scoped per user (one row per user)
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
  // Same Payd wallet may be linked to multiple registered users — user_id is the only unique key
  await dropLegacyPaydAccountUsernameConstraint();
  // Add user_id column to existing installs that pre-date multi-tenancy
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "credentials" ADD COLUMN "user_id" integer REFERENCES "users"("id");
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
  // Backfill user_id on legacy credential rows by matching account username to user name or email.
  // Only sets user_id — withdrawal flag is left as-is so explicit admin overrides are preserved.
  await db.execute(dsql`
    UPDATE "credentials" AS c
    SET "user_id" = u."id"
    FROM "users" AS u
    WHERE c."user_id" IS NULL
      AND (
        LOWER(u."name") = LOWER(c."payd_account_username")
        OR LOWER(split_part(u."email", '@', 1)) = LOWER(c."payd_account_username")
        OR LOWER(u."name") = LOWER(c."payd_username")
        OR LOWER(split_part(u."email", '@', 1)) = LOWER(c."payd_username")
      )
  `);

  // 3. system_settings — single-row global config (global_withdrawals_enabled, etc.)
  await db.execute(dsql`
    CREATE TABLE IF NOT EXISTS "system_settings" (
      "id"         serial PRIMARY KEY NOT NULL,
      "key"        text NOT NULL UNIQUE,
      "value"      text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  // Seed the default global withdrawal toggle if not yet present
  await db.execute(dsql`
    INSERT INTO "system_settings" ("key", "value")
    VALUES ('global_withdrawals_enabled', 'true')
    ON CONFLICT ("key") DO NOTHING
  `);

  // 4. transactions — scoped per user
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
  // Add user_id column to existing installs that pre-date multi-tenancy
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "transactions" ADD COLUMN "user_id" integer REFERENCES "users"("id");
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
}

/** Removes legacy uniqueness on payd_account_username so credentials are keyed by user_id only. */
export async function dropLegacyPaydAccountUsernameConstraint(): Promise<void> {
  await db.execute(dsql`DROP INDEX IF EXISTS "credentials_account_username_idx"`);
  await db.execute(dsql`
    DO $$ BEGIN
      ALTER TABLE "credentials" DROP CONSTRAINT IF EXISTS "credentials_payd_account_username_key";
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$
  `);
}

// Backward-compat alias used in routes that call ensureCredentialsTable()
export function ensureCredentialsTable(): Promise<void> {
  return initializeDatabase();
}

// ─── Global withdrawal toggle helpers ────────────────────────────────────────

/** Returns true if system-wide withdrawals are enabled (default: true). */
export async function getGlobalWithdrawalsEnabled(): Promise<boolean> {
  try {
    const rows = await db.execute(
      dsql`SELECT "value" FROM "system_settings" WHERE "key" = 'global_withdrawals_enabled' LIMIT 1`,
    );
    const row = (rows as { rows: Array<{ value: string }> }).rows[0];
    return row ? row.value !== "false" : true;
  } catch {
    return true; // fail-open if table not yet created
  }
}

/** Set system-wide withdrawals enabled flag. */
export async function setGlobalWithdrawalsEnabled(enabled: boolean): Promise<void> {
  await db.execute(
    dsql`INSERT INTO "system_settings" ("key", "value")
         VALUES ('global_withdrawals_enabled', ${enabled ? "true" : "false"})
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`,
  );
}

export * from "./schema";
