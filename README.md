# Tirana Events Calendar (Squarespace Embed)

This project provides:
- A public calendar widget with filters, language switcher, and submissions
- An admin dashboard for approvals and edits
- An optional RSS/ICS importer for web-based event feeds

Everything is designed to be embedded inside a Squarespace page via a Code block.

## 1) Supabase Setup

1. Create a new Supabase project.
2. Go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key
3. Go to **SQL Editor** and run the schema in `data/schema.sql`.
4. Go to **Authentication → Users** and create one admin user (your email/password).
5. Optional: Under **Authentication → URL Configuration**, add your hosted widget/admin URLs to the allowed redirect list.

## 2) Configure the Frontend

Edit `web/shared/config.js` and set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `EVENT_IMAGE_BUCKET` (default: `event-posters`)
- `DEFAULT_UI_LANG` (default `en`)

## 2.1) Enable Direct Image Uploads (Supabase Storage)

Run this SQL once in Supabase SQL Editor:

```sql
insert into storage.buckets (id, name, public)
values ('event-posters', 'event-posters', true)
on conflict (id) do nothing;

create policy "Public can upload posters"
on storage.objects
for insert
to public
with check (bucket_id = 'event-posters');

create policy "Public can read posters"
on storage.objects
for select
to public
using (bucket_id = 'event-posters');

create policy "Authenticated can update posters"
on storage.objects
for update
to authenticated
using (bucket_id = 'event-posters')
with check (bucket_id = 'event-posters');

create policy "Authenticated can delete posters"
on storage.objects
for delete
to authenticated
using (bucket_id = 'event-posters');
```

## 3) Host the Widget + Admin

You need a static host (free): Netlify, Vercel, or GitHub Pages. If you want the simplest option, use Netlify.

### Option A: Netlify (recommended)
1. Create a new Netlify site.
2. Drag and drop the `web/` folder to deploy.
3. Netlify will give you two URLs:
   - `https://<site>.netlify.app/widget/`
   - `https://<site>.netlify.app/admin/`

### Option B: GitHub Pages
1. Push this repo to GitHub.
2. In GitHub Pages settings, set the root to `/web`.
3. Your URLs will be:
   - `https://<user>.github.io/<repo>/widget/`
   - `https://<user>.github.io/<repo>/admin/`

## 4) Add to Squarespace (grow-albania.com)

1. In Squarespace, create a new page (e.g. **Tirana Events**).
2. Add a **Code** block to the page.
3. Paste this embed code (replace the URL with your hosted widget URL):

```html
<iframe
  src="https://YOUR-HOST/widget/"
  style="width:100%;height:1500px;border:0;"
  loading="lazy"
  title="Tirana Events Calendar"
></iframe>
```

You can adjust the height as needed.

## 5) Admin Login

Open your admin URL and sign in using the Supabase user you created.

Admin URL example:
- `https://YOUR-HOST/admin/`

## 6) Importing Events (Web Feeds)

The importer reads RSS/Atom/ICS URLs and adds them as **pending** events for approval.

1. Copy `data/sources.example.txt` to `data/sources.txt` and add URLs (one per line).
2. In `scripts/`, create a `.env` file:

```bash
SUPABASE_URL="YOUR_SUPABASE_URL"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
SOURCES_FILE="../data/sources.txt"
```

3. Install dependencies:

```bash
cd scripts
npm install
```

4. Run the importer:

```bash
node import_events.mjs
```

### Notes
- You must use the **service role key** for the importer.
- The importer is conservative; it puts everything in `pending`.

## 7) How Submissions Work

- Anyone can submit events from the widget form.
- Submissions are saved as `pending`.
- You approve them from the admin dashboard.

## 8) Customize Areas / Event Types

Edit `web/shared/constants.js` to change:
- Event types
- Areas list
- Supported languages

## 9) Price Sorting

Sorting by price uses `price_min`.
If `price_min` is empty, the event is treated as `0`.

---

If you want, I can also:
- Add a map view
- Add recurring events
- Add a “featured” highlight section

## Directory + Ratings App Spec Pack

A complete implementation-ready spec for the Albania business directory/rating system is available here:

- `/Users/marquezfamily/Documents/New project/docs/directory-app/01-architecture.md`
- `/Users/marquezfamily/Documents/New project/data/directory_schema.sql`
- `/Users/marquezfamily/Documents/New project/docs/directory-app/03-api.md`
- `/Users/marquezfamily/Documents/New project/docs/directory-app/04-frontend.md`
- `/Users/marquezfamily/Documents/New project/docs/directory-app/05-squarespace-integration.md`
- `/Users/marquezfamily/Documents/New project/docs/directory-app/06-policies-copy.md`
- `/Users/marquezfamily/Documents/New project/docs/directory-app/07-popup-agreement.md`
- `/Users/marquezfamily/Documents/New project/web/directory/i18n/*.json`
