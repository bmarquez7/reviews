# Frontend Plan (Implementable)

Recommended stack:
- React + TypeScript + Vite
- React Router
- TanStack Query for API state
- i18next for JSON dictionaries
- Tailwind CSS or CSS variables for theme tokens

Embedding mode:
- `/embed` route optimized for iframe (minimal chrome)
- Standalone routes keep full navigation

## Pages

1. Directory Search (`/` or `/directory`)
- Search input
- Filters: category, country, region, city
- Sort: top rated, most reviewed, newest
- Business card list with weighted score and rating count

2. Business Profile (`/business/:businessId`)
- Business details + social links + categories
- Aggregate scores (weighted + optional unweighted)
- Locations list with per-location scores

3. Location Detail (`/location/:locationId`)
- Factor averages + distribution
- Secondary ratings block (not part of overall)
- Comments feed with threaded business replies
- Logged-in panel for rating/comment actions

4. User Settings (`/me/settings`)
- Profile fields
- Privacy controls: screen name, age visibility
- Language preference
- Policies acceptance status

5. Business Dashboard (`/business-dashboard`)
- Create/edit business info
- Manage locations
- Manage replies
- Submit and track appeals

6. Admin Panel (`/admin`)
- Moderation queue
- Flags
- Appeals review
- Role assignment
- Suspension actions
- Policies version bump
- Translation/category management

## Components

1. `LogoRating` (0..5 half-step)
- Custom icon (site logo) repeated as rating glyphs
- Supports read-only display and interactive input
- Keyboard support (`ArrowLeft/Right`, `Home/End`)

2. `FactorRatingForm`
- 7 primary factor inputs (half-step)
- Shows `ui.ratingScaleNotice`
- Computes preview overall score client-side

3. `SecondaryRatingsSection`
- 5 secondary ratings + optional notes
- Explicit label: excluded from overall score

4. `CommentEditor`
- Textarea with live word counter
- Enforces minimum 10 words
- Displays `ui.commentGuidance` + `ui.minWordsNotice`

5. `LanguageToggle`
- Switches among configured locales
- Persists to user profile when signed in
- Can load extra configured locales at runtime

6. `PoliciesAgreementModal`
- Uses `popup.*` keys
- 3 required checkboxes gate primary button
- Triggers at signup completion, first post, business onboarding

## Accessibility

- Semantic landmarks (`header/main/nav/footer`)
- All inputs with explicit labels
- `aria-live` for validation and moderation status changes
- Color contrast AA minimum
- Full keyboard traversal for filters/forms/modals
- Focus trap and restore in modal dialogs

## i18n implementation

- Store dictionaries in `/web/directory/i18n/*.json`
- `fallbackLng = 'en'`
- Canonical keys from provided JSON used for UI copy
- Additional languages can be added by dropping new JSON and adding locale metadata in admin/settings

## Language extension note

Support adding commonly requested languages in Albania by config (no code change), including:
- Macedonian (`mk`)
- Romani (`rmn`)
- Aromanian (`rup`)
- Additional Greek variants if needed by audience
