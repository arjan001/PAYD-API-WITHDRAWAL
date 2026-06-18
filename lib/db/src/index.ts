import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema";

export const db = drizzle({ schema });

// No-op kept for backward compatibility — Netlify applies migrations automatically at deploy time.
export function initializeDatabase(): Promise<void> {
  return Promise.resolve();
}

// Backward-compat alias used in routes that call ensureCredentialsTable()
export function ensureCredentialsTable(): Promise<void> {
  return Promise.resolve();
}

export async function dropLegacyPaydAccountUsernameConstraint(): Promise<void> {
  // No-op: legacy constraint cleanup was handled during the Replit → Netlify migration.
}

export * from "./schema";
