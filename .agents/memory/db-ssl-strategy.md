---
name: DB SSL strategy
description: How pg connects to Replit's managed PostgreSQL in dev vs production — no connectionString, SSL conditional
---

## Rule
Never use `connectionString`/`DATABASE_URL` with `pg.Pool`. Use no connection string at all — pg reads `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` from the environment automatically (Replit injects these at runtime, not as user secrets).

Pass SSL config directly:
```typescript
const isProduction = process.env["NODE_ENV"] === "production";
const pool = new pg.Pool({
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});
```

**Why:**
- Dev PostgreSQL has no SSL listener → `ssl: false` required
- Production PostgreSQL requires SSL but uses a self-signed/internal cert → `rejectUnauthorized: false` required
- Using `connectionString` causes pg's internal URL parser to override the explicit `ssl` config, making SSL unreliable
- `DATABASE_URL` is runtime-managed by Replit and CANNOT be set as a user secret (Replit rejects/overrides it)

**How to apply:**
- Any code that creates a `pg.Pool` must follow this pattern
- Do NOT set `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, or `PGDATABASE` as Replit Secrets — they are runtime-managed
- `SESSION_SECRET` IS a user secret and IS the JWT signing key fallback
