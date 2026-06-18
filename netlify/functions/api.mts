import serverless from "serverless-http";
import app from "../../artifacts/api-server/src/app";
import { initializeDatabase } from "../../lib/db/src/index";

// Ensure all DB tables exist the first time this function cold-starts.
// initializeDatabase() is idempotent — safe to call on every cold start.
// In the standalone server (artifacts/api-server/src/index.ts) this is called
// at process startup; here we trigger it once when the function module loads.
initializeDatabase().catch((err) => {
  console.error("Netlify function: DB init failed —", err?.message ?? err);
  // We don't throw so the function can still start; auth/DB errors will surface
  // per-request rather than preventing the function from loading entirely.
});

// Wrap the Express app as a Netlify serverless handler.
export const handler = serverless(app);
