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
<div id="grow-albania-directory-wrap" style="width:100%;max-width:1400px;margin:0 auto;">
  <iframe
    id="grow-albania-directory-frame"
    src="https://grow-albania-reviews.netlify.app/directory/embed.html"
    title="Grow Albania Directory"
    loading="lazy"
    scrolling="no"
    style="width:100%;min-height:1200px;border:0;overflow:hidden;background:#fff;display:block;border-radius:12px;"
    allow="clipboard-write; geolocation"
    referrerpolicy="strict-origin-when-cross-origin">
  </iframe>
</div>

<script>
(function () {
  var iframe = document.getElementById('grow-albania-directory-frame');
  if (!iframe) return;

  function setFrameHeight(height) {
    var next = Math.max(900, Number(height) || 0);
    iframe.style.height = next + 'px';
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== 'https://grow-albania-reviews.netlify.app') return;
    var data = event.data || {};
    if (data.type === 'directory:resize') setFrameHeight(data.height);
  });

  iframe.addEventListener('load', function () {
    setTimeout(function () {
      setFrameHeight(1400);
    }, 300);
  });
})();
</script>
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
- In launcher mode, embedded search can redirect users into the full standalone Netlify app for deeper interactions instead of keeping business pages and lightboxes inside the iframe.

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
