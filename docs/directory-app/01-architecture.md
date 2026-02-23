# Directory + Ratings App Architecture (Squarespace Embeddable)

## 1) Recommended architecture (simplest reliable)

**Primary recommendation:** Host a standalone web app and embed it in Squarespace via `iframe`.

- Frontend: React + TypeScript + Vite (mobile-first SPA)
- API: Node.js (Fastify) REST API
- Database: PostgreSQL (Supabase-managed Postgres recommended)
- Auth: Supabase Auth (email verification) or custom JWT service
- Storage: Supabase Storage (profile images, future appeal attachments)
- Search/filter: Postgres indexes + optional trigram full-text
- Moderation queue: API-backed admin panel

Why this is easiest for Squarespace:
- No dependency on Squarespace internals
- Clean deployment lifecycle (Netlify/Vercel/Cloudflare Pages)
- Stable auth/session handling on your own domain
- Can still run as standalone app directly

## 2) Deployment topology

- `app.example.com` → frontend app (public directory + dashboards)
- `api.example.com` → REST API
- `db` → managed PostgreSQL
- Optional separate admin host: `admin.example.com`

Squarespace integration:
- Embed `https://app.example.com/embed?theme=squarespace` in a Code Block iframe.

## 3) Roles and RBAC

Roles:
- `consumer`
- `business_owner`
- `moderator`
- `admin`

Access model:
- API middleware checks auth + role + resource ownership.
- Admin can grant roles and backend access.
- Suspended accounts blocked from posting and business tools.

## 4) Moderation flow

Default mode: auto-publish + automatic flagging.
Config flag:
- `COMMENTS_PREMODERATION=true` => new comments become `pending`
- `COMMENTS_PREMODERATION=false` (default) => publish immediately and queue flagged content

Moderators can:
- approve/deny/remove ratings, comments, business replies
- suspend users/businesses
- create auditable actions

## 5) Policy acceptance gate

Required policy acceptance checkpoints:
1. after signup verification and before posting privileges
2. before first rating/comment if not accepted
3. during business account creation before business tools

Server-side enforcement:
- If missing or stale acceptance (version mismatch), API returns:
  - HTTP `403`
  - `{ "code": "POLICIES_NOT_ACCEPTED" }`

Stored per user:
- `policies_version`
- `policies_accepted_at`

Admin can bump current version in config table to force re-acceptance.

## 6) Scoring model

Location-level factors (affect overall):
- pricing transparency
- friendliness
- LGBTQ+ acceptance
- racial tolerance
- religious tolerance
- accessibility friendliness
- cleanliness

Computation:
- Store each factor as `numeric(2,1)` constrained to 0..5 half-step.
- `location_overall_raw` = average of 7 factors (full precision).
- UI display = rounded to nearest 0.5.

Secondary ratings (excluded from overall):
- pricing value
- child care availability
- child friendliness
- party size accommodations
- accessibility details

Business-level aggregation:
- Weighted average of location scores by rating count (primary shown)
- Optional unweighted average also shown for transparency

## 7) I18n strategy

- JSON dictionaries (`/web/directory/i18n/*.json`)
- Canonical key-based lookup (no hard-coded UI strings)
- Initial languages: `en`, `es`, `fr`, `sq`, `el`, `it`
- Fallback: English
- User preference persisted in DB
- Language selector supports adding more locales later (e.g. `mk`, `ro`, `rmn`, `rup`) via config table

## 8) Security and anti-abuse baseline

- One rating per user per location (DB unique constraint)
- Comment minimum 10 words (app-level validation)
- Rate limiting per IP + user
- Email verification required before posting
- Optional CAPTCHA on signup/comment creation
- Soft-delete + audit logging for moderation actions

## 9) Standalone + embed compatibility

- App runs normally at its own URL.
- Embed mode (`/embed`) hides standalone nav/footer and adapts height.
- If cross-site cookie issues appear in iframe contexts, use token-based auth (Authorization header) rather than third-party cookies.
