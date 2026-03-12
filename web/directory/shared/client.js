export const PROD_API_BASE = 'https://grow-albania-directory-api.onrender.com/v1';

const LOCAL_API_BASES = new Set(['http://127.0.0.1:4000/v1', 'http://localhost:4000/v1']);
const TRUSTED_API_BASES = new Set([PROD_API_BASE, ...LOCAL_API_BASES]);

const cleanString = (value) => String(value ?? '').trim();

export const normalizeApiBase = (value) => {
  const raw = cleanString(value);
  if (!raw) return null;

  try {
    const url = new URL(raw, window.location.origin);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
};

export const isTrustedApiBase = (value) => {
  const normalized = normalizeApiBase(value);
  return normalized ? TRUSTED_API_BASES.has(normalized) : false;
};

export const resolveApiBase = ({ allowStored = true, allowParam = false } = {}) => {
  const candidates = [];

  if (allowParam) {
    const params = new URLSearchParams(window.location.search);
    candidates.push(params.get('apiBase'));
    candidates.push(params.get('api'));
  }

  if (allowStored) {
    candidates.push(localStorage.getItem('dir.apiBase'));
  }

  candidates.push(typeof window.DIRECTORY_API_BASE === 'string' ? window.DIRECTORY_API_BASE : '');
  candidates.push(window.location.hostname === 'localhost' ? 'http://localhost:4000/v1' : '');
  candidates.push(window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:4000/v1' : '');
  candidates.push(PROD_API_BASE);

  for (const candidate of candidates) {
    const normalized = normalizeApiBase(candidate);
    if (normalized && TRUSTED_API_BASES.has(normalized)) {
      return normalized;
    }
  }

  return PROD_API_BASE;
};

export const saveApiBasePreference = (value) => {
  const normalized = normalizeApiBase(value);
  if (!normalized || !TRUSTED_API_BASES.has(normalized)) return null;
  localStorage.setItem('dir.apiBase', normalized);
  return normalized;
};

export const clearApiBasePreference = () => {
  localStorage.removeItem('dir.apiBase');
  return PROD_API_BASE;
};

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const escapeAttr = escapeHtml;

export const safeUrl = (
  value,
  { allowHttp = true, allowHttps = true, allowMailto = false, allowTel = false } = {}
) => {
  const raw = cleanString(value);
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;

  if (allowMailto && raw.startsWith('mailto:')) {
    return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(raw) ? raw : null;
  }

  if (allowTel && raw.startsWith('tel:')) {
    return /^tel:[0-9+()\-.\s]+$/i.test(raw) ? raw : null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && allowHttps) return url.href;
    if (url.protocol === 'http:' && allowHttp) return url.href;
    return null;
  } catch {
    return null;
  }
};

export const safeJsonText = (value) => {
  try {
    return escapeHtml(JSON.stringify(value ?? {}, null, 2));
  } catch {
    return '';
  }
};
