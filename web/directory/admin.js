const $ = (id) => document.getElementById(id);
const PROD_API_BASE = 'https://grow-albania-directory-api.onrender.com/v1';
const apiBase = localStorage.getItem('dir.apiBase') || PROD_API_BASE;

const state = {
  token: localStorage.getItem('dir.token') || '',
  tier: null,
  role: null,
  category: 'all',
  status: 'all',
  tasks: [],
  selected: null,
  q: '',
  selectedBusiness: null
};

const showToast = (type, message) => {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

const req = async (path, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json;
  return json;
};

const reqForm = async (path, formData) => {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    body: formData,
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json;
  return json;
};

const tierRank = (tier) => (tier === 'owner' ? 3 : tier === 'super_admin' ? 2 : tier === 'admin' ? 1 : 0);
const canSuper = () => tierRank(state.tier) >= 2;
const canOwner = () => tierRank(state.tier) >= 3;

const renderCategories = () => {
  const canSuper = tierRank(state.tier) >= 2;
  const canOwner = tierRank(state.tier) >= 3;
  const folderHints = {
    all: canOwner
      ? 'All actions, role management, and batch tools'
      : canSuper
        ? 'All actions plus edit/remove and batch tools'
        : 'Approve, deny, and request more info',
    business_requests: canOwner
      ? 'Approve/deny/info, remove entities, assign admins'
      : canSuper
        ? 'Approve/deny/info, remove entities, edit records'
        : 'Approve, deny, request more info',
    claim_requests: canOwner
      ? 'Approve transfer, deny, request info, role controls'
      : canSuper
        ? 'Approve transfer, deny, request info'
        : 'Approve, deny, request more info',
    location_requests: canOwner
      ? 'Approve, deny, request info, remove locations'
      : canSuper
        ? 'Approve, deny, request info, remove locations'
        : 'Approve, deny, request more info',
    moderation: canOwner
      ? 'Moderate, edit/remove content, manage admin roles'
      : canSuper
        ? 'Moderate, edit ratings/comments, remove content'
        : 'Approve, deny, remove pending content'
  };

  const categories = [
    ['all', 'All tasks'],
    ['business_requests', 'Business requests'],
    ['claim_requests', 'Claim requests'],
    ['location_requests', 'Location requests'],
    ['moderation', 'Moderation queue']
  ];
  $('adminCategories').innerHTML = categories
    .map(
      ([id, label]) =>
        `<button type="button" class="item ${state.category === id ? 'active' : ''}" data-category="${id}">
          <div class="item-title">${label}</div>
          <div class="item-sub">${folderHints[id] || ''}</div>
        </button>`
    )
    .join('');
};

const normalizeTasks = (data) => {
  const appealTasks = (data?.appeals || []).map((a) => ({
    kind: 'appeal',
    id: a.id,
    title: `${a.reason} · ${a.status}`,
    subtitle: a.details?.slice(0, 140) || '',
    created_at: a.created_at,
    raw: a
  }));
  const moderationTasks = [
    ...(data?.moderation?.ratings || []).map((x) => ({
      kind: 'rating',
      id: x.id,
      title: `Rating pending`,
      subtitle: `Location ${x.location_id}`,
      created_at: x.created_at,
      raw: x
    })),
    ...(data?.moderation?.comments || []).map((x) => ({
      kind: 'comment',
      id: x.id,
      title: `Comment pending`,
      subtitle: (x.content || '').slice(0, 140),
      created_at: x.created_at,
      raw: x
    })),
    ...(data?.moderation?.business_replies || []).map((x) => ({
      kind: 'business_reply',
      id: x.id,
      title: `Business reply pending`,
      subtitle: (x.content || '').slice(0, 140),
      created_at: x.created_at,
      raw: x
    }))
  ];
  return [...appealTasks, ...moderationTasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

const renderTasks = () => {
  if (!state.tasks.length) {
    $('adminTaskList').innerHTML = '<div class="muted">No tasks found.</div>';
    return;
  }
  $('adminTaskList').innerHTML = state.tasks
    .map(
      (t) =>
        `<button type="button" class="item ${state.selected?.id === t.id ? 'active' : ''}" data-task-id="${t.id}">
          <div class="item-title">${t.title}</div>
          <div class="item-sub">${t.subtitle || ''}</div>
        </button>`
    )
    .join('');
};

const renderBusinessEditor = () => {
  const panel = $('adminBusinessEditor');
  if (!panel) return;
  const b = state.selectedBusiness;
  if (!b) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  $('adminBizId').value = b.id;
  $('adminBizName').value = b.name || '';
  $('adminBizOwnerName').value = b.owner_name || '';
  $('adminBizDescription').value = b.description || '';
  $('adminBizRemove').disabled = !canSuper();

  $('adminBizLocations').innerHTML = (b.locations || []).length
    ? b.locations
        .map(
          (loc) =>
            `<article class="item"><div class="item-title">${loc.location_name || `${loc.city} location`}</div><div class="item-sub">${loc.address_line}, ${loc.city}, ${loc.country}</div>${canSuper() ? `<div class="actions"><button type="button" data-remove-location-id="${loc.id}">Remove Location</button></div>` : ''}</article>`
        )
        .join('')
    : '<div class="muted">No locations found.</div>';
};

const renderBusinessResults = (items) => {
  $('adminBusinessResults').innerHTML = !items.length
    ? '<div class="muted">No businesses found.</div>'
    : items
        .map(
          (b) =>
            `<button type="button" class="item" data-business-id="${b.id}"><div class="item-title">${b.name}</div><div class="item-sub">Reviews: ${b.scores?.business_rating_count ?? 0}</div></button>`
        )
        .join('');
};

const searchBusinesses = async (q) => {
  if (!q) {
    $('adminBusinessResults').innerHTML = '';
    return;
  }
  const data = await req(`/businesses?page=1&page_size=12&sort=name&q=${encodeURIComponent(q)}`);
  renderBusinessResults(data?.data?.items || []);
};

const selectBusiness = async (businessId) => {
  const data = await req(`/businesses/${businessId}`);
  state.selectedBusiness = data.data;
  renderBusinessEditor();
};

const renderDetail = () => {
  const t = state.selected;
  const batchForm = $('adminImageBatchForm');
  if (batchForm) batchForm.classList.add('hidden');
  const roleForm = $('roleAssignForm');
  if (roleForm) roleForm.classList.toggle('hidden', !canSuper());

  if (!t) {
    $('adminDetail').textContent = 'Select a task to view details.';
    $('adminActions').innerHTML = '';
    return;
  }

  $('adminDetail').innerHTML = `<div><strong>${t.title}</strong></div><pre class="out">${JSON.stringify(t.raw, null, 2)}</pre>`;
  const actions = [];

  if (t.kind === 'appeal') {
    actions.push(`<button type="button" data-action="appeal_approve">Approve</button>`);
    actions.push(`<button type="button" data-action="appeal_deny">Deny</button>`);
    actions.push(`<button type="button" data-action="appeal_request_info">Request More Info</button>`);
    if (tierRank(state.tier) >= 2) {
      if (t.raw.target_business_id) actions.push(`<button type="button" data-action="remove_business">Remove Business</button>`);
      if (t.raw.target_location_id) actions.push(`<button type="button" data-action="remove_location">Remove Location</button>`);
      if (t.raw.target_business_id && batchForm) {
        batchForm.classList.remove('hidden');
        $('adminBatchBusinessId').value = t.raw.target_business_id;
      }
    }
  }

  if (['rating', 'comment', 'business_reply'].includes(t.kind)) {
    actions.push(`<button type="button" data-action="mod_approve">Approve</button>`);
    actions.push(`<button type="button" data-action="mod_deny">Deny</button>`);
    actions.push(`<button type="button" data-action="mod_remove">Remove</button>`);
    if (tierRank(state.tier) >= 2) {
      if (t.kind === 'comment') actions.push(`<button type="button" data-action="edit_comment">Edit Comment</button>`);
      if (t.kind === 'rating') actions.push(`<button type="button" data-action="edit_rating">Edit Rating</button>`);
    }
  }

  $('adminActions').innerHTML = actions.join('');
};

const loadMe = async () => {
  const me = await req('/admin/me');
  state.tier = me.data.tier;
  state.role = me.data.role;
  $('adminTierPill').textContent = `Tier: ${state.tier}`;
  $('roleAssignForm')?.classList.toggle('hidden', !canSuper());
};

const loadInbox = async () => {
  const params = new URLSearchParams({
    category: state.category,
    status: state.status
  });
  if (state.q) params.set('q', state.q);
  const data = await req(`/admin/inbox?${params.toString()}`);
  state.tasks = normalizeTasks(data.data);
  state.selected = null;
  renderTasks();
  renderDetail();
};

const handleAction = async (action) => {
  const t = state.selected;
  if (!t) return;

  if (action === 'appeal_approve') await req(`/admin/appeals/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
  if (action === 'appeal_deny') await req(`/admin/appeals/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
  if (action === 'appeal_request_info') {
    const note = window.prompt('What information do you want from submitter?');
    if (!note) return;
    await req(`/admin/appeals/${t.id}/request-info`, { method: 'POST', body: JSON.stringify({ note }) });
  }

  if (action === 'mod_approve') await req(`/admin/moderation/${t.kind}/${t.id}/approve`, { method: 'POST' });
  if (action === 'mod_deny') await req(`/admin/moderation/${t.kind}/${t.id}/deny`, { method: 'POST' });
  if (action === 'mod_remove') await req(`/admin/moderation/${t.kind}/${t.id}/remove`, { method: 'POST' });

  if (action === 'edit_comment') {
    const content = window.prompt('Edit comment content (min 10 words):', t.raw.content || '');
    if (!content) return;
    await req(`/admin/comments/${t.id}`, { method: 'PATCH', body: JSON.stringify({ content }) });
  }

  if (action === 'edit_rating') {
    const value = Number(window.prompt('Set friendliness (0-5, .5 steps):', '4.0'));
    if (Number.isNaN(value)) return;
    await req(`/admin/ratings/${t.id}`, { method: 'PATCH', body: JSON.stringify({ friendliness: value }) });
  }

  if (action === 'remove_business' && t.raw.target_business_id) {
    await req(`/admin/businesses/${t.raw.target_business_id}/remove`, { method: 'POST' });
  }
  if (action === 'remove_location' && t.raw.target_location_id) {
    await req(`/admin/locations/${t.raw.target_location_id}/remove`, { method: 'POST' });
  }

  showToast('ok', 'Action completed');
  await loadInbox();
};

$('adminCategories').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-category]');
  if (!btn) return;
  state.category = btn.dataset.category;
  renderCategories();
  try {
    await loadInbox();
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed loading inbox');
  }
});

$('adminTaskList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-task-id]');
  if (!btn) return;
  state.selected = state.tasks.find((t) => t.id === btn.dataset.taskId) || null;
  renderTasks();
  renderDetail();
});

$('adminActions').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  try {
    await handleAction(btn.dataset.action);
  } catch (err) {
    showToast('err', err?.error?.message || 'Action failed');
  }
});

$('adminStatusFilter').addEventListener('change', async (e) => {
  state.status = e.target.value;
  try {
    await loadInbox();
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed loading inbox');
  }
});

$('adminSearch').addEventListener('input', () => {
  state.q = $('adminSearch').value.trim();
  clearTimeout(window.__adminSearchTimer);
  window.__adminSearchTimer = setTimeout(() => {
    loadInbox().catch((err) => showToast('err', err?.error?.message || 'Failed loading inbox'));
  }, 220);
});

$('adminBusinessSearch').addEventListener('input', () => {
  clearTimeout(window.__adminBusinessSearchTimer);
  window.__adminBusinessSearchTimer = setTimeout(() => {
    searchBusinesses($('adminBusinessSearch').value.trim()).catch((err) =>
      showToast('err', err?.error?.message || 'Business search failed')
    );
  }, 220);
});

$('adminBusinessResults').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-business-id]');
  if (!btn) return;
  try {
    await selectBusiness(btn.dataset.businessId);
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed to load business');
  }
});

$('adminBizSave').addEventListener('click', async () => {
  try {
    if (!state.selectedBusiness) throw { error: { message: 'Select a business first.' } };
    if (!canSuper()) throw { error: { message: 'Super admin required.' } };
    await req(`/businesses/${state.selectedBusiness.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('adminBizName').value.trim() || undefined,
        owner_name: $('adminBizOwnerName').value.trim() || undefined,
        description: $('adminBizDescription').value.trim() || undefined
      })
    });
    showToast('ok', 'Business updated');
    await selectBusiness(state.selectedBusiness.id);
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed to update business');
  }
});

$('adminBizRemove').addEventListener('click', async () => {
  try {
    if (!state.selectedBusiness) throw { error: { message: 'Select a business first.' } };
    if (!canSuper()) throw { error: { message: 'Super admin required.' } };
    await req(`/admin/businesses/${state.selectedBusiness.id}/remove`, { method: 'POST' });
    state.selectedBusiness = null;
    renderBusinessEditor();
    showToast('ok', 'Business removed');
    await loadInbox();
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed to remove business');
  }
});

$('adminBizLocations').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-location-id]');
  if (!btn) return;
  try {
    if (!canSuper()) throw { error: { message: 'Super admin required.' } };
    await req(`/admin/locations/${btn.dataset.removeLocationId}/remove`, { method: 'POST' });
    showToast('ok', 'Location removed');
    if (state.selectedBusiness) await selectBusiness(state.selectedBusiness.id);
  } catch (err) {
    showToast('err', err?.error?.message || 'Failed to remove location');
  }
});

$('roleAssignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!canSuper()) throw { error: { message: 'Super admin required.' } };
    const email = $('roleAssignEmail').value.trim();
    const role = $('roleAssignValue').value;
    if (!email) throw { error: { message: 'Email is required.' } };
    if (!canOwner() && role === 'admin') {
      throw { error: { message: 'Only owner can assign super_admin.' } };
    }
    const users = await req(`/admin/users?q=${encodeURIComponent(email)}`);
    const exact = (users.data || []).find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
    if (!exact) throw { error: { message: 'User not found.' } };
    await req('/admin/roles/assign', {
      method: 'POST',
      body: JSON.stringify({ user_id: exact.id, role })
    });
    showToast('ok', 'Role updated');
    $('roleAssignEmail').value = '';
  } catch (err) {
    showToast('err', err?.error?.message || 'Role assignment failed');
  }
});

$('adminLogout').addEventListener('click', () => {
  localStorage.removeItem('dir.token');
  window.location.href = './embed.html';
});

$('adminImageBatchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (tierRank(state.tier) < 2) throw { error: { message: 'Super admin required' } };
    const businessId = $('adminBatchBusinessId').value.trim();
    if (!businessId) throw { error: { message: 'Select a business-related task first.' } };
    const files = Array.from($('adminBatchImages').files || []);
    if (!files.length) throw { error: { message: 'Choose one or more images.' } };
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      await reqForm(`/media/businesses/${businessId}/images`, form);
    }
    $('adminBatchImages').value = '';
    showToast('ok', `Uploaded ${files.length} image(s)`);
  } catch (err) {
    showToast('err', err?.error?.message || 'Batch upload failed');
  }
});

(async () => {
  if (!state.token) {
    window.location.href = './embed.html';
    return;
  }
  try {
    const url = new URL(window.location.href);
    const initialBusinessId = url.searchParams.get('businessId');
    const initialQ = url.searchParams.get('q');
    if (initialQ) {
      state.q = initialQ;
      $('adminSearch').value = initialQ;
    }
    await loadMe();
    renderCategories();
    await loadInbox();
    if (initialBusinessId) {
      await selectBusiness(initialBusinessId);
    } else if (initialQ) {
      await searchBusinesses(initialQ);
    }
  } catch (err) {
    showToast('err', err?.error?.message || 'Admin access required');
    setTimeout(() => {
      window.location.href = './embed.html';
    }, 800);
  }
})();
