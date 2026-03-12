import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supabaseAdmin } from './supabase.js';

export const REVIEW_MEDIA_BUCKET = 'review-media';
export const BUSINESS_MEDIA_BUCKET = 'business-media';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const BUCKET_CACHE = new Set<string>();
const MEDIA_CACHE = new Map<string, { expiresAt: number; urls: string[] }>();
const MEDIA_CACHE_TTL_MS = 60_000;

const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const extFromName = (name: string) => {
  const ext = path.extname(name || '').toLowerCase();
  if (ext && ext.length <= 8) return ext;
  return '.jpg';
};

export const ensureMediaBucket = async (bucket: string) => {
  if (BUCKET_CACHE.has(bucket)) return;
  const { error } = await supabaseAdmin.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: `${MAX_IMAGE_BYTES}`,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  });

  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }

  BUCKET_CACHE.add(bucket);
};

export const uploadImageToBucket = async (params: {
  bucket: string;
  ownerPrefix: string;
  filename: string;
  body: Buffer;
  contentType: string;
}) => {
  const safeBase = sanitizeName(path.basename(params.filename || 'upload'));
  const ext = extFromName(safeBase);
  const objectPath = `${params.ownerPrefix}/${Date.now()}-${randomUUID()}${ext}`;

  const upload = await supabaseAdmin.storage.from(params.bucket).upload(objectPath, params.body, {
    contentType: params.contentType,
    upsert: false
  });

  if (upload.error) throw upload.error;

  const publicUrl = supabaseAdmin.storage.from(params.bucket).getPublicUrl(objectPath).data.publicUrl;
  return { path: objectPath, public_url: publicUrl };
};

const buildPublicUrl = (bucket: string, objectPath: string) =>
  supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;

const mediaCacheKey = (bucket: string, prefix: string, limit: number) => `${bucket}:${prefix}:${limit}`;

const getCachedMedia = (bucket: string, prefix: string, limit: number) => {
  const entry = MEDIA_CACHE.get(mediaCacheKey(bucket, prefix, limit));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    MEDIA_CACHE.delete(mediaCacheKey(bucket, prefix, limit));
    return null;
  }
  return entry.urls;
};

const setCachedMedia = (bucket: string, prefix: string, limit: number, urls: string[]) => {
  MEDIA_CACHE.set(mediaCacheKey(bucket, prefix, limit), {
    expiresAt: Date.now() + MEDIA_CACHE_TTL_MS,
    urls
  });
};

export const listPublicMediaBatch = async (bucket: string, prefixes: string[], limit = 10) => {
  const uniquePrefixes = Array.from(new Set(prefixes.filter(Boolean)));
  const result = new Map<string, string[]>();
  const uncached: string[] = [];

  for (const prefix of uniquePrefixes) {
    const cached = getCachedMedia(bucket, prefix, limit);
    if (cached) {
      result.set(prefix, cached);
      continue;
    }
    uncached.push(prefix);
  }

  if (!uncached.length) return result;

  const orFilter = uncached.map((prefix) => `name.like.${prefix}%`).join(',');
  const objectRes = await supabaseAdmin
    .schema('storage')
    .from('objects')
    .select('name,created_at')
    .eq('bucket_id', bucket)
    .or(orFilter)
    .order('created_at', { ascending: false })
    .limit(Math.max(uncached.length * limit * 4, uncached.length * limit));

  if (objectRes.error) {
    for (const prefix of uncached) {
      result.set(prefix, []);
      setCachedMedia(bucket, prefix, limit, []);
    }
    return result;
  }

  const grouped = new Map<string, string[]>();
  for (const prefix of uncached) grouped.set(prefix, []);

  for (const row of objectRes.data ?? []) {
    const objectName = String(row.name || '');
    const prefix = uncached.find((candidate) => objectName.startsWith(candidate));
    if (!prefix) continue;
    const current = grouped.get(prefix) ?? [];
    if (current.length >= limit) continue;
    current.push(buildPublicUrl(bucket, objectName));
    grouped.set(prefix, current);
  }

  for (const prefix of uncached) {
    const urls = grouped.get(prefix) ?? [];
    result.set(prefix, urls);
    setCachedMedia(bucket, prefix, limit, urls);
  }

  return result;
};

export const listPublicMedia = async (bucket: string, prefix: string, limit = 10) => {
  const batch = await listPublicMediaBatch(bucket, [prefix], limit);
  return batch.get(prefix) ?? [];
};
