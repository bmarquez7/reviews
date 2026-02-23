import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth, requirePoliciesAccepted } from '../lib/auth.js';

const HalfStep = z.number().min(0).max(5).refine((v) => Number.isInteger(v * 2), 'Must be 0..5 in 0.5 steps');

const UpsertRatingSchema = z.object({
  factors: z.object({
    pricing_transparency: HalfStep,
    friendliness: HalfStep,
    lgbtq_acceptance: HalfStep,
    racial_tolerance: HalfStep,
    religious_tolerance: HalfStep,
    accessibility_friendliness: HalfStep,
    cleanliness: HalfStep
  }),
  secondary: z
    .object({
      pricing_value: HalfStep.optional(),
      child_care_availability: HalfStep.optional(),
      child_friendliness: HalfStep.optional(),
      party_size_accommodations: HalfStep.optional(),
      accessibility_details_score: HalfStep.optional(),
      accessibility_notes: z.string().max(1000).optional()
    })
    .optional()
});

const CommentCreateSchema = z.object({
  content: z.string().min(1),
  visit_month: z.number().int().min(1).max(12).optional(),
  visit_year: z.number().int().min(1900).max(2100).optional()
});

const CommentUpdateSchema = z.object({
  content: z.string().min(1)
});

const countWords = (input: string): number => {
  const words = input.trim().split(/\s+/).filter(Boolean);
  return words.length;
};

const enforceEditableWindow = (createdAtIso: string) => {
  const createdAt = new Date(createdAtIso).getTime();
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  if (now - createdAt > thirtyDaysMs) {
    throw new ApiError(403, 'DELETE_WINDOW_EXPIRED', 'Edit/delete window is 30 days');
  }
};

export const ratingRoutes: FastifyPluginAsync = async (app) => {
  app.put(
    '/locations/:locationId/ratings/me',
    {
      schema: {
        summary: 'Create or update my rating for a location',
        tags: ['Ratings'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['locationId'],
          properties: {
            locationId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          required: ['factors'],
          properties: {
            factors: {
              type: 'object',
              required: [
                'pricing_transparency',
                'friendliness',
                'lgbtq_acceptance',
                'racial_tolerance',
                'religious_tolerance',
                'accessibility_friendliness',
                'cleanliness'
              ],
              properties: {
                pricing_transparency: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                friendliness: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                lgbtq_acceptance: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                racial_tolerance: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                religious_tolerance: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                accessibility_friendliness: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                cleanliness: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 }
              }
            },
            secondary: {
              type: 'object',
              properties: {
                pricing_value: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                child_care_availability: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                child_friendliness: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                party_size_accommodations: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                accessibility_details_score: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
                accessibility_notes: { type: 'string', maxLength: 1000 }
              }
            }
          }
        }
      }
    },
    async (request) => {
    const user = await requirePoliciesAccepted(request);
    const params = z.object({ locationId: z.string().uuid() }).parse(request.params);
    const body = UpsertRatingSchema.parse(request.body);

    const upsertRes = await supabaseAdmin
      .from('ratings')
      .upsert(
        {
          user_id: user.id,
          location_id: params.locationId,
          ...body.factors,
          status: 'approved'
        },
        { onConflict: 'user_id,location_id' }
      )
      .select('id,overall_score,updated_at')
      .single();

    if (upsertRes.error || !upsertRes.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', upsertRes.error?.message ?? 'Unable to save rating');
    }

    if (body.secondary) {
      const secondaryRes = await supabaseAdmin.from('secondary_ratings').upsert(
        {
          rating_id: upsertRes.data.id,
          ...body.secondary
        },
        { onConflict: 'rating_id' }
      );

      if (secondaryRes.error) {
        throw new ApiError(422, 'VALIDATION_ERROR', secondaryRes.error.message);
      }
    }

    return {
      data: {
        rating_id: upsertRes.data.id,
        overall_score_raw: Number(upsertRes.data.overall_score),
        overall_score_display: Math.round(Number(upsertRes.data.overall_score) * 2) / 2,
        updated_at: upsertRes.data.updated_at
      }
    };
    }
  );

  app.post(
    '/ratings/:ratingId/comment',
    {
      schema: {
        summary: 'Create or update comment for my rating',
        tags: ['Ratings'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['ratingId'],
          properties: {
            ratingId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1 },
            visit_month: { type: 'integer', minimum: 1, maximum: 12 },
            visit_year: { type: 'integer', minimum: 1900, maximum: 2100 }
          }
        }
      }
    },
    async (request) => {
    const user = await requirePoliciesAccepted(request);
    const params = z.object({ ratingId: z.string().uuid() }).parse(request.params);
    const body = CommentCreateSchema.parse(request.body);

    if (countWords(body.content) < 10) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Comments must be at least 10 words');
    }

    const ratingRes = await supabaseAdmin
      .from('ratings')
      .select('id,user_id,location_id')
      .eq('id', params.ratingId)
      .eq('user_id', user.id)
      .single();

    if (ratingRes.error || !ratingRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Rating not found');
    }

    const configRes = await supabaseAdmin.from('platform_config').select('comments_premoderation').eq('id', true).single();
    const commentsPremoderation = configRes.data?.comments_premoderation ?? false;

    const insertRes = await supabaseAdmin
      .from('comments')
      .upsert(
        {
          rating_id: ratingRes.data.id,
          user_id: user.id,
          location_id: ratingRes.data.location_id,
          content: body.content,
          visit_month: body.visit_month ?? null,
          visit_year: body.visit_year ?? null,
          status: commentsPremoderation ? 'pending' : 'approved'
        },
        { onConflict: 'rating_id' }
      )
      .select('id,status')
      .single();

    if (insertRes.error || !insertRes.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', insertRes.error?.message ?? 'Unable to save comment');
    }

    return { data: { comment_id: insertRes.data.id, status: insertRes.data.status } };
    }
  );

  app.patch(
    '/comments/:commentId',
    {
      schema: {
        summary: 'Edit my comment (within 30 days)',
        tags: ['Ratings'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['commentId'],
          properties: {
            commentId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request) => {
    const user = await requireAuth(request);
    const params = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const body = CommentUpdateSchema.parse(request.body);

    if (countWords(body.content) < 10) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Comments must be at least 10 words');
    }

    const existingRes = await supabaseAdmin
      .from('comments')
      .select('id,user_id,created_at')
      .eq('id', params.commentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (existingRes.error || !existingRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    }

    enforceEditableWindow(existingRes.data.created_at);

    const updateRes = await supabaseAdmin
      .from('comments')
      .update({ content: body.content })
      .eq('id', params.commentId)
      .select('id,updated_at')
      .single();

    if (updateRes.error || !updateRes.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', updateRes.error?.message ?? 'Unable to update comment');
    }

    return { data: updateRes.data };
    }
  );

  app.delete(
    '/comments/:commentId',
    {
      schema: {
        summary: 'Delete my comment (within 30 days)',
        tags: ['Ratings'],
        security: [{ bearerAuth: [] }],
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

    const existingRes = await supabaseAdmin
      .from('comments')
      .select('id,user_id,created_at')
      .eq('id', params.commentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (existingRes.error || !existingRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    }

    enforceEditableWindow(existingRes.data.created_at);

    const softDeleteRes = await supabaseAdmin
      .from('comments')
      .update({ deleted_at: new Date().toISOString(), status: 'removed' })
      .eq('id', params.commentId);

    if (softDeleteRes.error) {
      throw new ApiError(422, 'VALIDATION_ERROR', softDeleteRes.error.message);
    }

    return { data: { deleted: true } };
    }
  );

  app.post(
    '/comments/:commentId/removal-request',
    {
      schema: {
        summary: 'Request moderation removal after 30-day window',
        tags: ['Ratings'],
        security: [{ bearerAuth: [] }],
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

    const commentRes = await supabaseAdmin
      .from('comments')
      .select('id,user_id')
      .eq('id', params.commentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (commentRes.error || !commentRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    }

    const flagRes = await supabaseAdmin
      .from('flags')
      .insert({
        target_type: 'comment',
        target_id: commentRes.data.id,
        reporter_user_id: user.id,
        reason: 'User requested removal outside 30-day window',
        details: 'Self-requested comment removal'
      })
      .select('id')
      .single();

    if (flagRes.error || !flagRes.data) {
      throw new ApiError(500, 'INTERNAL_ERROR', flagRes.error?.message ?? 'Unable to create removal request');
    }

    return { data: { request_id: flagRes.data.id, status: 'submitted' } };
    }
  );
};
