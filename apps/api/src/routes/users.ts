import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, getCurrentPoliciesVersion } from '../lib/auth.js';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAdmin } from '../lib/supabase.js';

const LanguageSchema = z.object({
  language: z.string().min(2).max(10)
});

const PoliciesAcceptSchema = z.object({
  policies_version: z.string().min(1),
  accepted_via: z.enum(['signup', 'pre_post', 'business_onboarding', 'reaccept']),
  checkboxes: z.object({
    firsthand_only: z.literal(true),
    professional_no_hate: z.literal(true),
    moderation_understood: z.literal(true)
  })
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/users/me',
    {
      schema: {
        summary: 'Get current user profile',
        tags: ['Users'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
    const user = await requireAuth(request);

    const [dbUserRes, profileRes] = await Promise.all([
      supabaseAdmin.from('users').select('id,email,role,status,language_preference').eq('id', user.id).single(),
      supabaseAdmin
        .from('user_profiles')
        .select('screen_name,country_of_origin,age_public,age_range_public,profile_image_url')
        .eq('user_id', user.id)
        .single()
    ]);

    if (dbUserRes.error || !dbUserRes.data) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    return {
      data: {
        ...dbUserRes.data,
        profile: profileRes.data ?? null
      }
    };
    }
  );

  app.put(
    '/users/me/language',
    {
      schema: {
        summary: 'Set user language preference',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['language'],
          properties: {
            language: { type: 'string', minLength: 2, maxLength: 10 }
          }
        }
      }
    },
    async (request) => {
    const user = await requireAuth(request);
    const body = LanguageSchema.parse(request.body);

    const update = await supabaseAdmin
      .from('users')
      .update({ language_preference: body.language })
      .eq('id', user.id)
      .select('language_preference')
      .single();

    if (update.error || !update.data) {
      throw new ApiError(422, 'VALIDATION_ERROR', update.error?.message ?? 'Unable to set language');
    }

    return { data: update.data };
    }
  );

  app.post(
    '/users/me/policies/accept',
    {
      schema: {
        summary: 'Accept policies',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['policies_version', 'accepted_via', 'checkboxes'],
          properties: {
            policies_version: { type: 'string', minLength: 1 },
            accepted_via: { type: 'string', enum: ['signup', 'pre_post', 'business_onboarding', 'reaccept'] },
            checkboxes: {
              type: 'object',
              required: ['firsthand_only', 'professional_no_hate', 'moderation_understood'],
              properties: {
                firsthand_only: { type: 'boolean', const: true },
                professional_no_hate: { type: 'boolean', const: true },
                moderation_understood: { type: 'boolean', const: true }
              }
            }
          }
        }
      }
    },
    async (request) => {
    const user = await requireAuth(request);
    const body = PoliciesAcceptSchema.parse(request.body);

    const currentVersion = await getCurrentPoliciesVersion();
    if (body.policies_version !== currentVersion) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Stale policies_version', {
        current_policies_version: currentVersion
      });
    }

    const acceptedAt = new Date().toISOString();
    const upsert = await supabaseAdmin
      .from('policies_acceptance')
      .upsert(
        {
          user_id: user.id,
          policies_version: body.policies_version,
          accepted_at: acceptedAt,
          accepted_via: body.accepted_via
        },
        { onConflict: 'user_id,policies_version' }
      )
      .select('policies_version,accepted_at')
      .single();

    if (upsert.error || !upsert.data) {
      throw new ApiError(500, 'INTERNAL_ERROR', upsert.error?.message ?? 'Unable to save acceptance');
    }

    return {
      data: {
        accepted: true,
        policies_version: upsert.data.policies_version,
        policies_accepted_at: upsert.data.accepted_at
      }
    };
    }
  );
};
