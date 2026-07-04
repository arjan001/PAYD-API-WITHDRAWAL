---
name: DB SSL strategy
description: How pg connects to Replit's managed PostgreSQL in dev vs production — no connectionString, unconditional SSL
---

## Rule
Never use `connectionString`/`DATABASE_URL` with `pg.Pool`. Use no connection string at all — pg reads `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` from the environment automatically (Replit injects these at runtime, not as user secrets).

Always use `ssl: { rejectUnauthorized: false }` unconditionally:
```typescript
const pool = new pg.Pool({
  ssl: { rejectUnauthorized: false },
});
```

**Why:**
- Both dev and production PostgreSQL on Replit use the same internal host (`helium`). Dev accepts SSL connections; production *requires* them.
- Attempting to detect via `NODE_ENV` is unreliable: esbuild bundles with the value from the build-time env, and the artifact.toml `[services.production.run.env]` values may not always be visible to `process.env` at module init.
- Using `ssl: { rejectUnauthorized: false }` unconditionally works in both environments — the connection is still encrypted, the cert just can't be verified with a public CA (Replit uses an internal cert).
- `DATABASE_URL` is runtime-managed by Replit and CANNOT be set as a user secret (Replit rejects/overrides it).

**How to apply:**
- Any code that creates a `pg.Pool` must use this unconditional SSL pattern.
- Do NOT set `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, or `PGDATABASE` as Replit Secrets — they are runtime-managed.
- `SESSION_SECRET` IS a user secret and IS the JWT signing key fallback.
