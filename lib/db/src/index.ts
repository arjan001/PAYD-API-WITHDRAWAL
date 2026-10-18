import { drizzle } from "drizzle-orm/netlify-db";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export const db = drizzle({ schema });

// Schema migrations are applied by the platform before publishing a deploy.
// Retain the existing readiness API without mutating schema during requests.
let readiness: Promise<void> | null = null;
export function initializeDatabase(): Promise<void> {
  if (!readiness) {
    readiness = db.execute(sql`SELECT 1`).then(() => undefined).catch((error) => {
      readiness = null;
      throw error;
    });
  }
  return readiness;
}

export const ensureCredentialsTable = initializeDatabase;
export * from "./schema";

// Share the same ORM instance across workspace packages and driver peers.
export { eq, and, or, desc, sql, not, count, sum } from "drizzle-orm";
