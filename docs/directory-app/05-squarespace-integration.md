# Squarespace Integration

## Option A (Preferred): External app + iframe embed

### Why preferred
- Most reliable with Squarespace
- Keeps auth/API complexity off Squarespace pages
- Easy rollback/versioning

### Steps in Squarespace UI
1. Open page editor.
2. Add a `Code` block.
3. Paste iframe snippet.
4. Save and publish.

### Embed snippet
```html
<iframe
  src="https://app.example.com/embed?source=squarespace"
  title="Business Directory Albania"
  style="width:100%;min-height:1400px;border:0;overflow:hidden"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

### Domain, CORS, cookies, sessions
- Use first-party auth on `app.example.com`.
- API CORS allowlist: `https://app.example.com` and optional `https://www.yoursquarespace.com` only if needed.
- Prefer bearer-token auth (local storage + refresh strategy) to avoid third-party cookie issues in iframes.
- If cookies are used in iframe context, require `SameSite=None; Secure`.

### Theming to match Squarespace
- Pass theme params in query (`?theme=squarespace&accent=%23000000`).
- Map to CSS variables in app:
  - `--brand-color`
  - `--font-family`
  - `--surface`

### Admin security
- Admin panel on separate URL (`https://admin.example.com` or `/admin`).
- Never embed admin in Squarespace.
- Enforce server-side role checks for all admin APIs.

## Option B: Script widget injection (feasible, but less reliable)

### Steps in Squarespace UI
1. Add a `Code` block containing mount div + script.
2. Publish and test on desktop/mobile.

### Snippet
```html
<div id="directory-app-root"></div>
<script
  src="https://app.example.com/widget-loader.js"
  data-api-base="https://api.example.com/v1"
  data-locale="en"
  data-theme="squarespace"
  defer
></script>
```

### Notes and risks
- Squarespace may sanitize or constrain JS in some contexts.
- CSS collision risk with host page styles.
- Harder auth/session handling than iframe mode.
- Use shadow DOM where possible to isolate styles.

### CORS/security
- Restrict script origin and API CORS.
- Validate JWT on API regardless of embedding method.
- Keep admin tools out of injected widget.

## Recommendation
Use **Option A** as the production default.
