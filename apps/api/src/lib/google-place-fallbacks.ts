import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

type GoogleBusinessFallback = {
  canonical_name: string;
  display_name?: string;
  rating: number;
  rating_count: number;
};

type GoogleFallbackManifest = {
  generated_at: string;
  items: GoogleBusinessFallback[];
};

const MANIFEST_PATH = fileURLToPath(new URL('../../../../data/google_place_fallbacks.json', import.meta.url));

let cache: { mtimeMs: number; byCanonicalName: Map<string, GoogleBusinessFallback> } | null = null;

export const canonicalBusinessName = (value: string) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[&]/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(shpk|llc|ltd|inc|branch|location)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const loadManifest = () => {
  try {
    const stats = fs.statSync(MANIFEST_PATH);
    if (cache && cache.mtimeMs === stats.mtimeMs) return cache.byCanonicalName;

    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as GoogleFallbackManifest;
    const byCanonicalName = new Map<string, GoogleBusinessFallback>();
    for (const item of parsed.items || []) {
      if (!item?.canonical_name) continue;
      byCanonicalName.set(item.canonical_name, item);
    }

    cache = { mtimeMs: stats.mtimeMs, byCanonicalName };
    return byCanonicalName;
  } catch {
    return new Map<string, GoogleBusinessFallback>();
  }
};

export const lookupGoogleBusinessFallback = (business: {
  name?: string | null;
  owner_name?: string | null;
}) => {
  if (String(business.owner_name || '').trim() !== 'Imported Listing') return null;
  const canonical = canonicalBusinessName(String(business.name || ''));
  if (!canonical) return null;
  return loadManifest().get(canonical) ?? null;
};
