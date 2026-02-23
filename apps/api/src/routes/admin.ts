import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { requireRole } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { env } from '../lib/env.js';
import { BUSINESS_MEDIA_BUCKET, REVIEW_MEDIA_BUCKET } from '../lib/media.js';

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

const adminInboxQuerySchema = z.object({
  category: z
    .enum(['all', 'business_requests', 'claim_requests', 'location_requests', 'moderation'])
    .default('all'),
  status: z.enum(['all', 'submitted', 'under_review', 'resolved', 'rejected']).default('all'),
  q: z.string().optional()
});

const requestInfoSchema = z.object({
  note: z.string().min(3)
});

const removeBusinessParamsSchema = z.object({
  businessId: z.string().uuid()
});

const removeLocationParamsSchema = z.object({
  locationId: z.string().uuid()
});

const updateCommentSchema = z.object({
  content: z.string().min(10).optional(),
  status: z.enum(['pending', 'approved', 'denied', 'removed']).optional()
});

const updateRatingSchema = z.object({
  pricing_transparency: z.number().min(0).max(5).optional(),
  friendliness: z.number().min(0).max(5).optional(),
  lgbtq_acceptance: z.number().min(0).max(5).optional(),
  racial_tolerance: z.number().min(0).max(5).optional(),
  religious_tolerance: z.number().min(0).max(5).optional(),
  accessibility_friendliness: z.number().min(0).max(5).optional(),
  cleanliness: z.number().min(0).max(5).optional(),
  status: z.enum(['pending', 'approved', 'denied', 'removed']).optional()
});

const mediaRemoveSchema = z.object({
  bucket: z.enum([BUSINESS_MEDIA_BUCKET, REVIEW_MEDIA_BUCKET]),
  object_path: z.string().min(1)
});

const moderationTable = {
  rating: 'ratings',
  comment: 'comments',
  business_reply: 'business_replies'
} as const;

type AdminTier = 'admin' | 'super_admin' | 'owner';

const ownerEmails = new Set(
  env.OWNER_EMAILS.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const resolveAdminTier = (user: { role: string; email?: string }): AdminTier | null => {
  if (user.email && ownerEmails.has(user.email.toLowerCase())) return 'owner';
  if (user.role === 'admin') return 'super_admin';
  if (user.role === 'moderator') return 'admin';
  return null;
};

const tierAllows = (tier: AdminTier, required: AdminTier) => {
  const order: Record<AdminTier, number> = { admin: 1, super_admin: 2, owner: 3 };
  return order[tier] >= order[required];
};

const requireAdminTier = async (request: Parameters<typeof requireRole>[0], required: AdminTier) => {
  const actor = await requireRole(request, ['moderator', 'admin']);
  const tier = resolveAdminTier(actor);
  if (!tier || !tierAllows(tier, required)) {
    throw new ApiError(403, 'FORBIDDEN', 'Insufficient admin tier');
  }
  return { actor, tier };
};

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/admin/me',
    {
      schema: {
        summary: 'Get admin tier information',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      const actor = await requireRole(request, ['moderator', 'admin']);
      const tier = resolveAdminTier(actor);
      if (!tier) throw new ApiError(403, 'FORBIDDEN', 'Not an admin user');
      return { data: { id: actor.id, email: actor.email ?? null, role: actor.role, tier } };
    }
  );

  app.get(
    '/admin/inbox',
    {
      schema: {
        summary: 'Admin inbox task list',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['all', 'business_requests', 'claim_requests', 'location_requests', 'moderation']
            },
            status: { type: 'string', enum: ['all', 'submitted', 'under_review', 'resolved', 'rejected'] },
            q: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      await requireAdminTier(request, 'admin');
      const query = adminInboxQuerySchema.parse(request.query);

      let appealsQuery = supabaseAdmin
        .from('appeals')
        .select('id,business_id,target_type,target_business_id,target_location_id,submitted_by,reason,details,status,created_at,updated_at,resolved_at,admin_decision_notes')
        .order('updated_at', { ascending: false })
        .limit(200);

      if (query.status !== 'all') appealsQuery = appealsQuery.eq('status', query.status);
      if (query.category === 'business_requests') appealsQuery = appealsQuery.in('reason', ['claim_request', 'location_add_request', 'business_update_request']);
      if (query.category === 'claim_requests') appealsQuery = appealsQuery.eq('reason', 'claim_request');
      if (query.category === 'location_requests') appealsQuery = appealsQuery.eq('reason', 'location_add_request');

      const [appealsRes, queueRes] = await Promise.all([
        query.category === 'moderation'
          ? Promise.resolve({ data: [], error: null })
          : appealsQuery,
        query.category === 'all' || query.category === 'moderation'
          ? Promise.all([
              supabaseAdmin.from('ratings').select('id,location_id,user_id,status,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
              supabaseAdmin.from('comments').select('id,location_id,user_id,status,created_at,content').eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
              supabaseAdmin.from('business_replies').select('id,comment_id,business_id,status,created_at,content').eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
            ])
          : Promise.resolve([
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null }
            ])
      ]);

      const [ratingsRes, commentsRes, repliesRes] = queueRes;

      if (appealsRes.error || ratingsRes.error || commentsRes.error || repliesRes.error) {
        throw new ApiError(
          500,
          'INTERNAL_ERROR',
          appealsRes.error?.message ??
            ratingsRes.error?.message ??
            commentsRes.error?.message ??
            repliesRes.error?.message ??
            'Inbox lookup failed'
        );
      }

      let appeals = appealsRes.data ?? [];
      if (query.q) {
        const q = query.q.toLowerCase();
        const businessMatches = await supabaseAdmin
          .from('businesses')
          .select('id,name')
          .ilike('name', `%${query.q}%`)
          .limit(50);
        const matchedBusinessIds = new Set((businessMatches.data ?? []).map((row) => row.id));

        appeals = appeals.filter(
          (item) =>
            item.reason.toLowerCase().includes(q) ||
            item.details.toLowerCase().includes(q) ||
            item.status.toLowerCase().includes(q) ||
            String(item.business_id ?? '').toLowerCase().includes(q) ||
            String(item.target_business_id ?? '').toLowerCase().includes(q) ||
            matchedBusinessIds.has(item.business_id) ||
            (item.target_business_id ? matchedBusinessIds.has(item.target_business_id) : false)
        );
      }

      return {
        data: {
          appeals,
          moderation: {
            ratings: ratingsRes.data ?? [],
            comments: commentsRes.data ?? [],
            business_replies: repliesRes.data ?? []
          }
        }
      };
    }
  );

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
    '/admin/appeals/:appealId/request-info',
    {
      schema: {
        summary: 'Request more information for an appeal',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['appealId'],
          properties: { appealId: { type: 'string', format: 'uuid' } }
        },
        body: {
          type: 'object',
          required: ['note'],
          properties: { note: { type: 'string', minLength: 3 } }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'admin');
      const params = z.object({ appealId: z.string().uuid() }).parse(request.params);
      const body = requestInfoSchema.parse(request.body);

      const update = await supabaseAdmin
        .from('appeals')
        .update({
          status: 'under_review',
          admin_decision_notes: body.note
        })
        .eq('id', params.appealId)
        .select('id,status,admin_decision_notes')
        .single();

      if (update.error || !update.data) throw new ApiError(404, 'NOT_FOUND', 'Appeal not found');

      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'appeal',
        target_id: params.appealId,
        action: 'appeal_request_info',
        metadata: { note: body.note }
      });

      return { data: update.data };
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
    const { tier } = await requireAdminTier(request, 'super_admin');
    const body = roleAssignSchema.parse(request.body);

    if (tier === 'super_admin' && body.role === 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'Only owner can assign admin role');
    }

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

    if (body.status === 'resolved') {
      const appeal = await supabaseAdmin
        .from('appeals')
        .select('id,reason,target_type,target_business_id,submitted_by')
        .eq('id', params.appealId)
        .single();

      if (!appeal.error && appeal.data?.reason === 'claim_request' && appeal.data.target_type === 'business' && appeal.data.target_business_id) {
        await supabaseAdmin
          .from('businesses')
          .update({
            owner_user_id: appeal.data.submitted_by,
            is_claimed: true
          })
          .eq('id', appeal.data.target_business_id);

        await supabaseAdmin
          .from('users')
          .update({ role: 'business_owner' })
          .eq('id', appeal.data.submitted_by)
          .neq('role', 'admin');
      }
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

  app.get(
    '/admin/users',
    {
      schema: {
        summary: 'List users for admin assignment',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      await requireAdminTier(request, 'super_admin');
      const query = z.object({ q: z.string().optional() }).parse(request.query);

      let usersQ = supabaseAdmin
        .from('users')
        .select('id,email,role,status,created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (query.q) usersQ = usersQ.ilike('email', `%${query.q}%`);
      const usersRes = await usersQ;
      if (usersRes.error) throw new ApiError(500, 'INTERNAL_ERROR', usersRes.error.message);
      return { data: usersRes.data ?? [] };
    }
  );

  app.patch(
    '/admin/comments/:commentId',
    {
      schema: {
        summary: 'Edit or moderate a comment',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['commentId'],
          properties: { commentId: { type: 'string', format: 'uuid' } }
        },
        body: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 10 },
            status: { type: 'string', enum: ['pending', 'approved', 'denied', 'removed'] }
          }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'super_admin');
      const params = z.object({ commentId: z.string().uuid() }).parse(request.params);
      const body = updateCommentSchema.parse(request.body);
      const patch: Record<string, unknown> = {};
      if (body.content) patch.content = body.content;
      if (body.status) patch.status = body.status;
      if (!Object.keys(patch).length) throw new ApiError(422, 'VALIDATION_ERROR', 'No update fields provided');
      const updated = await supabaseAdmin.from('comments').update(patch).eq('id', params.commentId).select('id,status,content').single();
      if (updated.error || !updated.data) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'comment',
        target_id: params.commentId,
        action: 'comment_edit',
        metadata: patch
      });
      return { data: updated.data };
    }
  );

  app.patch(
    '/admin/ratings/:ratingId',
    {
      schema: {
        summary: 'Edit or moderate a rating',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['ratingId'],
          properties: { ratingId: { type: 'string', format: 'uuid' } }
        },
        body: {
          type: 'object',
          properties: {
            pricing_transparency: { type: 'number' },
            friendliness: { type: 'number' },
            lgbtq_acceptance: { type: 'number' },
            racial_tolerance: { type: 'number' },
            religious_tolerance: { type: 'number' },
            accessibility_friendliness: { type: 'number' },
            cleanliness: { type: 'number' },
            status: { type: 'string', enum: ['pending', 'approved', 'denied', 'removed'] }
          }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'super_admin');
      const params = z.object({ ratingId: z.string().uuid() }).parse(request.params);
      const body = updateRatingSchema.parse(request.body);
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) patch[key] = value;
      }
      if (!Object.keys(patch).length) throw new ApiError(422, 'VALIDATION_ERROR', 'No update fields provided');
      const updated = await supabaseAdmin.from('ratings').update(patch).eq('id', params.ratingId).select('id,status,overall_score').single();
      if (updated.error || !updated.data) throw new ApiError(404, 'NOT_FOUND', 'Rating not found');
      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'rating',
        target_id: params.ratingId,
        action: 'rating_edit',
        metadata: patch
      });
      return { data: updated.data };
    }
  );

  app.post(
    '/admin/businesses/:businessId/remove',
    {
      schema: {
        summary: 'Remove business from active directory',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['businessId'],
          properties: { businessId: { type: 'string', format: 'uuid' } }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'super_admin');
      const params = removeBusinessParamsSchema.parse(request.params);
      const update = await supabaseAdmin
        .from('businesses')
        .update({ status: 'suspended' })
        .eq('id', params.businessId)
        .select('id,status')
        .single();
      if (update.error || !update.data) throw new ApiError(404, 'NOT_FOUND', 'Business not found');
      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'business',
        target_id: params.businessId,
        action: 'business_remove'
      });
      return { data: update.data };
    }
  );

  app.post(
    '/admin/locations/:locationId/remove',
    {
      schema: {
        summary: 'Remove location from active directory',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['locationId'],
          properties: { locationId: { type: 'string', format: 'uuid' } }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'super_admin');
      const params = removeLocationParamsSchema.parse(request.params);
      const update = await supabaseAdmin
        .from('business_locations')
        .update({ status: 'suspended' })
        .eq('id', params.locationId)
        .select('id,status')
        .single();
      if (update.error || !update.data) throw new ApiError(404, 'NOT_FOUND', 'Location not found');
      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'business',
        target_id: params.locationId,
        action: 'location_remove'
      });
      return { data: update.data };
    }
  );

  app.post(
    '/admin/media/remove',
    {
      schema: {
        summary: 'Remove image from storage',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['bucket', 'object_path'],
          properties: {
            bucket: { type: 'string', enum: [BUSINESS_MEDIA_BUCKET, REVIEW_MEDIA_BUCKET] },
            object_path: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      const { actor } = await requireAdminTier(request, 'super_admin');
      const body = mediaRemoveSchema.parse(request.body);
      const remove = await supabaseAdmin.storage.from(body.bucket).remove([body.object_path]);
      if (remove.error) throw new ApiError(422, 'VALIDATION_ERROR', remove.error.message);
      await supabaseAdmin.from('moderation_actions').insert({
        actor_user_id: actor.id,
        target_type: 'business',
        target_id: actor.id,
        action: 'media_remove',
        metadata: { bucket: body.bucket, object_path: body.object_path }
      });
      return { data: { removed: true } };
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
