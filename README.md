# Agent Company

A virtual company of AI companions working in a live office.

- `frontend/` Next.js 16 (port 3000). Proxies `/api/*` to the backend.
- `backend/` Fastify + Better Auth + Prisma 7 on Neon Postgres (port 4000).

## Setup

1. Create a free Neon project and a second database named `test` in it.
2. Copy `.env.example` to `backend/.env` and fill in the values (never commit it).
3. Install and migrate:

```
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run db:migrate
```

Optional: Google sign-in needs a Google Cloud OAuth client with redirect URI
`http://localhost:3000/api/auth/callback/google`, then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.

## Run

```
npm run dev:backend
npm run dev:frontend   # http://localhost:3000
```

## Test

```
npm --prefix backend test        # API tests against the Neon "test" database
npm --prefix frontend run e2e    # browser test, uses your installed Google Chrome
```

## Status

Milestone 1 (accounts, workspaces, Live Office shell, companion customization) is built.
Companions do not do work yet: every status is Idle, Paused, or Archived. AI providers arrive in milestone 2.
