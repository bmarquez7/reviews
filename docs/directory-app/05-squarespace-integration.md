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
  var origin = 'https://grow-albania-reviews.netlify.app';
  var wrap = document.getElementById('grow-albania-directory-wrap');
  var iframe = document.getElementById('grow-albania-directory-frame');
  if (!wrap || !iframe) return;

  var overlayActive = false;
  var savedScrollY = 0;
  var mobileQuery = window.matchMedia('(max-width: 920px)');

  function setFrameHeight(height) {
    if (overlayActive && mobileQuery.matches) return;
    var next = Math.max(900, Number(height) || 0);
    iframe.style.height = next + 'px';
  }

  function restoreInlineEmbed() {
    overlayActive = false;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    wrap.style.position = '';
    wrap.style.inset = '';
    wrap.style.zIndex = '';
    wrap.style.width = '';
    wrap.style.maxWidth = '1400px';
    wrap.style.height = '';
    wrap.style.margin = '0 auto';
    iframe.style.height = '';
    iframe.style.minHeight = '1200px';
    iframe.style.borderRadius = '12px';
    window.scrollTo(0, savedScrollY || 0);
  }

  function enableMobileFullscreen() {
    if (!mobileQuery.matches) return;
    overlayActive = true;
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.zIndex = '2147483000';
    wrap.style.width = '100vw';
    wrap.style.maxWidth = '100vw';
    wrap.style.height = '100dvh';
    wrap.style.margin = '0';
    iframe.style.height = '100dvh';
    iframe.style.minHeight = '100dvh';
    iframe.style.borderRadius = '0';
    window.scrollTo(0, 0);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    var data = event.data || {};

    if (data.type === 'directory:resize') {
      setFrameHeight(data.height);
      return;
    }

    if (data.type === 'directory:overlay-state') {
      if (data.active) enableMobileFullscreen();
      else restoreInlineEmbed();
    }
  });

  window.addEventListener('resize', function () {
    if (!mobileQuery.matches && overlayActive) restoreInlineEmbed();
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
- If fullscreen mobile modals are required, the parent embed script must cooperate. An iframe cannot visually escape its own bounds without the host page resizing or repositioning it.

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
