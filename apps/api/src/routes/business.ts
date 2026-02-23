import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePoliciesAccepted, requireRole } from '../lib/auth.js';

const createBusinessSchema = z.object({
  name: z.string().min(1),
  owner_name: z.string().min(1),
  description: z.string().optional(),
  mission_statement: z.string().optional(),
  primary_phone: z.string().optional(),
  primary_email: z.string().email().optional(),
  website_url: z.string().url().optional(),
  social_facebook: z.string().url().optional(),
  social_instagram: z.string().url().optional(),
  social_tiktok: z.string().url().optional(),
  social_linkedin: z.string().url().optional(),
  social_youtube: z.string().url().optional(),
  social_other: z.string().url().optional(),
  founded_year: z.number().int().min(1800).max(2100).optional(),
  category_ids: z.array(z.string().uuid()).default([])
});

const createLocationSchema = z.object({
  location_name: z.string().optional(),
  address_line: z.string().min(1),
  city: z.string().min(1),
  region: z.string().optional(),
  country: z.string().min(1),
  postal_code: z.string().optional(),
  location_phone: z.string().optional(),
  location_email: z.string().email().optional(),
  location_hours: z.record(z.unknown()).optional(),
  opened_year: z.number().int().min(1800).max(2100).optional()
});

const replySchema = z.object({
  content: z.string().min(10)
});

const appealSchema = z.object({
  target_type: z.enum(['business', 'location']),
  target_business_id: z.string().uuid().optional(),
  target_location_id: z.string().uuid().optional(),
  reason: z.string().min(1),
  details: z.string().min(1)
});

const claimRequestSchema = z.object({
  message: z.string().min(10).max(2000).optional()
});

const assertBusinessOwner = async (userId: string, businessId: string) => {
  const businessRes = await supabaseAdmin
    .from('businesses')
    .select('id,owner_user_id')
    .eq('id', businessId)
    .single();

  if (businessRes.error || !businessRes.data) {
    throw new ApiError(404, 'NOT_FOUND', 'Business not found');
  }

  if (businessRes.data.owner_user_id !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this business');
  }
};

export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/businesses/:businessId/claim-request',
    {
      schema: {
        summary: 'Submit a request to claim an existing business',
        tags: ['Business'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['businessId'],
          properties: {
            businessId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          properties: {
            message: { type: 'string', minLength: 10, maxLength: 2000 }
          }
        }
      }
    },
    async (request) => {
      const user = await requirePoliciesAccepted(request);
      const params = z.object({ businessId: z.string().uuid() }).parse(request.params);
      const body = claimRequestSchema.parse(request.body ?? {});

      const business = await supabaseAdmin
        .from('businesses')
        .select('id,name,owner_user_id,is_claimed,status')
        .eq('id', params.businessId)
        .single();

      if (business.error || !business.data || business.data.status !== 'active') {
        throw new ApiError(404, 'NOT_FOUND', 'Business not found');
      }

      if (business.data.is_claimed && business.data.owner_user_id && business.data.owner_user_id !== user.id) {
        throw new ApiError(409, 'ALREADY_CLAIMED', 'This business is already claimed');
      }

      if (business.data.owner_user_id === user.id) {
        return { data: { status: 'already_owner' } };
      }

      const existingOpen = await supabaseAdmin
        .from('appeals')
        .select('id,status')
        .eq('target_type', 'business')
        .eq('target_business_id', params.businessId)
        .eq('reason', 'claim_request')
        .in('status', ['submitted', 'under_review'])
        .limit(1)
        .maybeSingle();

      if (existingOpen.error) {
        throw new ApiError(500, 'INTERNAL_ERROR', existingOpen.error.message);
      }

      if (existingOpen.data) {
        throw new ApiError(409, 'CLAIM_REQUEST_OPEN', 'A claim request is already open for this business');
      }

      const created = await supabaseAdmin
        .from('appeals')
        .insert({
          business_id: params.businessId,
          target_type: 'business',
          target_business_id: params.businessId,
          target_location_id: null,
          submitted_by: user.id,
          reason: 'claim_request',
          details:
            body.message ??
            'Business claim request submitted by user. Please verify ownership before approval.',
          status: 'submitted'
        })
        .select('id,status')
        .single();

      if (created.error || !created.data) {
        throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to submit claim request');
      }

      return { data: { appeal_id: created.data.id, status: created.data.status } };
    }
  );

  app.get(
    '/businesses/mine',
    {
      schema: {
        summary: 'List businesses owned by current user',
        tags: ['Business'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      const user = await requireRole(request, ['business_owner', 'admin']);

      const res = await supabaseAdmin
        .from('businesses')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false });

      if (res.error) {
        throw new ApiError(500, 'INTERNAL_ERROR', res.error.message);
      }

      return { data: res.data ?? [] };
    }
  );

  app.post(
    '/businesses',
    {
      schema: {
        summary: 'Create business profile',
        tags: ['Business'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'owner_name'],
          properties: {
            name: { type: 'string', minLength: 1 },
            owner_name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            mission_statement: { type: 'string' },
            primary_phone: { type: 'string' },
            primary_email: { type: 'string', format: 'email' },
            website_url: { type: 'string', format: 'uri' },
            social_facebook: { type: 'string', format: 'uri' },
            social_instagram: { type: 'string', format: 'uri' },
            social_tiktok: { type: 'string', format: 'uri' },
            social_linkedin: { type: 'string', format: 'uri' },
            social_youtube: { type: 'string', format: 'uri' },
            social_other: { type: 'string', format: 'uri' },
            founded_year: { type: 'integer', minimum: 1800, maximum: 2100 },
            category_ids: { type: 'array', items: { type: 'string', format: 'uuid' } }
          }
        }
      }
    },
    async (request) => {
    const user = await requirePoliciesAccepted(request);
    if (!['business_owner', 'admin'].includes(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Business role required');
    }

    const body = createBusinessSchema.parse(request.body);

    const created = await supabaseAdmin
      .from('businesses')
      .insert({
        owner_user_id: user.id,
        name: body.name,
        owner_name: body.owner_name,
        description: body.description ?? null,
        mission_statement: body.mission_statement ?? null,
        primary_phone: body.primary_phone ?? null,
        primary_email: body.primary_email ?? null,
        website_url: body.website_url ?? null,
        social_facebook: body.social_facebook ?? null,
        social_instagram: body.social_instagram ?? null,
        social_tiktok: body.social_tiktok ?? null,
        social_linkedin: body.social_linkedin ?? null,
        social_youtube: body.social_youtube ?? null,
        social_other: body.social_other ?? null,
        founded_year: body.founded_year ?? null,
        is_claimed: true
      })
      .select('id,name')
      .single();

    if (created.error || !created.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to create business');
    }

    if (body.category_ids.length > 0) {
      const assignmentRes = await supabaseAdmin.from('business_category_assignments').insert(
        body.category_ids.map((categoryId) => ({ business_id: created.data.id, category_id: categoryId }))
      );

      if (assignmentRes.error) {
        throw new ApiError(422, 'VALIDATION_ERROR', assignmentRes.error.message);
      }
    }

    return { data: created.data };
    }
  );

  app.post(
    '/businesses/:businessId/locations',
    {
      schema: {
        summary: 'Create business location',
        tags: ['Business'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['businessId'],
          properties: {
            businessId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          required: ['address_line', 'city', 'country'],
          properties: {
            location_name: { type: 'string' },
            address_line: { type: 'string', minLength: 1 },
            city: { type: 'string', minLength: 1 },
            region: { type: 'string' },
            country: { type: 'string', minLength: 1 },
            postal_code: { type: 'string' },
            location_phone: { type: 'string' },
            location_email: { type: 'string', format: 'email' },
            location_hours: { type: 'object', additionalProperties: true },
            opened_year: { type: 'integer', minimum: 1800, maximum: 2100 }
          }
        }
      }
    },
    async (request) => {
    const user = await requireRole(request, ['business_owner', 'admin']);
    const params = z.object({ businessId: z.string().uuid() }).parse(request.params);
    const body = createLocationSchema.parse(request.body);

    if (user.role !== 'admin') {
      await assertBusinessOwner(user.id, params.businessId);
    }

    const created = await supabaseAdmin
      .from('business_locations')
      .insert({
        business_id: params.businessId,
        ...body,
        region: body.region ?? null,
        postal_code: body.postal_code ?? null,
        location_phone: body.location_phone ?? null,
        location_email: body.location_email ?? null,
        location_hours: body.location_hours ?? null,
        opened_year: body.opened_year ?? null
      })
      .select('*')
      .single();

    if (created.error || !created.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to create location');
    }

    return { data: created.data };
    }
  );

  app.patch(
    '/businesses/:businessId',
    {
      schema: {
        summary: 'Update business profile',
        tags: ['Business'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['businessId'],
          properties: {
            businessId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            owner_name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            mission_statement: { type: 'string' },
            primary_phone: { type: 'string' },
            primary_email: { type: 'string', format: 'email' },
            website_url: { type: 'string', format: 'uri' }
          }
        }
      }
    },
    async (request) => {
      const user = await requireRole(request, ['business_owner', 'admin']);
      const params = z.object({ businessId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          owner_name: z.string().min(1).optional(),
          description: z.string().optional(),
          mission_statement: z.string().optional(),
          primary_phone: z.string().optional(),
          primary_email: z.string().email().optional(),
          website_url: z.string().url().optional()
        })
        .parse(request.body);

      if (user.role !== 'admin') {
        await assertBusinessOwner(user.id, params.businessId);
      }

      const update = await supabaseAdmin
        .from('businesses')
        .update(body)
        .eq('id', params.businessId)
        .select('*')
        .single();

      if (update.error || !update.data) {
        throw new ApiError(422, 'VALIDATION_ERROR', update.error?.message ?? 'Unable to update business');
      }

      return { data: update.data };
    }
  );

  app.post(
    '/comments/:commentId/business-reply',
    {
      schema: {
        summary: 'Reply to a comment as business',
        tags: ['Business'],
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
            content: { type: 'string', minLength: 10 }
          }
        }
      }
    },
    async (request) => {
    const user = await requireRole(request, ['business_owner', 'admin']);
    const params = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const body = replySchema.parse(request.body);

    const commentRes = await supabaseAdmin
      .from('comments')
      .select('id,location_id')
      .eq('id', params.commentId)
      .single();

    if (commentRes.error || !commentRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    }

    const locationRes = await supabaseAdmin
      .from('business_locations')
      .select('business_id')
      .eq('id', commentRes.data.location_id)
      .single();

    if (locationRes.error || !locationRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Location not found');
    }

    if (user.role !== 'admin') {
      await assertBusinessOwner(user.id, locationRes.data.business_id);
    }

    const created = await supabaseAdmin
      .from('business_replies')
      .upsert(
        {
          comment_id: params.commentId,
          business_id: locationRes.data.business_id,
          author_user_id: user.id,
          content: body.content,
          status: 'approved'
        },
        { onConflict: 'comment_id,business_id' }
      )
      .select('id,status')
      .single();

    if (created.error || !created.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to save reply');
    }

    return { data: { reply_id: created.data.id, status: created.data.status } };
    }
  );

  app.post(
    '/appeals',
    {
      schema: {
        summary: 'Submit appeal',
        tags: ['Appeals'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['target_type', 'reason', 'details'],
          properties: {
            target_type: { type: 'string', enum: ['business', 'location'] },
            target_business_id: { type: 'string', format: 'uuid' },
            target_location_id: { type: 'string', format: 'uuid' },
            reason: { type: 'string', minLength: 1 },
            details: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request) => {
    const user = await requireRole(request, ['business_owner', 'admin']);
    const body = appealSchema.parse(request.body);

    if (body.target_type === 'business' && !body.target_business_id) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'target_business_id required for business appeal');
    }
    if (body.target_type === 'location' && !body.target_location_id) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'target_location_id required for location appeal');
    }

    const ownerBusinessRes = await supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (ownerBusinessRes.error || !ownerBusinessRes.data) {
      throw new ApiError(403, 'FORBIDDEN', 'No owned business found for appeal');
    }

    const created = await supabaseAdmin
      .from('appeals')
      .insert({
        business_id: ownerBusinessRes.data.id,
        target_type: body.target_type,
        target_business_id: body.target_business_id ?? null,
        target_location_id: body.target_location_id ?? null,
        submitted_by: user.id,
        reason: body.reason,
        details: body.details,
        status: 'submitted'
      })
      .select('id,status')
      .single();

    if (created.error || !created.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to create appeal');
    }

    return { data: { appeal_id: created.data.id, status: created.data.status } };
    }
  );

  app.get(
    '/businesses/:businessId/appeals',
    {
      schema: {
        summary: 'List business appeals',
        tags: ['Appeals'],
        security: [{ bearerAuth: [] }],
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
    const user = await requireRole(request, ['business_owner', 'admin', 'moderator']);
    const params = z.object({ businessId: z.string().uuid() }).parse(request.params);

    if (!['admin', 'moderator'].includes(user.role)) {
      await assertBusinessOwner(user.id, params.businessId);
    }

    const appeals = await supabaseAdmin
      .from('appeals')
      .select('*')
      .eq('business_id', params.businessId)
      .order('created_at', { ascending: false });

    if (appeals.error) {
      throw new ApiError(500, 'INTERNAL_ERROR', appeals.error.message);
    }

    return { data: appeals.data ?? [] };
    }
  );
};
