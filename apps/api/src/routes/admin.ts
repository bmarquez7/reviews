import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { requireRole } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

const moderationParamsSchema = z.object({
  type: z.enum(['rating', 'comment', 'business_reply']),
  id: z.string().uuid()
});

const roleAssignSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['consumer', 'business_owner', 'moderator', 'admin'])
});

const policyVersionSchema = z.object({
  policies_version: z.string().min(1)
});

const statusPatchSchema = z.object({
  status: z.enum(['submitted', 'under_review', 'resolved', 'rejected']),
  admin_decision_notes: z.string().optional()
});

const moderationTable = {
  rating: 'ratings',
  comment: 'comments',
  business_reply: 'business_replies'
} as const;

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/admin/moderation/queue',
    {
      schema: {
        summary: 'Moderation queue',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'flagged', 'all'] },
            type: { type: 'string', enum: ['rating', 'comment', 'business_reply'] }
          }
        }
      }
    },
    async (request) => {
    await requireRole(request, ['moderator', 'admin']);

    const query = z
      .object({
        status: z.enum(['pending', 'flagged', 'all']).default('pending'),
        type: z.enum(['rating', 'comment', 'business_reply']).optional()
      })
      .parse(request.query);

    const [ratingsRes, commentsRes, repliesRes, flagsRes] = await Promise.all([
      (!query.type || query.type === 'rating') && query.status !== 'flagged'
        ? supabaseAdmin.from('ratings').select('id,location_id,user_id,status,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      (!query.type || query.type === 'comment') && query.status !== 'flagged'
        ? supabaseAdmin.from('comments').select('id,location_id,user_id,status,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      (!query.type || query.type === 'business_reply') && query.status !== 'flagged'
        ? supabaseAdmin.from('business_replies').select('id,comment_id,business_id,status,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      query.status !== 'pending'
        ? supabaseAdmin.from('flags').select('*').eq('is_resolved', false).order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (ratingsRes.error || commentsRes.error || repliesRes.error || flagsRes.error) {
      throw new ApiError(500, 'INTERNAL_ERROR', ratingsRes.error?.message ?? commentsRes.error?.message ?? repliesRes.error?.message ?? flagsRes.error?.message ?? 'Queue lookup failed');
    }

    return {
      data: {
        ratings: ratingsRes.data ?? [],
        comments: commentsRes.data ?? [],
        business_replies: repliesRes.data ?? [],
        flags: flagsRes.data ?? []
      }
    };
    }
  );

  app.post(
    '/admin/moderation/:type/:id/:action',
    {
      schema: {
        summary: 'Moderate rating/comment/reply',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['type', 'id', 'action'],
          properties: {
            type: { type: 'string', enum: ['rating', 'comment', 'business_reply'] },
            id: { type: 'string', format: 'uuid' },
            action: { type: 'string', enum: ['approve', 'deny', 'remove'] }
          }
        }
      }
    },
    async (request) => {
    const actor = await requireRole(request, ['moderator', 'admin']);
    const params = moderationParamsSchema.extend({ action: z.enum(['approve', 'deny', 'remove']) }).parse(request.params);

    const table = moderationTable[params.type];
    const nextStatus = params.action === 'approve' ? 'approved' : params.action === 'deny' ? 'denied' : 'removed';

    const updateRes = await supabaseAdmin.from(table).update({ status: nextStatus }).eq('id', params.id).select('id').single();

    if (updateRes.error || !updateRes.data) {
      throw new ApiError(404, 'NOT_FOUND', `${params.type} not found`);
    }

    await supabaseAdmin.from('moderation_actions').insert({
      actor_user_id: actor.id,
      target_type: params.type,
      target_id: params.id,
      action: params.action
    });

    await supabaseAdmin.from('audit_log').insert({
      actor_user_id: actor.id,
      event_type: `moderation.${params.action}`,
      entity_type: params.type,
      entity_id: params.id,
      payload: { status: nextStatus }
    });

    return { data: { id: params.id, status: nextStatus } };
    }
  );

  app.post(
    '/admin/roles/assign',
    {
      schema: {
        summary: 'Assign user role',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['user_id', 'role'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['consumer', 'business_owner', 'moderator', 'admin'] }
          }
        }
      }
    },
    async (request) => {
    await requireRole(request, ['admin']);
    const body = roleAssignSchema.parse(request.body);

    const update = await supabaseAdmin.from('users').update({ role: body.role }).eq('id', body.user_id).select('id,role').single();
    if (update.error || !update.data) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    return { data: update.data };
    }
  );

  app.post(
    '/admin/users/:userId/suspend',
    {
      schema: {
        summary: 'Suspend user',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    async (request) => {
    await requireRole(request, ['admin']);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);

    const update = await supabaseAdmin.from('users').update({ status: 'suspended' }).eq('id', params.userId).select('id,status').single();
    if (update.error || !update.data) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    return { data: update.data };
    }
  );

  app.post(
    '/admin/businesses/:businessId/suspend',
    {
      schema: {
        summary: 'Suspend business',
        tags: ['Admin'],
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
    await requireRole(request, ['admin']);
    const params = z.object({ businessId: z.string().uuid() }).parse(request.params);

    const update = await supabaseAdmin.from('businesses').update({ status: 'suspended' }).eq('id', params.businessId).select('id,status').single();
    if (update.error || !update.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Business not found');
    }

    return { data: update.data };
    }
  );

  app.patch(
    '/admin/appeals/:appealId',
    {
      schema: {
        summary: 'Update appeal status',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['appealId'],
          properties: {
            appealId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['submitted', 'under_review', 'resolved', 'rejected'] },
            admin_decision_notes: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
    const actor = await requireRole(request, ['moderator', 'admin']);
    const params = z.object({ appealId: z.string().uuid() }).parse(request.params);
    const body = statusPatchSchema.parse(request.body);

    const update = await supabaseAdmin
      .from('appeals')
      .update({
        status: body.status,
        admin_decision_notes: body.admin_decision_notes ?? null,
        resolved_at: ['resolved', 'rejected'].includes(body.status) ? new Date().toISOString() : null
      })
      .eq('id', params.appealId)
      .select('id,status,admin_decision_notes')
      .single();

    if (update.error || !update.data) {
      throw new ApiError(404, 'NOT_FOUND', 'Appeal not found');
    }

    await supabaseAdmin.from('moderation_actions').insert({
      actor_user_id: actor.id,
      target_type: 'appeal',
      target_id: params.appealId,
      action: `appeal_status:${body.status}`
    });

    return { data: update.data };
    }
  );

  app.post(
    '/admin/policies/version',
    {
      schema: {
        summary: 'Bump policies version',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['policies_version'],
          properties: {
            policies_version: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request) => {
    await requireRole(request, ['admin']);
    const body = policyVersionSchema.parse(request.body);

    const update = await supabaseAdmin
      .from('platform_config')
      .update({ current_policies_version: body.policies_version, updated_at: new Date().toISOString() })
      .eq('id', true)
      .select('current_policies_version')
      .single();

    if (update.error || !update.data) {
      throw new ApiError(500, 'INTERNAL_ERROR', update.error?.message ?? 'Unable to bump policies version');
    }

    return {
      data: {
        current_policies_version: update.data.current_policies_version,
        force_reacceptance: true
      }
    };
    }
  );
};
