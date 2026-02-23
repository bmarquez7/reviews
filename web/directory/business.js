const $ = (id) => document.getElementById(id);

const THEME_DEFAULTS = { brand: '#0f6a4d', bg: '#f5f2eb', card: '#fffdf7', iconUrl: './assets/new-roots-logo.png' };
const PROD_API_BASE = 'https://grow-albania-directory-api.onrender.com/v1';

const params = new URLSearchParams(window.location.search);
const businessId = params.get('businessId');
const apiBase = params.get('apiBase') || localStorage.getItem('dir.apiBase') || PROD_API_BASE;
const state = { token: localStorage.getItem('dir.token') || '', page: 1, pageSize: 10, total: 0 };

const authHeaders = () => (state.token ? { Authorization: `Bearer ${state.token}` } : {});
const errMsg = (err) => err?.error?.message || 'Request failed';

const showToast = (type, message) => {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

const req = async (path, options = {}) => {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json;
  return json;
};

const logoRatingMarkup = (score) => {
  if (score == null || Number.isNaN(Number(score))) return '<span class="muted">n/a</span>';
  const safe = Math.max(0, Math.min(5, Number(score)));
  const stepped = Math.round(safe * 2) / 2;
  const items = Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, stepped - i));
    const stepFill = fill >= 1 ? 1 : fill >= 0.5 ? 0.5 : 0;
    const pct = `${Math.round(stepFill * 100)}%`;
    return `<span class="logo-token" style="--fill:${pct}"></span>`;
  }).join('');
  return `<span class="logo-rating">${items}</span>`;
};

const applyTheme = () => {
  const saved = localStorage.getItem('dir.theme');
  const theme = saved ? JSON.parse(saved) : THEME_DEFAULTS;
  document.documentElement.style.setProperty('--brand', theme.brand);
  document.documentElement.style.setProperty('--brand-2', theme.brand);
  document.documentElement.style.setProperty('--bg', theme.bg);
  document.documentElement.style.setProperty('--card', theme.card);
  document.documentElement.style.setProperty('--review-icon-url', `url("${theme.iconUrl}")`);
};

const openImageLightbox = (url) => {
  $('imageLightboxImg').src = url;
  $('imageLightbox').classList.remove('hidden');
};

const closeImageLightbox = () => $('imageLightbox').classList.add('hidden');

const initProfileTabs = () => {
  const tabHost = $('profileTabs');
  if (!tabHost) return;
  const tabs = Array.from(tabHost.querySelectorAll('.tab-btn[data-target]'));
  const sections = tabs
    .map((tab) => document.getElementById(tab.dataset.target))
    .filter(Boolean);
  if (!tabs.length || !sections.length) return;

  const setActive = (id) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.target === id;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = document.getElementById(tab.dataset.target);
      if (!target) return;
      const topbar = document.querySelector('.topbar');
      const tabsCard = document.querySelector('.profile-tabs-card');
      const offset = (topbar?.offsetHeight || 0) + (tabsCard?.offsetHeight || 0) + 12;
      const top = window.scrollY + target.getBoundingClientRect().top - offset;
      window.scrollTo({ top, behavior: 'smooth' });
      history.replaceState(null, '', `#${target.id}`);
      setActive(target.id);
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      setActive(visible[0].target.id);
    },
    {
      root: null,
      rootMargin: '-130px 0px -55% 0px',
      threshold: [0.15, 0.25, 0.5]
    }
  );

  sections.forEach((section) => observer.observe(section));
  const hashId = window.location.hash?.replace('#', '');
  if (hashId && sections.some((section) => section.id === hashId)) {
    setActive(hashId);
    window.setTimeout(() => {
      document.getElementById(hashId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 120);
  } else {
    setActive(sections[0].id);
  }
};

const mapUrlFor = (loc) => {
  const q = encodeURIComponent(`${loc.address_line}, ${loc.city}, ${loc.country}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
};

const renderBusiness = (b) => {
  $('bizPageTitle').textContent = b.name || 'Business';
  $('bizHeaderMeta').innerHTML = `
    <div class="row gap-sm center">${logoRatingMarkup(b.scores?.weighted_overall_display)}<strong>${b.scores?.weighted_overall_display ?? 'n/a'} / 5</strong> <span class="muted">(${b.scores?.business_rating_count ?? 0} reviews)</span></div>
    <div class="muted">${b.is_claimed ? 'Claimed' : 'Unclaimed'} • ${b.categories?.map((c) => c.categories?.slug || c.slug || '').filter(Boolean).join(', ') || 'General'}</div>
  `;

  $('bizGallery').innerHTML = (b.media_urls || []).length
    ? b.media_urls
        .map((url) => `<button type="button" class="media-link" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Business photo" /></button>`)
        .join('')
    : '<div class="muted">No photos yet.</div>';

  const primaryLoc = b.locations?.[0];
  const links = [];
  if (b.website_url) links.push(`<a class="chip link-chip" href="${b.website_url}" target="_blank" rel="noopener">Website</a>`);
  if (b.social_facebook) links.push(`<a class="chip link-chip" href="${b.social_facebook}" target="_blank" rel="noopener">Facebook</a>`);
  if (b.social_instagram) links.push(`<a class="chip link-chip" href="${b.social_instagram}" target="_blank" rel="noopener">Instagram</a>`);
  if (b.social_tiktok) links.push(`<a class="chip link-chip" href="${b.social_tiktok}" target="_blank" rel="noopener">TikTok</a>`);
  if (b.primary_phone) links.push(`<a class="chip link-chip" href="tel:${b.primary_phone}">${b.primary_phone}</a>`);
  if (b.primary_email) links.push(`<a class="chip link-chip" href="mailto:${b.primary_email}">${b.primary_email}</a>`);
  if (primaryLoc) links.push(`<a class="chip link-chip" href="${mapUrlFor(primaryLoc)}" target="_blank" rel="noopener">Open in Google Maps</a>`);
  $('bizLinks').innerHTML = links.join('');

  $('bizInfo').innerHTML = `
    <div><strong>${b.name}</strong></div>
    <div class="muted">${b.description || 'No description available yet.'}</div>
    <div class="muted">${b.mission_statement || ''}</div>
  `;

  $('bizLocations').innerHTML = (b.locations || []).length
    ? b.locations
        .map(
          (loc) =>
            `<article class="item"><div class="item-title">${loc.location_name || `${loc.city} location`}</div><div class="item-sub">${loc.address_line}, ${loc.city}, ${loc.country}</div><div class="row gap-sm"><a class="chip link-chip" target="_blank" rel="noopener" href="${mapUrlFor(loc)}">Map</a>${loc.location_phone ? `<a class="chip link-chip" href="tel:${loc.location_phone}">${loc.location_phone}</a>` : ''}${loc.location_email ? `<a class="chip link-chip" href="mailto:${loc.location_email}">Email</a>` : ''}</div></article>`
        )
        .join('')
    : '<div class="muted">No locations available.</div>';
};

const renderReviewSummary = (summary, distribution) => {
  if (!summary) {
    $('ratingSummary').innerHTML = '<span class="muted">No ratings yet.</span>';
    $('ratingDistribution').innerHTML = '';
    return;
  }

  $('ratingSummary').innerHTML = [
    `Overall: ${Number(summary.overall_display).toFixed(1)}`,
    `Reviews: ${summary.rating_count}`,
    `Pricing: ${Number(summary.factors.pricing_transparency || 0).toFixed(1)}`,
    `Friendly: ${Number(summary.factors.friendliness || 0).toFixed(1)}`,
    `LGBTQ+: ${Number(summary.factors.lgbtq_acceptance || 0).toFixed(1)}`,
    `Racial: ${Number(summary.factors.racial_tolerance || 0).toFixed(1)}`,
    `Religious: ${Number(summary.factors.religious_tolerance || 0).toFixed(1)}`,
    `Access: ${Number(summary.factors.accessibility_friendliness || 0).toFixed(1)}`,
    `Clean: ${Number(summary.factors.cleanliness || 0).toFixed(1)}`
  ]
    .map((t) => `<span class="chip">${t}</span>`)
    .join('');

  $('ratingDistribution').innerHTML = (distribution || [])
    .filter((x) => Number(x.count) > 0)
    .map((x) => `<span class="chip">${Number(x.score).toFixed(1)}: ${x.count}</span>`)
    .join('');
};

const renderReviews = (items) => {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  $('reviewsPageInfo').textContent = `Page ${state.page} / ${totalPages} (${state.total} reviews)`;
  $('reviewsPrev').disabled = state.page <= 1;
  $('reviewsNext').disabled = state.page >= totalPages;

  if (!items.length) {
    $('reviewsFeed').innerHTML = '<div class="muted">No reviews yet.</div>';
    return;
  }

  $('reviewsFeed').innerHTML = items
    .map((r) => {
      const rv = r.reviewer || {};
      const rating = r.rating || {};
      const factors = rating.factors || {};
      const media = (r.media_urls || [])
        .map((url) => `<button type="button" class="media-link" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Review image" /></button>`)
        .join('');
      return `
      <article class="review-card">
        <div class="review-head">
          <div class="review-user">
            ${rv.profile_image_url ? `<img class="avatar" src="${rv.profile_image_url}" alt="${rv.screen_name || 'Reviewer'}" />` : `<span class="avatar">${(rv.screen_name || 'US').slice(0,2).toUpperCase()}</span>`}
            <div>
              <div><strong>${rv.screen_name || 'User'}</strong></div>
              <div class="review-meta">${rv.country_of_origin || ''} ${rv.age_range_public ? `• ${rv.age_range_public}` : ''}</div>
            </div>
          </div>
          <div class="row gap-sm center">${logoRatingMarkup(rating.overall_score_display)}<strong>${rating.overall_score_display ?? 'n/a'}</strong></div>
        </div>
        <div class="chips">
          <span class="chip">Pricing ${Number(factors.pricing_transparency || 0).toFixed(1)}</span>
          <span class="chip">Friendly ${Number(factors.friendliness || 0).toFixed(1)}</span>
          <span class="chip">LGBTQ+ ${Number(factors.lgbtq_acceptance || 0).toFixed(1)}</span>
          <span class="chip">Racial ${Number(factors.racial_tolerance || 0).toFixed(1)}</span>
          <span class="chip">Religious ${Number(factors.religious_tolerance || 0).toFixed(1)}</span>
          <span class="chip">Access ${Number(factors.accessibility_friendliness || 0).toFixed(1)}</span>
          <span class="chip">Clean ${Number(factors.cleanliness || 0).toFixed(1)}</span>
        </div>
        <div class="review-text">${r.content || ''}</div>
        <div class="media-grid">${media}</div>
      </article>`;
    })
    .join('');
};

const loadBusiness = async () => {
  const b = await req(`/businesses/${businessId}`);
  renderBusiness(b.data);
};

const loadReviews = async () => {
  const data = await req(`/businesses/${businessId}/reviews?page=${state.page}&page_size=${state.pageSize}`);
  state.total = Number(data?.data?.total || 0);
  renderReviewSummary(data?.data?.summary, data?.data?.rating_distribution);
  renderReviews(data?.data?.items || []);
};

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value })
    });
    state.token = data.data.access_token;
    localStorage.setItem('dir.token', state.token);
    showToast('ok', 'Logged in');
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('logout').addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem('dir.token');
  showToast('ok', 'Logged out');
});

$('claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) {
    showToast('err', 'Login first to submit claim request.');
    return;
  }
  try {
    const body = { message: $('claimMessage').value.trim() || undefined };
    const data = await req(`/businesses/${businessId}/claim-request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    showToast('ok', data?.data?.status === 'already_owner' ? 'You already own this business.' : 'Claim request submitted.');
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('locationRequestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) {
    showToast('err', 'Login first to submit location request.');
    return;
  }

  const address = $('reqLocationAddress').value.trim();
  const city = $('reqLocationCity').value.trim();
  const country = $('reqLocationCountry').value.trim();
  if (!address || !city || !country) {
    showToast('err', 'Address, city, and country are required.');
    return;
  }

  const details = {
    location_name: $('reqLocationName').value.trim() || null,
    address_line: address,
    city,
    region: $('reqLocationRegion').value.trim() || null,
    country
  };

  try {
    await req('/appeals', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        target_type: 'business',
        target_business_id: businessId,
        reason: 'location_add_request',
        details: `Pending location verification request: ${JSON.stringify(details)}`
      })
    });
    showToast('ok', 'Location request submitted for verification.');
    $('locationRequestForm').reset();
    $('reqLocationCountry').value = 'Albania';
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('reviewsPrev').addEventListener('click', async () => {
  state.page = Math.max(1, state.page - 1);
  try { await loadReviews(); } catch (err) { showToast('err', errMsg(err)); }
});

$('reviewsNext').addEventListener('click', async () => {
  state.page += 1;
  try { await loadReviews(); } catch (err) { showToast('err', errMsg(err)); }
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'imageLightbox') closeImageLightbox();
  if (e.target.id === 'imageLightboxClose') closeImageLightbox();
  const mediaBtn = e.target.closest('[data-image-url]');
  if (mediaBtn) openImageLightbox(mediaBtn.dataset.imageUrl);
});

(async () => {
  applyTheme();
  initProfileTabs();
  if (!businessId) {
    $('bizHeaderMeta').textContent = 'Missing businessId in URL.';
    return;
  }
  try {
    await Promise.all([loadBusiness(), loadReviews()]);
  } catch (err) {
    $('bizHeaderMeta').textContent = errMsg(err);
  }
})();
