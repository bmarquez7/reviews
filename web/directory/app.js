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
const PROD_API_BASE = "https://grow-albania-directory-api.onrender.com/v1";
const isEmbedMode = document.body.classList.contains('embed-mode');

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
    return PROD_API_BASE;
  }

  return 'http://127.0.0.1:4000/v1';
};

const state = {
  selectedCategoryId: null,
  businessPage: 1,
  businessPageSize: 24,
  businessTotal: 0,
  businessSearchDebounce: null,
  suggestionDebounce: null,
  alphaFilter: null,
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
  selectedBusinessLocations: [],
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

const setAdminUIVisible = (isVisible) => {
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !isVisible);
  });
};

const setLoggedInUI = (isLoggedIn) => {
  const addBusinessCard = $('addBusinessCard');
  if (addBusinessCard) addBusinessCard.classList.toggle('hidden', !isLoggedIn);
  const authBtn = $('openAuthModal');
  if (authBtn) authBtn.textContent = isLoggedIn ? 'Account' : 'Login / Sign up';
};

const syncAdminUI = async () => {
  if (!state.token) {
    setAdminUIVisible(false);
    $('adminInboxLink')?.classList.add('hidden');
    return;
  }

  try {
    const me = await req('/users/me', { headers: authHeaders() });
    const isAdmin = me?.data?.role === 'admin';
    const canOpenInbox = me?.data?.role === 'admin' || me?.data?.role === 'moderator';
    setAdminUIVisible(isAdmin);
    $('adminInboxLink')?.classList.toggle('hidden', !canOpenInbox);
  } catch {
    setAdminUIVisible(false);
    $('adminInboxLink')?.classList.add('hidden');
  }
};

const ensureOverlays = () => {
  if (!$('businessModal')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="businessModal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Business details">
        <div class="overlay-card">
          <div class="row between center">
            <h2 id="businessModalTitle">Business</h2>
            <button id="businessModalClose" type="button">Close</button>
          </div>
          <div id="businessModalBody" class="overlay-body"></div>
        </div>
      </div>
      <div id="imageLightbox" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Image preview">
        <div class="overlay-card image-card">
          <div class="row between center">
            <h2>Image</h2>
            <button id="imageLightboxClose" type="button">Close</button>
          </div>
          <img id="imageLightboxImg" class="lightbox-image" alt="Preview" />
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }
};

const closeBusinessModal = () => $('businessModal')?.classList.add('hidden');
const openBusinessModal = () => $('businessModal')?.classList.remove('hidden');
const closeImageLightbox = () => $('imageLightbox')?.classList.add('hidden');
const closeAuthModal = () => $('authModal')?.classList.add('hidden');
const openAuthModal = () => $('authModal')?.classList.remove('hidden');
const openImageLightbox = (url) => {
  const img = $('imageLightboxImg');
  if (!img || !url) return;
  img.src = url;
  $('imageLightbox')?.classList.remove('hidden');
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

const reqForm = async (path, formData, options = {}) => {
  const res = await fetch(`${state.apiBase}${path}`, {
    ...options,
    body: formData
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
    const stepFill = fill >= 1 ? 1 : fill >= 0.5 ? 0.5 : 0;
    const pct = `${Math.round(stepFill * 100)}%`;
    const fillClass = stepFill === 1 ? 'is-full' : stepFill === 0.5 ? 'is-half' : 'is-empty';
    return `<span class="logo-token ${fillClass}" style="--fill:${pct}"></span>`;
  }).join('');
  return `<span class="logo-rating" aria-label="Rating ${stepped} out of 5">${items}</span>`;
};

const renderFactorIcons = (value) => {
  const safe = Math.max(0, Math.min(5, Number(value)));
  const stepped = Math.round(safe * 2) / 2;
  return Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, stepped - i));
    const stepFill = fill >= 1 ? 1 : fill >= 0.5 ? 0.5 : 0;
    const pct = `${Math.round(stepFill * 100)}%`;
    const fillClass = stepFill === 1 ? 'is-full' : stepFill === 0.5 ? 'is-half' : 'is-empty';
    return `<span class="logo-token ${fillClass}" style="--fill:${pct}" data-slot="${i}" role="button" tabindex="0" aria-label="Set rating"></span>`;
  }).join('');
};

const renderSliders = () => {
  $('factorSliders').innerHTML = FACTORS.map(([key, label]) => {
    const value = state.factors[key];
    return `<div class="slider-item" data-factor-wrap="${key}"><div class="slider-head"><span>${label}</span><strong id="factor-val-${key}">${value.toFixed(1)}</strong></div><div class="factor-logo-input" data-factor="${key}">${renderFactorIcons(value)}</div><div class="factor-help">Click left/right half of each icon for .5 increments</div></div>`;
  }).join('');
};

const renderCategoryChips = () => {
  $('categoryChips').innerHTML = state.categories.length
    ? state.categories
        .map((c) => `<button type="button" class="chip ${state.selectedCategoryId === c.id ? 'active' : ''}" data-category-id="${c.id}">${c.slug}</button>`)
        .join('')
    : '<span class="muted">Load categories to display chips.</span>';
};

const renderAlphaChips = () => {
  const host = $('alphaChips');
  if (!host) return;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  host.innerHTML = [
    `<button type="button" class="chip ${state.alphaFilter ? '' : 'active'}" data-alpha="all">All</button>`,
    ...letters.map((letter) => `<button type="button" class="chip ${state.alphaFilter === letter ? 'active' : ''}" data-alpha="${letter}">${letter}</button>`)
  ].join('');
};

const renderBusinesses = () => {
  const search = $('businessSearch')?.value.trim() || '';
  const canBrowse = !!search || !!state.selectedCategoryId || !!state.alphaFilter || !isEmbedMode;
  if (!canBrowse) {
    $('businessesList').innerHTML = '<div class="muted">Start typing to search businesses.</div>';
    $('businessPageInfo').textContent = 'Search to view businesses';
    $('businessPrev').disabled = true;
    $('businessNext').disabled = true;
    return;
  }

  $('businessesList').innerHTML = !state.businesses.length
    ? '<div class="muted">No businesses found.</div>'
    : state.businesses.map((b) => `<article class="item ${state.selectedBusiness?.id === b.id ? 'active' : ''}" data-business-id="${b.id}"><div class="item-title">${b.name}</div><div class="rating-row">${logoRatingMarkup(b.scores?.weighted_overall_display)}<span class="item-sub">${b.scores?.weighted_overall_display ?? 'n/a'} / 5</span></div><div class="item-sub">Reviews: ${b.scores?.business_rating_count ?? 0}</div><div class="item-sub">Locations: ${b.locations_count ?? 0}</div></article>`).join('');

  const totalPages = Math.max(1, Math.ceil(state.businessTotal / state.businessPageSize));
  $('businessPageInfo').textContent = `Page ${state.businessPage} / ${totalPages} (${state.businessTotal} businesses)`;
  $('businessPrev').disabled = state.businessPage <= 1;
  $('businessNext').disabled = state.businessPage >= totalPages;
};

const renderMediaGrid = (id, urls = []) => {
  const root = $(id);
  if (!root) return;
  root.innerHTML = (urls || []).length
    ? urls
        .map(
          (url) =>
            `<button type="button" class="media-link" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Uploaded media" loading="lazy" /></button>`
        )
        .join('')
    : '';
};

const renderBusinessModal = () => {
  const b = state.selectedBusiness;
  if (!b) return;
  $('businessModalTitle').textContent = b.name || 'Business';
  const body = $('businessModalBody');
  if (!body) return;

  const media = (b.media_urls || []).length
    ? `<div class="media-grid">${b.media_urls
        .map((url) => `<button type="button" class="media-link" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Business image" loading="lazy" /></button>`)
        .join('')}</div>`
    : '';

  const locations = (b.locations || []).length
    ? b.locations
        .map(
          (loc) =>
            `<article class="item" data-modal-location-id="${loc.id}">
              <div class="item-title">${loc.location_name || `${loc.city} location`}</div>
              <div class="item-sub">${loc.address_line}, ${loc.city}, ${loc.country}</div>
            </article>`
        )
        .join('')
    : '<div class="muted">No locations available.</div>';

  body.innerHTML = `
    <div class="muted">${b.description || 'No description yet.'}</div>
    <div class="rating-row">${logoRatingMarkup(b.scores?.weighted_overall_display)}<span class="item-sub">${b.scores?.weighted_overall_display ?? 'n/a'} / 5</span></div>
    ${media}
    <h3>Select Location</h3>
    <div class="list small">${locations}</div>
  `;
};

const renderBusinessDetail = () => {
  if (!state.selectedBusiness) {
    $('businessDetail').textContent = 'Pick a business from the list.';
    $('locationsList').innerHTML = '<div class="muted">No locations loaded.</div>';
    renderMediaGrid('businessMedia', []);
    return;
  }
  const b = state.selectedBusiness;
  $('businessDetail').innerHTML = `<div><strong>${b.name}</strong></div><div class="muted">${b.description || 'No description yet.'}</div><div class="rating-row">${logoRatingMarkup(b.scores?.weighted_overall_display)}<span class="item-sub">${b.scores?.weighted_overall_display ?? 'n/a'} / 5</span></div>`;
  renderMediaGrid('businessMedia', b.media_urls || []);
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
      const media = (c.media_urls || []).length
        ? `<div class="media-grid">${c.media_urls
            .map(
              (url) =>
                `<button type="button" class="media-link" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Review photo" loading="lazy" /></button>`
            )
            .join('')}</div>`
        : '';

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
          ${media}
          ${replies}
        </article>
      `;
    })
    .join('');
};

const loadCategories = async () => { const data = await req('/categories'); state.categories = data.data || []; renderCategoryChips(); };
const loadBusinesses = async () => {
  const search = $('businessSearch').value.trim();
  const canBrowse = !!search || !!state.selectedCategoryId || !!state.alphaFilter || !isEmbedMode;
  if (!canBrowse) {
    state.businesses = [];
    state.businessTotal = 0;
    renderBusinesses();
    return;
  }
  const params = new URLSearchParams({
    page: String(state.businessPage),
    page_size: String(state.businessPageSize),
    sort: 'name'
  });
  if (search) params.set('q', search);
  else if (state.alphaFilter) params.set('q', state.alphaFilter);
  if (state.selectedCategoryId) params.set('category', state.selectedCategoryId);
  const data = await req(`/businesses?${params.toString()}`);
  state.businesses = data?.data?.items || [];
  if (state.alphaFilter && !search) {
    state.businesses = state.businesses.filter((b) =>
      (b.name || '').trim().toUpperCase().startsWith(state.alphaFilter)
    );
  }
  state.businessTotal = Number(data?.data?.total || 0);
  renderBusinesses();
};

const loadSearchSuggestions = async () => {
  const input = $('businessSearch');
  const host = $('businessSuggestions');
  if (!input || !host) return;
  const q = input.value.trim();
  if (q.length < 2) {
    host.innerHTML = '';
    return;
  }
  try {
    const data = await req(`/businesses?page=1&page_size=8&sort=name&q=${encodeURIComponent(q)}`);
    const names = (data?.data?.items || []).map((b) => b.name).filter(Boolean);
    host.innerHTML = names.map((name) => `<option value="${name}"></option>`).join('');
  } catch {
    host.innerHTML = '';
  }
};

const loadBusinessDetail = async (businessId) => {
  const data = await req(`/businesses/${businessId}`);
  state.selectedBusiness = data.data;
  state.selectedLocation = null;
  renderBusinesses(); renderBusinessDetail(); renderSelectedLocationMeta();
  renderBusinessModal();
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

const doLogin = async (email, password) => {
  const data = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
  state.token = data.data.access_token;
  localStorage.setItem('dir.token', state.token);
  await syncAdminUI();
  setLoggedInUI(true);
  setOut('authOut', data);
  showToast('ok', 'Logged in');
  return data;
};

const doSignup = async (payload) => {
  const data = await req('/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
  setOut('authOut', data);
  showToast('ok', 'Sign up complete. Verify your email, then login.');
  return data;
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
  let value = Math.max(0, Math.min(5, slot + (clickX < rect.width / 2 ? 0.5 : 1)));
  if (slot === 0 && clickX < rect.width / 2 && Number(state.factors[key] ?? 0) <= 0.5) {
    value = 0;
  }
  value = Math.round(value * 2) / 2;

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
    await doLogin($('email').value, $('password').value);
  } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); }
});

const signupForm = $('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await doSignup({
        email: $('signupEmail').value.trim(),
        password: $('signupPassword').value,
        first_name: $('signupFirstName').value.trim(),
        last_name: $('signupLastName').value.trim(),
        country_of_origin: $('signupCountry').value.trim(),
        age: Number($('signupAge').value),
        screen_name: $('signupScreenName').value.trim() || undefined
      });
    } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); }
  });
}

const modalLoginForm = $('modalLoginForm');
if (modalLoginForm) {
  modalLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await doLogin($('modalEmail').value, $('modalPassword').value);
      closeAuthModal();
    } catch (err) {
      setOut('authOut', err);
      showToast('err', errMsg(err));
    }
  });
}

const modalSignupForm = $('modalSignupForm');
if (modalSignupForm) {
  modalSignupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await doSignup({
        email: $('modalSignupEmail').value.trim(),
        password: $('modalSignupPassword').value,
        first_name: $('modalSignupFirstName').value.trim(),
        last_name: $('modalSignupLastName').value.trim(),
        country_of_origin: $('modalSignupCountry').value.trim(),
        age: Number($('modalSignupAge').value),
        screen_name: $('modalSignupScreenName').value.trim() || undefined
      });
    } catch (err) {
      setOut('authOut', err);
      showToast('err', errMsg(err));
    }
  });
}

$('logout').addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem('dir.token');
  setAdminUIVisible(false);
  setLoggedInUI(false);
  setOut('authOut', 'Logged out');
  showToast('ok', 'Logged out');
});
$('loadMe').addEventListener('click', async () => {
  try {
    if (!requireLogin()) return;
    const me = await req('/users/me', { headers: authHeaders() });
    setOut('authOut', me);
    setAdminUIVisible(me?.data?.role === 'admin');
  } catch (err) {
    setOut('authOut', err);
    showToast('err', errMsg(err));
  }
});
$('acceptPolicies').addEventListener('click', async () => {
  try {
    if (!requireLogin()) return;
    const data = await req('/users/me/policies/accept', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ policies_version: '2026-02-17', accepted_via: 'pre_post', checkboxes: { firsthand_only: true, professional_no_hate: true, moderation_understood: true } }) });
    setOut('authOut', data); showToast('ok', 'Policies accepted');
  } catch (err) { setOut('authOut', err); showToast('err', errMsg(err)); }
});

$('loadCategories').addEventListener('click', async () => { try { await loadCategories(); showToast('ok', 'Categories loaded'); } catch (err) { showToast('err', errMsg(err)); } });
const loadBusinessesBtn = $('loadBusinesses');
if (loadBusinessesBtn) {
  loadBusinessesBtn.addEventListener('click', async () => {
    try {
      state.businessPage = 1;
      await loadBusinesses();
      showToast('ok', 'Businesses refreshed');
    } catch (err) {
      showToast('err', errMsg(err));
    }
  });
}
$('businessSearch').addEventListener('input', () => {
  if (state.suggestionDebounce) clearTimeout(state.suggestionDebounce);
  state.suggestionDebounce = setTimeout(() => {
    loadSearchSuggestions().catch(() => {});
  }, 180);

  if (state.businessSearchDebounce) clearTimeout(state.businessSearchDebounce);
  const search = $('businessSearch').value.trim();
  const canBrowse = !!search || !!state.selectedCategoryId || !!state.alphaFilter || !isEmbedMode;
  if (!canBrowse) {
    state.businesses = [];
    state.businessTotal = 0;
    renderBusinesses();
    return;
  }
  state.businessSearchDebounce = setTimeout(async () => {
    try {
      state.businessPage = 1;
      await loadBusinesses();
    } catch (err) {
      showToast('err', errMsg(err));
    }
  }, 180);
});
$('businessSearch').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  try {
    state.businessPage = 1;
    await loadBusinesses();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});
$('categoryChips').addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-category-id]');
  if (!chip) return;
  const clickedId = chip.dataset.categoryId;
  state.selectedCategoryId = state.selectedCategoryId === clickedId ? null : clickedId;
  state.businessPage = 1;
  renderCategoryChips();
  try {
    await loadBusinesses();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});
const alphaHost = $('alphaChips');
if (alphaHost) {
  alphaHost.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-alpha]');
    if (!chip) return;
    state.alphaFilter = chip.dataset.alpha === 'all' ? null : chip.dataset.alpha;
    state.businessPage = 1;
    renderAlphaChips();
    try {
      await loadBusinesses();
    } catch (err) {
      showToast('err', errMsg(err));
    }
  });
}
$('businessPrev').addEventListener('click', async () => {
  state.businessPage = Math.max(1, state.businessPage - 1);
  try {
    await loadBusinesses();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});
$('businessNext').addEventListener('click', async () => {
  state.businessPage += 1;
  try {
    await loadBusinesses();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});
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

$('businessesList').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-business-id]');
  if (!card) return;
  localStorage.setItem('dir.apiBase', state.apiBase);
  window.location.href = `./business.html?businessId=${card.dataset.businessId}`;
});
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

document.addEventListener('click', async (e) => {
  if (e.target.id === 'openAuthModal') {
    if (state.token && isEmbedMode) {
      const addBusinessCard = $('addBusinessCard');
      if (addBusinessCard) addBusinessCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    openAuthModal();
    return;
  }
  if (e.target.id === 'authModalClose' || e.target.id === 'authModal') {
    closeAuthModal();
    return;
  }
  const closeBiz = e.target.closest('#businessModalClose');
  if (closeBiz) {
    closeBusinessModal();
    return;
  }
  const closeImg = e.target.closest('#imageLightboxClose');
  if (closeImg) {
    closeImageLightbox();
    return;
  }
  if (e.target.id === 'businessModal') {
    closeBusinessModal();
    return;
  }
  if (e.target.id === 'imageLightbox') {
    closeImageLightbox();
    return;
  }

  const mediaBtn = e.target.closest('[data-image-url]');
  if (mediaBtn) {
    openImageLightbox(mediaBtn.dataset.imageUrl);
    return;
  }

  const loc = e.target.closest('[data-modal-location-id]');
  if (loc) {
    try {
      await loadLocationDetail(loc.dataset.modalLocationId);
      closeBusinessModal();
      showToast('ok', 'Location selected');
    } catch (err) {
      showToast('err', errMsg(err));
    }
  }
});

$('ratingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedLocation) throw { error: { message: 'Select a location first.' } };
    const comment = $('commentText').value.trim();
    const imageInput = $('commentImages');
    const rating = await req(`/locations/${state.selectedLocation.id}/ratings/me`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ factors: state.factors, secondary: { pricing_value: 4.5, child_care_availability: 2.0, child_friendliness: 3.0, party_size_accommodations: 4.0, accessibility_details_score: 4.0, accessibility_notes: 'Front ramp and accessible restroom.' } }) });
    const posted = await req(`/ratings/${rating.data.rating_id}/comment`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ content: comment, visit_month: 2, visit_year: 2026 }) });
    const uploaded = [];
    const files = Array.from(imageInput?.files || []).slice(0, 6);
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const media = await reqForm(`/media/comments/${posted.data.comment_id}/images`, formData, {
        method: 'POST',
        headers: authHeaders()
      });
      uploaded.push(media.data);
    }
    if (imageInput) imageInput.value = '';
    setOut('postOut', { rating, posted, uploaded });
    showToast('ok', uploaded.length ? `Submitted with ${uploaded.length} image(s)` : 'Rating and comment submitted');
    await loadLocationDetail(state.selectedLocation.id);
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
    const body = {
      name: $('bizName').value.trim(),
      owner_name: $('bizOwnerName').value.trim(),
      description: $('bizDescription').value.trim() || undefined,
      primary_phone: $('bizPrimaryPhone')?.value.trim() || undefined,
      website_url: $('bizWebsite')?.value.trim() || undefined
    };
    const data = await req('/businesses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    setOut('toolsOut', data); showToast('ok', 'Business created');
    const firstLocationAddress = $('bizLocationAddress')?.value.trim();
    const firstLocationCity = $('bizLocationCity')?.value.trim();
    const firstLocationCountry = $('bizLocationCountry')?.value.trim();
    if (firstLocationAddress && firstLocationCity && firstLocationCountry) {
      await req(`/businesses/${data.data.id}/locations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          location_name: $('bizLocationName')?.value.trim() || undefined,
          address_line: firstLocationAddress,
          city: firstLocationCity,
          country: firstLocationCountry
        })
      });
      showToast('ok', 'First location added');
    }
    if (!$('businessSearch').value.trim()) $('businessSearch').value = body.name;
    state.businessPage = 1;
    await loadBusinesses();
    await loadBusinessDetail(data.data.id);
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

$('businessImageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!requireLogin()) return;
    if (!state.selectedBusiness) throw { error: { message: 'Select a business first.' } };
    const input = $('businessImages');
    const files = Array.from(input?.files || []).slice(0, 8);
    if (!files.length) throw { error: { message: 'Choose at least one image.' } };

    const uploaded = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const media = await reqForm(`/media/businesses/${state.selectedBusiness.id}/images`, formData, {
        method: 'POST',
        headers: authHeaders()
      });
      uploaded.push(media.data);
    }
    if (input) input.value = '';
    setOut('toolsOut', { uploaded });
    showToast('ok', `Uploaded ${uploaded.length} business image(s)`);
    await loadBusinessDetail(state.selectedBusiness.id);
  } catch (err) {
    setOut('toolsOut', err);
    showToast('err', errMsg(err));
  }
});

(async () => {
  ensureOverlays();
  loadTheme();
  await syncAdminUI();
  setLoggedInUI(Boolean(state.token));
  renderSliders();
  renderAlphaChips();
  try { await loadCategories(); } catch {}
  renderBusinesses();
})();
