import { defineConfig } from "drizzle-kit";
import path from "path";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "../../netlify/database/migrations"),
  dialect: "postgresql",
  migrations: {
    prefix: "timestamp",
  },
});
