# Directory API Scaffold (Fastify + Supabase)

This is a backend scaffold for the Albania directory/ratings app.

## What is implemented

- Fastify TypeScript server
- Supabase clients (anon + service-role)
- Error envelope and typed API errors
- Auth helper (`requireAuth`, `requireRole`, `requirePoliciesAccepted`)
- Core routes:
  - Auth: signup/login/verify/logout/password reset
  - i18n: list supported languages
  - Users: `GET /users/me`, language preference, policy acceptance
  - Directory: categories, businesses list/detail, location detail
  - Ratings/comments: upsert rating, comment create/edit/delete, removal request
  - Business: create business/location, reply, appeals
  - Admin: moderation queue/actions, role assignment, suspend, policy version bump

## Prerequisites

1. Supabase project created.
2. Run SQL in `/Users/marquezfamily/Documents/New project/data/directory_schema.sql`.
3. Fill env file from `.env.example`.

## Run locally

```bash
cd /Users/marquezfamily/Documents/New project/apps/api
cp .env.example .env
npm install
npm run dev
```

Server starts at `http://localhost:4000`.

Swagger UI:
- `http://localhost:4000/docs`

Health endpoint:
- `GET http://localhost:4000/v1/health`

## Current local status (this machine)

Completed:
- `.env` created and prefilled with:
  - `APP_ORIGIN=http://localhost:5173`
  - `SUPABASE_URL=https://ezstysowvkqivwrcssla.supabase.co`
  - `SUPABASE_ANON_KEY=<prefilled>`
- Seed SQL prepared at `/Users/marquezfamily/Documents/New project/data/directory_seed.sql`
- Basic HTTP smoke requests prepared at `/Users/marquezfamily/Documents/New project/apps/api/smoke-test.http`

Blocked (requires user intervention):
- `node`/`npm` are not installed on this machine, so dependencies cannot be installed and server cannot be started.
- `SUPABASE_SERVICE_ROLE_KEY` is still a placeholder in `.env` and must be replaced with your real key.

## Key implementation behaviors

- Policy gate: posting endpoints require current `platform_config.current_policies_version` acceptance.
- Single rating per user per location: enforced by DB unique key + upsert.
- 10-word minimum comments: enforced in API.
- 30-day edit/delete window: enforced in API.
- Comment publication mode follows `platform_config.comments_premoderation`.

## Suggested next implementation steps

1. Add request/response JSON schemas per route for runtime validation + OpenAPI generation.
2. Add integration tests for policy gate, rating upsert, comment window rules.
3. Add caching and full-text search optimization for `GET /businesses`.
4. Add file attachment flow for phase-2 appeals.
5. Implement frontend app shell consuming these endpoints.

## Frontend shell (static)

A lightweight test frontend is available at:
- `/Users/marquezfamily/Documents/New project/web/directory/index.html`

Serve static files from `web/` (example):
```bash
cd /Users/marquezfamily/Documents/New\ project/web
python3 -m http.server 8080
```

Then open:
- `http://127.0.0.1:8080/directory/`
