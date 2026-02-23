import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supabaseAdmin } from './supabase.js';

export const REVIEW_MEDIA_BUCKET = 'review-media';
export const BUSINESS_MEDIA_BUCKET = 'business-media';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const BUCKET_CACHE = new Set<string>();

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

export const listPublicMedia = async (bucket: string, prefix: string, limit = 10) => {
  const listRes = await supabaseAdmin.storage.from(bucket).list(prefix, {
    limit,
    sortBy: { column: 'created_at', order: 'desc' }
  });

  if (listRes.error) return [];

  return (listRes.data ?? [])
    .filter((item) => !!item.name)
    .map((item) => {
      const objectPath = `${prefix}${item.name}`;
      return supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
    });
};
