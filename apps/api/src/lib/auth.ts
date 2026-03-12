import type { FastifyRequest } from 'fastify';
import { ApiError } from './http-errors.js';
import { supabaseAdmin } from './supabase.js';

type AppRole = 'consumer' | 'business_owner' | 'moderator' | 'admin';

const resolveConfirmedAt = (user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}) => user.email_confirmed_at ?? user.confirmed_at ?? null;

const parseBearer = (header?: string): string => {
  if (!header) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing authorization header');
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid authorization header');
  }

  return token;
};

export const resolveAuthUser = async (request: FastifyRequest) => {
  const token = parseBearer(request.headers.authorization);

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }

  const userId = authData.user.id;
  const authConfirmedAt = resolveConfirmedAt(authData.user);
  const { data: dbUser, error: dbUserError } = await supabaseAdmin
    .from('users')
    .select('id,email,role,status,email_verified_at')
    .eq('id', userId)
    .single();

  if (dbUserError || !dbUser) {
    throw new ApiError(401, 'UNAUTHORIZED', 'User profile not found');
  }

  const emailVerifiedAt = dbUser.email_verified_at ?? authConfirmedAt;
  if (!dbUser.email_verified_at && authConfirmedAt) {
    await supabaseAdmin
      .from('users')
      .update({ email_verified_at: authConfirmedAt })
      .eq('id', userId);
  }

  const { data: acceptance } = await supabaseAdmin
    .from('policies_acceptance')
    .select('policies_version,accepted_at')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  request.authUser = {
    id: dbUser.id,
    email: dbUser.email ?? undefined,
    role: dbUser.role as AppRole,
    isSuspended: dbUser.status === 'suspended',
    emailVerifiedAt,
    policiesAcceptedVersion: acceptance?.policies_version ?? null
  };

  return request.authUser;
};

export const requireAuth = async (request: FastifyRequest) => {
  const user = request.authUser ?? (await resolveAuthUser(request));

  if (user.isSuspended) {
    throw new ApiError(403, 'FORBIDDEN', 'Account is suspended');
  }

  return user;
};

export const requireRole = async (request: FastifyRequest, allowedRoles: AppRole[]) => {
  const user = await requireAuth(request);
  if (!allowedRoles.includes(user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Insufficient role');
  }

  return user;
};

export const requireVerifiedUser = async (request: FastifyRequest) => {
  const user = await requireAuth(request);
  if (!user.emailVerifiedAt && !['moderator', 'admin'].includes(user.role)) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before posting or managing content');
  }
  return user;
};

export const requireVerifiedRole = async (request: FastifyRequest, allowedRoles: AppRole[]) => {
  const user = await requireRole(request, allowedRoles);
  if (!user.emailVerifiedAt && !['moderator', 'admin'].includes(user.role)) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before posting or managing content');
  }
  return user;
};

export const getCurrentPoliciesVersion = async (): Promise<string> => {
  const { data } = await supabaseAdmin
    .from('platform_config')
    .select('current_policies_version')
    .eq('id', true)
    .single();

  return data?.current_policies_version ?? '2026-02-17';
};

export const requirePoliciesAccepted = async (request: FastifyRequest) => {
  const user = await requireVerifiedUser(request);
  const currentVersion = await getCurrentPoliciesVersion();

  if (user.policiesAcceptedVersion !== currentVersion) {
    throw new ApiError(403, 'POLICIES_NOT_ACCEPTED', 'Policies acceptance required', {
      current_policies_version: currentVersion,
      accepted_version: user.policiesAcceptedVersion
    });
  }

  return user;
};
