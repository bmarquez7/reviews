const $ = (id) => document.getElementById(id);

const FACTORS = [
  ['pricing_transparency', 'Pricing transparency'],
  ['friendliness', 'Friendliness'],
  ['lgbtq_acceptance', 'LGBTQ+ acceptance'],
  ['racial_tolerance', 'Racial tolerance'],
  ['religious_tolerance', 'Religious tolerance'],
  ['accessibility_friendliness', 'Accessibility friendliness'],
  ['cleanliness', 'Cleanliness']
];

const THEME_DEFAULTS = { brand: '#0f6a4d', bg: '#f5f2eb', card: '#fffdf7', iconUrl: './assets/new-roots-logo.png' };

const resolveInitialApiBase = () => {
  const saved = localStorage.getItem('dir.apiBase');
  if (saved) return saved;

  const params = new URLSearchParams(window.location.search);
  const fromParam = params.get('apiBase') || params.get('api');
  if (fromParam) {
    localStorage.setItem('dir.apiBase', fromParam);
    return fromParam;
  }

  const fromGlobal = typeof window.DIRECTORY_API_BASE === 'string' ? window.DIRECTORY_API_BASE.trim() : '';
  if (fromGlobal) return fromGlobal;

  if (window.location.hostname.endsWith('netlify.app')) {
    return `${window.location.origin}/v1`;
  }

  return 'http://127.0.0.1:4000/v1';
};

const state = {
  reviewSort: "newest",
  reviewFilter: "all",
  reviewPage: 1,
  reviewPageSize: 5,
  reviewRaw: [],
  apiBase: resolveInitialApiBase(),
  token: localStorage.getItem('dir.token') || '',
  businesses: [],
  categories: [],
  selectedBusiness: null,
  selectedLocation: null,
  factors: Object.fromEntries(FACTORS.map(([key]) => [key, 4.5]))
};

$('apiBase').value = state.apiBase;

const setOut = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const errMsg = (err) => err?.error?.message || 'Request failed';
const authHeaders = () => (state.token ? { Authorization: `Bearer ${state.token}` } : {});

const showToast = (type, message) => {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

const req = async (path, options = {}) => {
  const res = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json;
  return json;
};

const applyTheme = (theme) => {
  document.documentElement.style.setProperty('--brand', theme.brand);
  document.documentElement.style.setProperty('--brand-2', theme.brand);
  document.documentElement.style.setProperty('--bg', theme.bg);
  document.documentElement.style.setProperty('--card', theme.card);
  document.documentElement.style.setProperty('--review-icon-url', `url("${theme.iconUrl}")`);
  $('themeBrand').value = theme.brand;
  $('themeBg').value = theme.bg;
  $('themeCard').value = theme.card;
  $('themeIconUrl').value = theme.iconUrl;
};

const loadTheme = () => {
  const saved = localStorage.getItem('dir.theme');
  const theme = saved ? JSON.parse(saved) : THEME_DEFAULTS;
  applyTheme(theme);
};

const saveTheme = () => {
  const theme = {
    brand: $('themeBrand').value,
    bg: $('themeBg').value,
    card: $('themeCard').value,
    iconUrl: $('themeIconUrl').value.trim() || THEME_DEFAULTS.iconUrl
  };
  localStorage.setItem('dir.theme', JSON.stringify(theme));
  applyTheme(theme);
};

const logoRatingMarkup = (score) => {
  if (score == null || Number.isNaN(Number(score))) return '<span class="muted">n/a</span>';
  const safe = Math.max(0, Math.min(5, Number(score)));
  const stepped = Math.round(safe * 2) / 2;
  const items = Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, stepped - i));
    const pct = `${Math.round(fill * 100)}%`;
    return `<span class="logo-token"><span class="logo-fill" style="--fill:${pct}"></span></span>`;
  }).join('');
  return `<span class="logo-rating" aria-label="Rating ${stepped} out of 5">${items}</span>`;
};

const renderFactorIcons = (value) => {
  const safe = Math.max(0, Math.min(5, Number(value)));
  return Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, safe - i));
    const pct = `${Math.round(fill * 100)}%`;
    return `<span class="logo-token" data-slot="${i}" role="button" tabindex="0" aria-label="Set rating"><span class="logo-fill" style="--fill:${pct}"></span></span>`;
  }).join('');
};

const renderSliders = () => {
  $('factorSliders').innerHTML = FACTORS.map(([key, label]) => {
    const value = state.factors[key];
    return `<div class="slider-item" data-factor-wrap="${key}"><div class="slider-head"><span>${label}</span><strong id="factor-val-${key}">${value.toFixed(1)}</strong></div><div class="factor-logo-input" data-factor="${key}">${renderFactorIcons(value)}</div><div class="factor-help">Click left/right half of each icon for .5 increments</div></div>`;
  }).join('');
};

const renderCategoryChips = () => {
  $('categoryChips').innerHTML = state.categories.length ? state.categories.map((c) => `<span class="chip">${c.slug}</span>`).join('') : '<span class="muted">Load categories to display chips.</span>';
};

const renderBusinesses = () => {
  const search = $('businessSearch').value.trim().toLowerCase();
  const filtered = state.businesses.filter((b) => b.name.toLowerCase().includes(search));
  $('businessesList').innerHTML = !filtered.length
    ? '<div class="muted">No businesses found.</div>'
    : filtered.map((b) => `<article class="item ${state.selectedBusiness?.id === b.id ? 'active' : ''}" data-business-id="${b.id}"><div class="item-title">${b.name}</div><div class="rating-row">${logoRatingMarkup(b.scores?.weighted_overall_display)}<span class="item-sub">${b.scores?.weighted_overall_display ?? 'n/a'} / 5</span></div><div class="item-sub">Reviews: ${b.scores?.business_rating_count ?? 0}</div><div class="item-sub">Locations: ${b.locations_count ?? 0}</div></article>`).join('');
};

const renderBusinessDetail = () => {
  if (!state.selectedBusiness) {
    $('businessDetail').textContent = 'Pick a business from the list.';
    $('locationsList').innerHTML = '<div class="muted">No locations loaded.</div>';
    return;
  }
  const b = state.selectedBusiness;
  $('businessDetail').innerHTML = `<div><strong>${b.name}</strong></div><div class="muted">${b.description || 'No description yet.'}</div><div class="rating-row">${logoRatingMarkup(b.scores?.weighted_overall_display)}<span class="item-sub">${b.scores?.weighted_overall_display ?? 'n/a'} / 5</span></div>`;
  $('locationsList').innerHTML = !b.locations?.length
    ? '<div class="muted">No locations yet. Use Business Tools to create one.</div>'
    : b.locations.map((loc) => `<article class="item ${state.selectedLocation?.id === loc.id ? 'active' : ''}" data-location-id="${loc.id}"><div class="item-title">${loc.location_name || `${loc.city} location`}</div><div class="item-sub">${loc.address_line}, ${loc.city}, ${loc.country}</div></article>`).join('');
};

const renderSelectedLocationMeta = () => {
  $('selectedLocationMeta').textContent = state.selectedLocation
    ? `Selected: ${state.selectedLocation.location_name || state.selectedLocation.id} (${state.selectedLocation.city}, ${state.selectedLocation.country})`
    : 'No location selected.';
};

const initialsFromUser = (userId) => {
  if (!userId) return 'US';
  return userId.slice(0, 2).toUpperCase();
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
};

const renderLocationScores = (scores) => {
  if (!scores) {
    $('locationScores').innerHTML = '<span class="muted">No score data yet.</span>';
    return;
  }

  const chips = [
    ['Overall', scores.overall_score_display],
    ['Pricing', scores.pricing_transparency_avg],
    ['Friendly', scores.friendliness_avg],
    ['LGBTQ+', scores.lgbtq_acceptance_avg],
    ['Racial', scores.racial_tolerance_avg],
    ['Religious', scores.religious_tolerance_avg],
    ['Access', scores.accessibility_friendliness_avg],
    ['Clean', scores.cleanliness_avg]
  ]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<span class="chip">${k}: ${Number(v).toFixed(1)}</span>`)
    .join('');

  $('locationScores').innerHTML = chips || '<span class="muted">No score data yet.</span>';
};

const renderReviews = (comments = []) => {
  let working = [...comments];

  if (state.reviewFilter === 'with_reply') {
    working = working.filter((c) => (c.business_replies || []).length > 0);
  } else if (state.reviewFilter === 'no_reply') {
    working = working.filter((c) => (c.business_replies || []).length === 0);
  }

  if (state.reviewSort === 'newest') {
    working.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (state.reviewSort === 'oldest') {
    working.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  } else if (state.reviewSort === 'longest') {
    working.sort((a, b) => (b.content || '').length - (a.content || '').length);
  }

  const totalPages = Math.max(1, Math.ceil(working.length / state.reviewPageSize));
  if (state.reviewPage > totalPages) state.reviewPage = totalPages;
  const pageStart = (state.reviewPage - 1) * state.reviewPageSize;
  const pageRows = working.slice(pageStart, pageStart + state.reviewPageSize);

  $('reviewsPageInfo').textContent = `Page ${state.reviewPage} / ${totalPages} (${working.length} reviews)`;
  $('reviewsPrev').disabled = state.reviewPage <= 1;
  $('reviewsNext').disabled = state.reviewPage >= totalPages;

  if (!pageRows.length) {
    $('reviewsFeed').innerHTML = '<div class="muted">No reviews yet for this location.</div>';
    return;
  }

  $('reviewsFeed').innerHTML = pageRows
    .map((c) => {
      const replies = (c.business_replies || [])
        .map((r) => `<div class="reply-card"><div class="review-meta">Business reply · ${fmtDate(r.created_at)}</div><div class="review-text">${r.content || ''}</div></div>`)
        .join('');

      const visit = c.visit_month && c.visit_year ? `Visited ${c.visit_month}/${c.visit_year}` : 'Visit date not provided';

      return `
        <article class="review-card">
          <div class="review-head">
            <div class="review-user">
              <span class="avatar">${initialsFromUser(c.user_id)}</span>
              <div>
                <div><strong>User ${initialsFromUser(c.user_id)}</strong></div>
                <div class="review-meta">${visit}</div>
              </div>
            </div>
            <div class="review-meta">${fmtDate(c.created_at)}</div>
          </div>
          <div class="review-text">${c.content || ''}</div>
          ${replies}
        </article>
      `;
    })
    .join('');
};

const loadCategories = async () => { const data = await req('/categories'); state.categories = data.data || []; renderCategoryChips(); };
const loadBusinesses = async () => { const data = await req('/businesses'); state.businesses = data.data.items || []; renderBusinesses(); };

const loadBusinessDetail = async (businessId) => {
  const data = await req(`/businesses/${businessId}`);
  state.selectedBusiness = data.data;
  state.selectedLocation = null;
  renderBusinesses(); renderBusinessDetail(); renderSelectedLocationMeta();
  $('editBizName').value = data.data.name || '';
  $('editBizDescription').value = data.data.description || '';
  $('locationScores').innerHTML = '<span class="muted">Select a location to view scores.</span>';
  $('reviewsFeed').innerHTML = '<div class="muted">Select a location to view reviews.</div>';
  $('reviewsPageInfo').textContent = 'Page 1';
};

const loadLocationDetail = async (locationId) => {
  const data = await req(`/locations/${locationId}`);
  state.selectedLocation = data.data.location;
  state.reviewRaw = data.data.comments || [];
  state.reviewPage = 1;
  renderBusinessDetail(); renderSelectedLocationMeta();
  renderLocationScores(data.data.scores);
  renderReviews(state.reviewRaw);
};

const requireLogin = () => {
  if (state.token) return true;
  showToast('err', 'Please login first for this action.');
  return false;
};

$('saveApiBase').addEventListener('click', () => { state.apiBase = $('apiBase').value.trim(); localStorage.setItem('dir.apiBase', state.apiBase); showToast('ok', 'API base saved'); });
$('themeBrand').addEventListener('input', saveTheme);
$('themeBg').addEventListener('input', saveTheme);
$('themeCard').addEventListener('input', saveTheme);
$('themeIconUrl').addEventListener('change', saveTheme);
$('resetTheme').addEventListener('click', () => { localStorage.removeItem('dir.theme'); applyTheme(THEME_DEFAULTS); showToast('ok', 'Theme reset'); });

$('factorSliders').addEventListener('click', (e) => {
  const token = e.target.closest('.logo-token');
  if (!token) return;
  const group = token.closest('.factor-logo-input');
  const key = group?.dataset.factor;
  if (!key) return;

  const slot = Number(token.dataset.slot);
  const rect = token.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const half = clickX < rect.width / 2 ? 0.5 : 1;
  const value = Math.max(0, Math.min(5, slot + half));

  state.factors[key] = value;
  group.innerHTML = renderFactorIcons(value);
  $(`factor-val-${key}`).textContent = value.toFixed(1);
});

$('factorSliders').addEventListener('keydown', (e) => {
  const token = e.target.closest('.logo-token');
  if (!token) return;
  const group = token.closest('.factor-logo-input');
  const key = group?.dataset.factor;
  if (!key) return;

  let value = Number(state.factors[key] ?? 0);
  let handled = true;

  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    value += 0.5;
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    value -= 0.5;
  } else if (e.key === 'Home') {
    value = 0;
  } else if (e.key === 'End') {
    value = 5;
  } else {
    handled = false;
  }

  if (!handled) return;
  e.preventDefault();

  value = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  state.factors[key] = value;
  group.innerHTML = renderFactorIcons(value);
  $(`factor-val-${key}`).textContent = value.toFixed(1);
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
    state.token = data.data.access_token;
    localStorage.setItem('dir.token', state.token);
    setOut('authOut', data);
    showToast('ok', 'Logged in');
  } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); }
});

$('logout').addEventListener('click', () => { state.token = ''; localStorage.removeItem('dir.token'); setOut('authOut', 'Logged out'); showToast('ok', 'Logged out'); });
$('loadMe').addEventListener('click', async () => { try { if (!requireLogin()) return; setOut('authOut', await req('/users/me', { headers: authHeaders() })); } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); } });
$('acceptPolicies').addEventListener('click', async () => {
  try {
    if (!requireLogin()) return;
    const data = await req('/users/me/policies/accept', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ policies_version: '2026-02-17', accepted_via: 'pre_post', checkboxes: { firsthand_only: true, professional_no_hate: true, moderation_understood: true } }) });
    setOut('authOut', data); showToast('ok', 'Policies accepted');
  } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); }
});

$('loadCategories').addEventListener('click', async () => { try { await loadCategories(); showToast('ok', 'Categories loaded'); } catch (err) { showToast('err', errMsg(err)); } });
$('loadBusinesses').addEventListener('click', async () => { try { await loadBusinesses(); showToast('ok', 'Businesses refreshed'); } catch (err) { showToast('err', errMsg(err)); } });
$('businessSearch').addEventListener('input', renderBusinesses);
$('reviewSort').addEventListener('change', (e) => {
  state.reviewSort = e.target.value;
  state.reviewPage = 1;
  renderReviews(state.reviewRaw);
});
$('reviewFilter').addEventListener('change', (e) => {
  state.reviewFilter = e.target.value;
  state.reviewPage = 1;
  renderReviews(state.reviewRaw);
});
$('reviewsPrev').addEventListener('click', () => {
  state.reviewPage = Math.max(1, state.reviewPage - 1);
  renderReviews(state.reviewRaw);
});
$('reviewsNext').addEventListener('click', () => {
  state.reviewPage += 1;
  renderReviews(state.reviewRaw);
});

$('businessesList').addEventListener('click', async (e) => { const card = e.target.closest('[data-business-id]'); if (!card) return; try { await loadBusinessDetail(card.dataset.businessId); } catch (err) { showToast('err', errMsg(err)); } });
$('locationsList').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-location-id]');
  if (!card) return;
  try {
    await loadLocationDetail(card.dataset.locationId);
  } catch (err) {
    $('locationScores').innerHTML = '<span class="muted">Failed to load score summary.</span>';
    $('reviewsFeed').innerHTML = `<div class="muted">${errMsg(err)}</div>`;
    showToast('err', errMsg(err));
  }
});

$('ratingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedLocation) throw { error: { message: 'Select a location first.' } };
    const comment = $('commentText').value.trim();
    const rating = await req(`/locations/${state.selectedLocation.id}/ratings/me`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ factors: state.factors, secondary: { pricing_value: 4.5, child_care_availability: 2.0, child_friendliness: 3.0, party_size_accommodations: 4.0, accessibility_details_score: 4.0, accessibility_notes: 'Front ramp and accessible restroom.' } }) });
    const posted = await req(`/ratings/${rating.data.rating_id}/comment`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ content: comment, visit_month: 2, visit_year: 2026 }) });
    setOut('postOut', { rating, posted }); showToast('ok', 'Rating and comment submitted'); await loadLocationDetail(state.selectedLocation.id);
  } catch (err) { setOut('postOut', err); showToast('err', errMsg(err)); }
});

$('loadMine').addEventListener('click', async () => {
  try {
    if (!requireLogin()) return;
    const data = await req('/businesses/mine', { headers: authHeaders() });
    setOut('toolsOut', data);
    showToast('ok', 'Loaded your businesses');
  } catch (err) { setOut('toolsOut', err); showToast('err', errMsg(err)); }
});

$('createBusinessForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    const body = { name: $('bizName').value.trim(), owner_name: $('bizOwnerName').value.trim(), description: $('bizDescription').value.trim() || undefined };
    const data = await req('/businesses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    setOut('toolsOut', data); showToast('ok', 'Business created');
    await loadBusinesses(); await loadBusinessDetail(data.data.id);
  } catch (err) { setOut('toolsOut', err); showToast('err', errMsg(err)); }
});

$('updateBusinessForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedBusiness) throw { error: { message: 'Select a business first.' } };
    const body = { name: $('editBizName').value.trim() || undefined, description: $('editBizDescription').value.trim() || undefined };
    const data = await req(`/businesses/${state.selectedBusiness.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
    setOut('toolsOut', data); showToast('ok', 'Business updated');
    await loadBusinesses(); await loadBusinessDetail(state.selectedBusiness.id);
  } catch (err) { setOut('toolsOut', err); showToast('err', errMsg(err)); }
});

$('createLocationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedBusiness) throw { error: { message: 'Select a business first.' } };
    const body = { location_name: $('locName').value.trim() || undefined, address_line: $('locAddress').value.trim(), city: $('locCity').value.trim(), region: $('locRegion').value.trim() || undefined, country: $('locCountry').value.trim() };
    const data = await req(`/businesses/${state.selectedBusiness.id}/locations`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    setOut('toolsOut', data); showToast('ok', 'Location created');
    await loadBusinessDetail(state.selectedBusiness.id);
  } catch (err) { setOut('toolsOut', err); showToast('err', errMsg(err)); }
});

$('appealForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedLocation) throw { error: { message: 'Select a location first.' } };
    const body = { target_type: 'location', target_location_id: state.selectedLocation.id, reason: $('appealReason').value.trim(), details: $('appealDetails').value.trim() };
    const data = await req('/appeals', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    setOut('toolsOut', data); showToast('ok', 'Appeal submitted');
  } catch (err) { setOut('toolsOut', err); showToast('err', errMsg(err)); }
});

(async () => {
  loadTheme();
  renderSliders();
  try { await Promise.all([loadCategories(), loadBusinesses()]); } catch {}
})();
