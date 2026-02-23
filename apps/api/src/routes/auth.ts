import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAnon, supabaseAdmin } from '../lib/supabase.js';
import { getCurrentPoliciesVersion } from '../lib/auth.js';

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  country_of_origin: z.string().min(1),
  age: z.number().int().min(18).max(120),
  screen_name: z.string().min(1).max(80).optional(),
  profile_image_url: z.string().url().optional()
});

const VerifyEmailSchema = z.object({
  token_hash: z.string().min(1)
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const ResetRequestSchema = z.object({
  email: z.string().email()
});

const ResetConfirmSchema = z.object({
  access_token: z.string().min(1),
  new_password: z.string().min(8)
});

const signupBodyJsonSchema = {
  type: 'object',
  required: ['email', 'password', 'first_name', 'last_name', 'country_of_origin', 'age'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    first_name: { type: 'string', minLength: 1 },
    last_name: { type: 'string', minLength: 1 },
    country_of_origin: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 18, maximum: 120 },
    screen_name: { type: 'string', minLength: 1, maxLength: 80 },
    profile_image_url: { type: 'string', format: 'uri' }
  }
} as const;

const loginBodyJsonSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 }
  }
} as const;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/auth/signup',
    {
      schema: {
        summary: 'Create account',
        tags: ['Auth'],
        body: signupBodyJsonSchema
      }
    },
    async (request) => {
    const body = SignupSchema.parse(request.body);

    const signup = await supabaseAnon.auth.signUp({
      email: body.email,
      password: body.password
    });

    if (signup.error || !signup.data.user) {
      throw new ApiError(422, 'VALIDATION_ERROR', signup.error?.message ?? 'Signup failed');
    }

    const userId = signup.data.user.id;

    const upsertUser = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: userId,
          email: body.email,
          role: 'consumer',
          status: 'active',
          language_preference: 'en'
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single();

    if (upsertUser.error) {
      throw new ApiError(500, 'INTERNAL_ERROR', upsertUser.error.message);
    }

    const profile = await supabaseAdmin
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          first_name: body.first_name,
          last_name: body.last_name,
          screen_name: body.screen_name ?? null,
          country_of_origin: body.country_of_origin,
          age: body.age,
          profile_image_url: body.profile_image_url ?? null
        },
        { onConflict: 'user_id' }
      );

    if (profile.error) {
      throw new ApiError(500, 'INTERNAL_ERROR', profile.error.message);
    }

    return {
      data: {
        user_id: userId,
        email_verification_required: true
      }
    };
    }
  );

  app.post(
    '/auth/verify-email',
    {
      schema: {
        summary: 'Verify email token',
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['token_hash'],
          properties: {
            token_hash: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request) => {
    const body = VerifyEmailSchema.parse(request.body);

    const verify = await supabaseAnon.auth.verifyOtp({
      token_hash: body.token_hash,
      type: 'email'
    });

    if (verify.error || !verify.data.user) {
      throw new ApiError(401, 'UNAUTHORIZED', verify.error?.message ?? 'Invalid verification token');
    }

    await supabaseAdmin
      .from('users')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', verify.data.user.id);

    return { data: { verified: true } };
    }
  );

  app.post(
    '/auth/login',
    {
      schema: {
        summary: 'Login',
        tags: ['Auth'],
        body: loginBodyJsonSchema
      }
    },
    async (request) => {
    const body = LoginSchema.parse(request.body);

    const login = await supabaseAnon.auth.signInWithPassword({
      email: body.email,
      password: body.password
    });

    if (login.error || !login.data.user || !login.data.session) {
      throw new ApiError(401, 'UNAUTHORIZED', login.error?.message ?? 'Login failed');
    }

    const currentVersion = await getCurrentPoliciesVersion();
    const { data: acceptance } = await supabaseAdmin
      .from('policies_acceptance')
      .select('policies_version,accepted_at')
      .eq('user_id', login.data.user.id)
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let { data: dbUser } = await supabaseAdmin
      .from('users')
      .select('id,role,language_preference')
      .eq('id', login.data.user.id)
      .single();

    if (!dbUser) {
      const bootstrapUser = await supabaseAdmin
        .from('users')
        .upsert(
          {
            id: login.data.user.id,
            email: login.data.user.email ?? body.email,
            role: 'consumer',
            status: 'active',
            language_preference: 'en',
            email_verified_at: new Date().toISOString()
          },
          { onConflict: 'id' }
        )
        .select('id,role,language_preference')
        .single();

      if (bootstrapUser.error || !bootstrapUser.data) {
        throw new ApiError(500, 'INTERNAL_ERROR', bootstrapUser.error?.message ?? 'Unable to create local user profile');
      }

      dbUser = bootstrapUser.data;
    }

    return {
      data: {
        access_token: login.data.session.access_token,
        refresh_token: login.data.session.refresh_token,
        user: {
          id: login.data.user.id,
          role: dbUser?.role ?? 'consumer',
          language_preference: dbUser?.language_preference ?? 'en',
          policies: {
            current_version: currentVersion,
            accepted_version: acceptance?.policies_version ?? null,
            accepted: acceptance?.policies_version === currentVersion
          }
        }
      }
    };
    }
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        summary: 'Logout',
        tags: ['Auth']
      }
    },
    async () => ({ data: { ok: true } })
  );

  app.post(
    '/auth/password-reset/request',
    {
      schema: {
        summary: 'Request password reset',
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' }
          }
        }
      }
    },
    async (request) => {
    const body = ResetRequestSchema.parse(request.body);

    const reset = await supabaseAnon.auth.resetPasswordForEmail(body.email);
    if (reset.error) {
      throw new ApiError(422, 'VALIDATION_ERROR', reset.error.message);
    }

    return { data: { sent: true } };
    }
  );

  app.post(
    '/auth/password-reset/confirm',
    {
      schema: {
        summary: 'Confirm password reset',
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['access_token', 'new_password'],
          properties: {
            access_token: { type: 'string', minLength: 1 },
            new_password: { type: 'string', minLength: 8 }
          }
        }
      }
    },
    async (request) => {
    const body = ResetConfirmSchema.parse(request.body);

    const userRes = await supabaseAdmin.auth.getUser(body.access_token);
    if (userRes.error || !userRes.data.user) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid access token');
    }

    const update = await supabaseAdmin.auth.admin.updateUserById(userRes.data.user.id, {
      password: body.new_password
    });

    if (update.error) {
      throw new ApiError(422, 'VALIDATION_ERROR', update.error.message);
    }

    return { data: { updated: true } };
    }
  );
};
