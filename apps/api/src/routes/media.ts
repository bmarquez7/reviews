import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import {
  BUSINESS_MEDIA_BUCKET,
  MAX_IMAGE_BYTES,
  REVIEW_MEDIA_BUCKET,
  ensureMediaBucket,
  uploadImageToBucket
} from '../lib/media.js';

const readImageFile = async (request: FastifyRequest) => {
  const file = await request.file();
  if (!file) throw new ApiError(400, 'VALIDATION_ERROR', 'Missing file');

  if (!file.mimetype?.startsWith('image/')) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Only image files are allowed');
  }

  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Image too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB)`);
  }

  return { file, buffer };
};

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/media/comments/:commentId/images',
    {
      schema: {
        summary: 'Upload image for a comment',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
        params: {
          type: 'object',
          required: ['commentId'],
          properties: {
            commentId: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    async (request) => {
      const user = await requireAuth(request);
      const params = z.object({ commentId: z.string().uuid() }).parse(request.params);

      const comment = await supabaseAdmin
        .from('comments')
        .select('id,user_id,status,deleted_at')
        .eq('id', params.commentId)
        .maybeSingle();

      if (comment.error || !comment.data || comment.data.deleted_at) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
      }

      const isPrivileged = user.role === 'admin' || user.role === 'moderator';
      if (!isPrivileged && comment.data.user_id !== user.id) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed to upload images for this comment');
      }

      const { file, buffer } = await readImageFile(request);
      await ensureMediaBucket(REVIEW_MEDIA_BUCKET);
      const uploaded = await uploadImageToBucket({
        bucket: REVIEW_MEDIA_BUCKET,
        ownerPrefix: `comment/${params.commentId}`,
        filename: file.filename,
        body: buffer,
        contentType: file.mimetype
      });

      return { data: uploaded };
    }
  );

  app.post(
    '/media/businesses/:businessId/images',
    {
      schema: {
        summary: 'Upload image for a business page',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
        params: {
          type: 'object',
          required: ['businessId'],
          properties: {
            businessId: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    async (request) => {
      const user = await requireAuth(request);
      const params = z.object({ businessId: z.string().uuid() }).parse(request.params);

      const business = await supabaseAdmin
        .from('businesses')
        .select('id,owner_user_id,status')
        .eq('id', params.businessId)
        .maybeSingle();

      if (business.error || !business.data) {
        throw new ApiError(404, 'NOT_FOUND', 'Business not found');
      }

      const isPrivileged = user.role === 'admin' || user.role === 'moderator';
      if (!isPrivileged && business.data.owner_user_id !== user.id) {
        throw new ApiError(403, 'FORBIDDEN', 'Only business owner can upload business images');
      }

      const { file, buffer } = await readImageFile(request);
      await ensureMediaBucket(BUSINESS_MEDIA_BUCKET);
      const uploaded = await uploadImageToBucket({
        bucket: BUSINESS_MEDIA_BUCKET,
        ownerPrefix: `business/${params.businessId}`,
        filename: file.filename,
        body: buffer,
        contentType: file.mimetype
      });

      return { data: uploaded };
    }
  );
};
