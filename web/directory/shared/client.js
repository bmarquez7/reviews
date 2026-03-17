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

const DISPLAY_NAME_OVERRIDES = new Map([
  ['F L U C T U S Resto&Lounge&coffe', 'FLUCTUS Resto & Lounge & Coffee'],
  ['Maria Bonita Strip Club™️', 'Maria Bonita Strip Club'],
  ['Barber Shop Specialist’et 🌶️', "Barber Shop Specialist'et"],
  ['“SAF” Homemade & Traditional Food', 'SAF Homemade & Traditional Food'],
  ['“Tradita te Meri”', 'Tradita te Meri'],
  ['Gomisteri “Goni”', 'Gomisteri Goni'],
  ['Auto Servis “BERTI”', 'Auto Servis BERTI']
]);

export const formatDisplayName = (value) => {
  const raw = cleanString(value);
  if (!raw) return '';
  if (DISPLAY_NAME_OVERRIDES.has(raw)) return DISPLAY_NAME_OVERRIDES.get(raw);

  let text = raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2122\u00AE\u00A9\uFE0F]/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\b(?:[A-Z]\s+){2,}[A-Z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

  const wrappedMatch = text.match(/^"(.+)"$/);
  if (wrappedMatch) text = wrappedMatch[1].trim();

  return text;
};

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
