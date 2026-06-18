# Payd Dashboard

A self-hosted fintech dashboard for managing [Payd](https://payd.africa) and [Payhero](https://payhero.co.ke) payment gateway accounts. Features M-Pesa payins (STK push), payouts, merchant payments, P2P transfers, and a full transaction history — all scoped per user with JWT auth.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Local Development](#local-development)
- [Deploy to Netlify](#deploy-to-netlify)
- [Environment Variables Reference](#environment-variables-reference)
- [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Package manager | pnpm workspaces (monorepo) |
| Runtime | Node.js 20 |
| Language | TypeScript 5.9 |
| API | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod |
| Frontend | React + Vite + Tailwind CSS |
| Auth | JWT in HttpOnly cookie |
| Deployment | Netlify (static CDN + Serverless Function) |

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL (local install **or** a free cloud DB — see below)

### 1. Clone and install

```bash
git clone https://github.com/your-username/payd-dashboard.git
cd payd-dashboard
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values (see [Environment Variables Reference](#environment-variables-reference)).

The minimum required for local dev:

```env
PORT=8080
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/payd
JWT_SECRET=any-long-random-string-here
```

> **Free cloud DB options for local dev:** [Supabase](https://supabase.com) and [Neon](https://neon.tech) both have free PostgreSQL tiers. Copy the connection string they provide and paste it as `DATABASE_URL`. Make sure it includes `?sslmode=require` for Supabase/Neon.

### 3. Run the API server

```bash
pnpm --filter @workspace/api-server run dev
```

The server starts on port `8080` (or whatever `PORT` is set to). It **automatically creates all database tables** on first boot — no manual migration needed.

### 4. Run the dashboard (separate terminal)

```bash
pnpm --filter @workspace/dashboard run dev
```

The dashboard Vite dev server runs on port `3000` and proxies all `/api` calls to the API server on port `8080` automatically.

Open `http://localhost:3000` in your browser.

---

## Deploy to Netlify

### Architecture on Netlify

```
Browser
  │
  ├── /           →  CDN (static React build)
  ├── /payin      →  CDN (SPA route)
  └── /api/*      →  Netlify Function  →  Express API  →  PostgreSQL (external)
```

### Step-by-step

#### 1. Push to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

#### 2. Create a Netlify site

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Connect your GitHub account and select this repo
3. Netlify will auto-detect the build settings from `netlify.toml` — **do not change them**

#### 3. Set environment variables

Go to **Site → Configuration → Environment Variables** and add the following:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string with `?sslmode=require` |
| `JWT_SECRET` | **Yes** | Long random string for signing session cookies |
| `PAYD_USERNAME` | No | Payd API key username (from Payd → Profile → API Keys) |
| `PAYD_PASSWORD` | No | Payd API key password |
| `PAYD_ACCOUNT_USERNAME` | No | Your Payd profile username (e.g. `techlink`) |
| `PAYHERO_AUTH_TOKEN` | No | Payhero Basic auth token (e.g. `Basic xxxxxxxx==`) |
| `PAYHERO_CHANNEL_ID` | No | Payhero channel ID |

> **Payd/Payhero credentials** are per-user and can also be set in the dashboard Settings page after logging in. The env vars above are only needed if you want a pre-configured admin fallback.

> **Generate a JWT_SECRET:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

#### 4. Set up a PostgreSQL database

Netlify does not provide a built-in PostgreSQL. Use any of these free options:

| Provider | Free tier | Notes |
|---|---|---|
| [Supabase](https://supabase.com) | 500 MB | Connection string under Project → Settings → Database |
| [Neon](https://neon.tech) | 512 MB | Connection string under Dashboard → Connection Details |
| [Railway](https://railway.app) | $5 credit/mo | PostgreSQL plugin |

Copy the connection string and set it as `DATABASE_URL`. **Always include `?sslmode=require`** at the end:

```
postgresql://user:password@db.xxx.supabase.co:5432/postgres?sslmode=require
```

The API automatically creates all tables (`users`, `credentials`, `transactions`) on the first request — no manual SQL needed.

#### 5. Deploy

Click **Deploy site** in Netlify. First deploy takes ~2 minutes. Subsequent deploys are faster.

After deploy, open your Netlify URL, register an account, go to **Settings** and enter your Payd credentials.

---

## Environment Variables Reference

Full list of all variables the app reads:

| Variable | Where used | Example |
|---|---|---|
| `PORT` | API server listen port | `8080` |
| `NODE_ENV` | Logging, SSL detection | `production` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://...?sslmode=require` |
| `JWT_SECRET` | Sign/verify session tokens | 64+ random hex chars |
| `PAYD_USERNAME` | Payd API auth (fallback) | `api_key_username` |
| `PAYD_PASSWORD` | Payd API auth (fallback) | `api_key_password` |
| `PAYD_ACCOUNT_USERNAME` | Payd wallet username | `techlink` |
| `PAYHERO_AUTH_TOKEN` | Payhero Basic auth | `Basic abc123==` |
| `PAYHERO_CHANNEL_ID` | Payhero channel | `5635` |
| `APP_PUBLIC_URL` | Webhook callback base URL | `https://your-site.netlify.app` |

> On **Netlify**, set these in **Site → Configuration → Environment Variables**.  
> In **local development**, copy `.env.example` to `.env` and fill in the values.

---

## Project Structure

```
.
├── artifacts/
│   ├── api-server/          # Express API (builds to dist/, runs on Netlify as a Function)
│   │   └── src/
│   │       ├── app.ts       # Express app setup
│   │       ├── index.ts     # Standalone server entry (local/Replit)
│   │       ├── routes/      # auth, payd, payhero, settings, admin
│   │       └── middlewares/ # JWT auth
│   └── dashboard/           # React + Vite frontend
│       └── src/
│           ├── pages/       # dashboard, payin, payout, transactions, settings
│           └── components/  # auth-gate, layout, UI components
├── lib/
│   ├── db/                  # Drizzle ORM client + schema + auto-setup
│   └── api-zod/             # Zod schemas generated from OpenAPI spec
├── netlify/
│   └── functions/
│       └── api.mts          # Netlify Function wrapper around Express app
├── netlify.toml             # Netlify build + routing config
├── .env.example             # Template for local .env file
└── pnpm-workspace.yaml      # pnpm monorepo config
```

---

## Gotchas

- **SSL required** — hosted PostgreSQL providers (Supabase, Neon, etc.) require SSL. Always use `?sslmode=require` in your `DATABASE_URL`. The app auto-enables SSL for non-localhost hosts.
- **Payd credentials** — `PAYD_USERNAME` / `PAYD_PASSWORD` are API key credentials from Payd's Profile → API Keys, **not** your Payd account login.
- **Phone numbers** — must be in international format starting with `254` (e.g. `254712345678`).
- **Webhooks** — set `APP_PUBLIC_URL` to your Netlify domain so Payd/Payhero can POST status callbacks back to your app.
- **pnpm only** — this repo enforces pnpm via a preinstall script. Do not use `npm install` or `yarn`.
