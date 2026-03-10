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

const HOURS_DAYS = [
  ['monday', 'hoursMonday'],
  ['tuesday', 'hoursTuesday'],
  ['wednesday', 'hoursWednesday'],
  ['thursday', 'hoursThursday'],
  ['friday', 'hoursFriday'],
  ['saturday', 'hoursSaturday'],
  ['sunday', 'hoursSunday']
];

const THEME_DEFAULTS = { brand: '#0f6a4d', bg: '#f5f2eb', card: '#fffdf7', iconUrl: './assets/new-roots-logo.png' };
const PROD_API_BASE = 'https://grow-albania-directory-api.onrender.com/v1';

const params = new URLSearchParams(window.location.search);
const businessId = params.get('businessId');
const apiBase = params.get('apiBase') || localStorage.getItem('dir.apiBase') || PROD_API_BASE;
const state = {
  token: localStorage.getItem('dir.token') || '',
  page: 1,
  pageSize: 10,
  total: 0,
  reviewLocationId: null,
  reviewFactors: Object.fromEntries(FACTORS.map(([key]) => [key, 5])),
  business: null,
  hoursLocationId: null,
  galleryUrls: [],
  galleryIndex: 0,
  galleryTimer: null
};

const authHeaders = () => (state.token ? { Authorization: `Bearer ${state.token}` } : {});
const errMsg = (err) => err?.error?.message || 'Request failed';

const wordCount = (value) => (String(value || '').trim().match(/\S+/g) || []).length;

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

const reqForm = async (path, formData, options = {}) => {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    body: formData,
    headers: { ...(options.headers || {}) }
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

const renderFactorIcons = (value) => {
  const safe = Math.max(0, Math.min(5, Number(value)));
  const stepped = Math.round(safe * 2) / 2;
  return Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, stepped - i));
    const stepFill = fill >= 1 ? 1 : fill >= 0.5 ? 0.5 : 0;
    const pct = `${Math.round(stepFill * 100)}%`;
    return `<span class="logo-token" style="--fill:${pct}" data-slot="${i}" role="button" tabindex="0" aria-label="Set rating"></span>`;
  }).join('');
};

const renderReviewFactors = () => {
  const host = $('reviewFactors');
  if (!host) return;
  host.innerHTML = FACTORS.map(([key, label]) => {
    const value = Number(state.reviewFactors[key] || 0);
    return `
      <div class="slider-item">
        <div class="slider-head"><span>${label}</span><strong id="review-factor-val-${key}">${value.toFixed(1)}</strong></div>
        <div class="factor-logo-input" data-factor="${key}">${renderFactorIcons(value)}</div>
      </div>
    `;
  }).join('');
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
const openReviewModal = () => $('reviewModal')?.classList.remove('hidden');
const closeReviewModal = () => $('reviewModal')?.classList.add('hidden');
const openClaimModal = () => $('claimModal')?.classList.remove('hidden');
const closeClaimModal = () => $('claimModal')?.classList.add('hidden');

const syncAdminLink = async () => {
  const link = $('bizAdminLink');
  if (!link) return;
  const panel = $('manageBusinessPanel');
  if (!state.token) {
    link.classList.add('hidden');
    panel?.classList.add('hidden');
    return;
  }
  try {
    const me = await req('/users/me', { headers: authHeaders() });
    const canAccess = me?.data?.role === 'admin' || me?.data?.role === 'moderator';
    const canManage = me?.data?.role === 'admin' || me?.data?.role === 'business_owner';
    link.classList.toggle('hidden', !canAccess);
    panel?.classList.toggle('hidden', !canManage);
    if (canAccess) link.href = `./admin.html?businessId=${businessId}`;
  } catch {
    link.classList.add('hidden');
    panel?.classList.add('hidden');
  }
};

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

const compactLocationLabel = (businessName, loc, index = 0) => {
  const city = String(loc?.city || '').trim();
  const raw = String(loc?.location_name || '').trim();
  if (!raw) return city ? `${city} location` : `Location ${index + 1}`;

  let label = raw;
  if (businessName) {
    const escaped = String(businessName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    label = label.replace(new RegExp(`^${escaped}\\s*[-–—,:|]*\\s*`, 'i'), '').trim();
  }

  if (/^\(?main\)?$/i.test(label) || /^main\s+location$/i.test(label)) return 'Main location';
  if (!label) return city ? `${city} location` : 'Main location';
  if (city && label.toLowerCase() === city.toLowerCase()) return `${city} location`;
  return label;
};

const renderReviewLocationOptions = (business) => {
  const select = $('reviewLocationId');
  if (!select) return;
  const locations = business?.locations || [];
  const current = state.reviewLocationId && locations.some((loc) => loc.id === state.reviewLocationId)
    ? state.reviewLocationId
    : (locations[0]?.id || '');
  state.reviewLocationId = current || null;
  select.innerHTML = ['<option value="">Select location to review</option>']
    .concat(
      locations.map((loc, index) => `<option value="${loc.id}">${compactLocationLabel(business?.name || '', loc, index)} · ${loc.city || ''}</option>`)
    )
    .join('');
  select.value = current || '';
};

const emptyHours = () =>
  Object.fromEntries(HOURS_DAYS.map(([day]) => [day, '']));

const parseWeekdayTextHours = (weekdayText) => {
  const out = emptyHours();
  for (const line of weekdayText || []) {
    const text = String(line || '');
    const match = text.match(/^\s*([A-Za-z]+)\s*:\s*(.+)\s*$/);
    if (!match) continue;
    const day = match[1].toLowerCase();
    if (!(day in out)) continue;
    out[day] = match[2].trim();
  }
  return out;
};

const normalizeLocationHours = (rawHours) => {
  if (!rawHours || typeof rawHours !== 'object') return emptyHours();
  const out = emptyHours();

  if (Array.isArray(rawHours.weekday_text)) {
    return { ...out, ...parseWeekdayTextHours(rawHours.weekday_text) };
  }

  const aliases = {
    mon: 'monday',
    tue: 'tuesday',
    tues: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    thur: 'thursday',
    thurs: 'thursday',
    fri: 'friday',
    sat: 'saturday',
    sun: 'sunday'
  };

  for (const [key, value] of Object.entries(rawHours)) {
    const lowered = String(key).toLowerCase().trim();
    const mapped = aliases[lowered] || lowered;
    if (!(mapped in out)) continue;
    out[mapped] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }

  return out;
};

const formatHoursLine = (hoursMap, day) => {
  const text = String(hoursMap?.[day] || '').trim();
  return text || 'Not set';
};

const stopGalleryRotation = () => {
  if (state.galleryTimer) {
    clearInterval(state.galleryTimer);
    state.galleryTimer = null;
  }
};

const setFeaturedImageByIndex = (index) => {
  if (!state.galleryUrls.length) return;
  state.galleryIndex = ((index % state.galleryUrls.length) + state.galleryUrls.length) % state.galleryUrls.length;
  const featured = $('bizFeaturedImage');
  if (featured) featured.src = state.galleryUrls[state.galleryIndex];
  document.querySelectorAll('[data-gallery-index]').forEach((node) => {
    const active = Number(node.dataset.galleryIndex) === state.galleryIndex;
    node.classList.toggle('active', active);
  });
};

const startGalleryRotation = () => {
  stopGalleryRotation();
  if (state.galleryUrls.length < 2) return;
  state.galleryTimer = setInterval(() => {
    setFeaturedImageByIndex(state.galleryIndex + 1);
  }, 5000);
};

const renderBusinessGallery = (urls = []) => {
  state.galleryUrls = Array.isArray(urls) ? urls.filter(Boolean) : [];
  state.galleryIndex = 0;
  const featuredWrap = $('bizFeatured');
  const gallery = $('bizGallery');
  if (!gallery || !featuredWrap) return;

  if (!state.galleryUrls.length) {
    stopGalleryRotation();
    featuredWrap.classList.add('hidden');
    gallery.innerHTML = '<div class="muted">No photos yet.</div>';
    return;
  }

  featuredWrap.classList.remove('hidden');
  setFeaturedImageByIndex(0);
  gallery.innerHTML = state.galleryUrls
    .map(
      (url, idx) =>
        `<button type="button" class="media-link" data-gallery-index="${idx}" data-image-url="${url}"><img class="media-thumb" src="${url}" alt="Business photo ${idx + 1}" loading="lazy" /></button>`
    )
    .join('');
  setFeaturedImageByIndex(0);
  startGalleryRotation();
};

const renderHoursSummary = (business) => {
  const root = $('bizHours');
  if (!root) return;
  const locations = business?.locations || [];
  if (!locations.length) {
    root.innerHTML = '<div class="muted">No locations available.</div>';
    return;
  }

  root.innerHTML = locations
    .map((loc, index) => {
      const map = normalizeLocationHours(loc.location_hours);
      const lines = HOURS_DAYS.map(([day]) => `<div class="item-sub"><strong>${day[0].toUpperCase() + day.slice(1)}:</strong> ${formatHoursLine(map, day)}</div>`).join('');
      return `
        <article class="item">
          <div class="item-title">${compactLocationLabel(business.name, loc, index)}</div>
          ${lines}
        </article>
      `;
    })
    .join('');
};

const renderHoursLocationOptions = (business) => {
  const select = $('hoursLocationId');
  if (!select) return;
  const locations = business?.locations || [];
  const selected = state.hoursLocationId && locations.some((loc) => loc.id === state.hoursLocationId)
    ? state.hoursLocationId
    : (locations[0]?.id || '');
  state.hoursLocationId = selected || null;
  select.innerHTML = ['<option value="">Select location</option>']
    .concat(locations.map((loc, index) => `<option value="${loc.id}">${compactLocationLabel(business?.name || '', loc, index)} · ${loc.city || ''}</option>`))
    .join('');
  select.value = selected || '';
};

const fillHoursFormFromSelectedLocation = () => {
  const location = (state.business?.locations || []).find((loc) => loc.id === state.hoursLocationId);
  const hoursMap = normalizeLocationHours(location?.location_hours);
  for (const [day, inputId] of HOURS_DAYS) {
    const input = $(inputId);
    if (!input) continue;
    input.value = hoursMap[day] || '';
  }
};

const buildHoursPayloadFromForm = () => {
  const payload = {};
  for (const [day, inputId] of HOURS_DAYS) {
    const value = String($(inputId)?.value || '').trim();
    payload[day] = value;
  }
  return payload;
};

const renderBusiness = (b) => {
  state.business = b;
  $('bizPageTitle').textContent = b.name || 'Business';
  $('bizHeaderMeta').innerHTML = `
    <div class="row gap-sm center">${logoRatingMarkup(b.scores?.weighted_overall_display)}<strong>${b.scores?.weighted_overall_display ?? 'n/a'} / 5</strong> <span class="muted">(${b.scores?.business_rating_count ?? 0} reviews)</span></div>
    <div class="muted">${b.is_claimed ? 'Claimed' : 'Unclaimed'} • ${b.categories?.map((c) => c.categories?.slug || c.slug || '').filter(Boolean).join(', ') || 'General'}</div>
  `;

  renderBusinessGallery(b.media_urls || []);

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

  const formValues = {
    bizEditName: b.name,
    bizEditOwnerName: b.owner_name,
    bizEditDescription: b.description,
    bizEditMission: b.mission_statement,
    bizEditPhone: b.primary_phone,
    bizEditEmail: b.primary_email,
    bizEditWebsite: b.website_url
  };
  Object.entries(formValues).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.value = value || '';
  });

  $('bizLocations').innerHTML = (b.locations || []).length
    ? b.locations
        .map(
          (loc, index) =>
            `<article class="item"><div class="item-title">${compactLocationLabel(b.name, loc, index)}</div><div class="item-sub">${loc.address_line}, ${loc.city}, ${loc.country}</div><div class="row gap-sm"><a class="chip link-chip" target="_blank" rel="noopener" href="${mapUrlFor(loc)}">Map</a>${loc.location_phone ? `<a class="chip link-chip" href="tel:${loc.location_phone}">${loc.location_phone}</a>` : ''}${loc.location_email ? `<a class="chip link-chip" href="mailto:${loc.location_email}">Email</a>` : ''}</div></article>`
        )
        .join('')
    : '<div class="muted">No locations available.</div>';

  renderHoursSummary(b);
  renderHoursLocationOptions(b);
  fillHoursFormFromSelectedLocation();
  renderReviewLocationOptions(b);
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
    await syncAdminLink();
    showToast('ok', 'Logged in');
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('logout').addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem('dir.token');
  void syncAdminLink();
  showToast('ok', 'Logged out');
});

$('openReviewModal')?.addEventListener('click', () => {
  openReviewModal();
});

$('openClaimModal')?.addEventListener('click', () => {
  openClaimModal();
});

const hoursLocationSelect = $('hoursLocationId');
if (hoursLocationSelect) {
  hoursLocationSelect.addEventListener('change', (e) => {
    state.hoursLocationId = e.target.value || null;
    fillHoursFormFromSelectedLocation();
  });
}

const hoursForm = $('hoursForm');
if (hoursForm) {
  hoursForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.token) {
      showToast('err', 'Login first to save hours.');
      return;
    }

    const locationId = state.hoursLocationId || $('hoursLocationId')?.value;
    if (!locationId) {
      showToast('err', 'Select a location first.');
      return;
    }

    try {
      const payload = { location_hours: buildHoursPayloadFromForm() };
      await req(`/businesses/${businessId}/locations/${locationId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      showToast('ok', 'Hours saved');
      await loadBusiness();
    } catch (err) {
      if (err?.error?.code === 'POLICIES_NOT_ACCEPTED') {
        showToast('err', 'Accept policies first, then update hours.');
      } else {
        showToast('err', errMsg(err));
      }
    }
  });
}

const reviewLocationSelect = $('reviewLocationId');
if (reviewLocationSelect) {
  reviewLocationSelect.addEventListener('change', (e) => {
    state.reviewLocationId = e.target.value || null;
  });
}

const reviewFactorsHost = $('reviewFactors');
if (reviewFactorsHost) {
  reviewFactorsHost.addEventListener('click', (e) => {
    const token = e.target.closest('.logo-token');
    if (!token) return;
    const group = token.closest('.factor-logo-input');
    const key = group?.dataset.factor;
    if (!key) return;

    const slot = Number(token.dataset.slot);
    const rect = token.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    let value = Math.max(0, Math.min(5, slot + (clickX < rect.width / 2 ? 0.5 : 1)));
    if (slot === 0 && clickX < rect.width / 2 && Number(state.reviewFactors[key] ?? 0) <= 0.5) {
      value = 0;
    }
    value = Math.round(value * 2) / 2;
    state.reviewFactors[key] = value;
    group.innerHTML = renderFactorIcons(value);
    const valueNode = $(`review-factor-val-${key}`);
    if (valueNode) valueNode.textContent = value.toFixed(1);
  });

  reviewFactorsHost.addEventListener('keydown', (e) => {
    const token = e.target.closest('.logo-token');
    if (!token) return;
    const group = token.closest('.factor-logo-input');
    const key = group?.dataset.factor;
    if (!key) return;

    let value = Number(state.reviewFactors[key] ?? 0);
    let handled = true;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value += 0.5;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value -= 0.5;
    else if (e.key === 'Home') value = 0;
    else if (e.key === 'End') value = 5;
    else handled = false;

    if (!handled) return;
    e.preventDefault();

    value = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
    state.reviewFactors[key] = value;
    group.innerHTML = renderFactorIcons(value);
    const valueNode = $(`review-factor-val-${key}`);
    if (valueNode) valueNode.textContent = value.toFixed(1);
  });
}

const reviewForm = $('reviewForm');
if (reviewForm) {
  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.token) {
      showToast('err', 'Login first to submit a review.');
      return;
    }

    const locationId = $('reviewLocationId')?.value || state.reviewLocationId;
    if (!locationId) {
      showToast('err', 'Select a location first.');
      return;
    }

    const comment = $('reviewComment')?.value.trim() || '';
    if (wordCount(comment) < 10) {
      showToast('err', 'Comment must be at least 10 words.');
      return;
    }

    try {
      const now = new Date();
      const rating = await req(`/locations/${locationId}/ratings/me`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          factors: state.reviewFactors,
          secondary: {
            pricing_value: 4.5,
            child_care_availability: 2.0,
            child_friendliness: 3.0,
            party_size_accommodations: 4.0,
            accessibility_details_score: 4.0,
            accessibility_notes: 'Submitted from business page form.'
          }
        })
      });

      const posted = await req(`/ratings/${rating.data.rating_id}/comment`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          content: comment,
          visit_month: now.getUTCMonth() + 1,
          visit_year: now.getUTCFullYear()
        })
      });

      const files = Array.from($('reviewImages')?.files || []).slice(0, 6);
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await reqForm(`/media/comments/${posted.data.comment_id}/images`, formData, {
          method: 'POST',
          headers: authHeaders()
        });
      }

      if ($('reviewImages')) $('reviewImages').value = '';
      if ($('reviewComment')) $('reviewComment').value = '';
      showToast('ok', files.length ? `Review submitted with ${files.length} image(s).` : 'Review submitted.');
      closeReviewModal();
      state.page = 1;
      await loadReviews();
    } catch (err) {
      if (err?.error?.code === 'POLICIES_NOT_ACCEPTED') {
        showToast('err', 'Accept policies first, then submit your review.');
      } else {
        showToast('err', errMsg(err));
      }
    }
  });
}

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
    closeClaimModal();
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

$('bizEditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) {
    showToast('err', 'Login first to edit business.');
    return;
  }
  try {
    await req(`/businesses/${businessId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        name: $('bizEditName').value.trim() || undefined,
        owner_name: $('bizEditOwnerName').value.trim() || undefined,
        description: $('bizEditDescription').value.trim() || undefined,
        mission_statement: $('bizEditMission').value.trim() || undefined,
        primary_phone: $('bizEditPhone').value.trim() || undefined,
        primary_email: $('bizEditEmail').value.trim() || undefined,
        website_url: $('bizEditWebsite').value.trim() || undefined
      })
    });
    showToast('ok', 'Business updated');
    await loadBusiness();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('bizAddLocationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) {
    showToast('err', 'Login first to add location.');
    return;
  }
  try {
    const hoursRaw = $('bizLocHours').value.trim();
    await req(`/businesses/${businessId}/locations`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        location_name: $('bizLocName').value.trim() || undefined,
        address_line: $('bizLocAddress').value.trim(),
        city: $('bizLocCity').value.trim(),
        region: $('bizLocRegion').value.trim() || undefined,
        country: $('bizLocCountry').value.trim() || 'Albania',
        location_hours: hoursRaw ? JSON.parse(hoursRaw) : undefined
      })
    });
    $('bizAddLocationForm').reset();
    $('bizLocCountry').value = 'Albania';
    showToast('ok', 'Location added');
    await loadBusiness();
  } catch (err) {
    showToast('err', errMsg(err));
  }
});

$('bizImageUploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) {
    showToast('err', 'Login first to upload images.');
    return;
  }
  try {
    const files = Array.from($('bizImages').files || []);
    if (!files.length) throw { error: { message: 'Choose one or more images.' } };
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      await reqForm(`/media/businesses/${businessId}/images`, form, {
        method: 'POST',
        headers: authHeaders()
      });
    }
    $('bizImages').value = '';
    showToast('ok', `Uploaded ${files.length} image(s)`);
    await loadBusiness();
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
  if (e.target.id === 'reviewModal' || e.target.id === 'reviewModalClose') closeReviewModal();
  if (e.target.id === 'claimModal' || e.target.id === 'claimModalClose') closeClaimModal();
  const galleryBtn = e.target.closest('[data-gallery-index]');
  if (galleryBtn) {
    const idx = Number(galleryBtn.dataset.galleryIndex);
    if (Number.isFinite(idx)) {
      setFeaturedImageByIndex(idx);
      startGalleryRotation();
    }
  }
  const mediaBtn = e.target.closest('[data-image-url]');
  if (mediaBtn) openImageLightbox(mediaBtn.dataset.imageUrl);
});

window.addEventListener('beforeunload', () => {
  stopGalleryRotation();
});

(async () => {
  applyTheme();
  renderReviewFactors();
  initProfileTabs();
  if (!businessId) {
    $('bizHeaderMeta').textContent = 'Missing businessId in URL.';
    return;
  }
  try {
    await Promise.all([loadBusiness(), loadReviews()]);
    await syncAdminLink();
  } catch (err) {
    $('bizHeaderMeta').textContent = errMsg(err);
  }
})();
