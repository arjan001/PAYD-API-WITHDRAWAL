// Load .env file in local development (ignored in production where env vars
// are injected by the platform). Must run before any other imports that read
// process.env so all variables are available immediately.
import { config as loadEnv } from "dotenv";
loadEnv();

import app from "./app";
import { logger } from "./lib/logger";
import { initializeDatabase } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Auto-setup: ensure all DB tables exist before accepting requests.
// On a fresh fork/clone this creates the full schema automatically.
initializeDatabase()
  .then(() => logger.info("Database schema ready"))
  .catch((err) => logger.error({ err }, "Database init failed — server will start anyway"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
