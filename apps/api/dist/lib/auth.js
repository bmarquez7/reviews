import { ApiError } from './http-errors.js';
import { supabaseAdmin } from './supabase.js';
const parseBearer = (header) => {
    if (!header) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Missing authorization header');
    }
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid authorization header');
    }
    return token;
};
export const resolveAuthUser = async (request) => {
    const token = parseBearer(request.headers.authorization);
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    const userId = authData.user.id;
    const { data: dbUser, error: dbUserError } = await supabaseAdmin
        .from('users')
        .select('id,email,role,status')
        .eq('id', userId)
        .single();
    if (dbUserError || !dbUser) {
        throw new ApiError(401, 'UNAUTHORIZED', 'User profile not found');
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
        role: dbUser.role,
        isSuspended: dbUser.status === 'suspended',
        policiesAcceptedVersion: acceptance?.policies_version ?? null
    };
    return request.authUser;
};
export const requireAuth = async (request) => {
    const user = request.authUser ?? (await resolveAuthUser(request));
    if (user.isSuspended) {
        throw new ApiError(403, 'FORBIDDEN', 'Account is suspended');
    }
    return user;
};
export const requireRole = async (request, allowedRoles) => {
    const user = await requireAuth(request);
    if (!allowedRoles.includes(user.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Insufficient role');
    }
    return user;
};
export const getCurrentPoliciesVersion = async () => {
    const { data } = await supabaseAdmin
        .from('platform_config')
        .select('current_policies_version')
        .eq('id', true)
        .single();
    return data?.current_policies_version ?? '2026-02-17';
};
export const requirePoliciesAccepted = async (request) => {
    const user = await requireAuth(request);
    const currentVersion = await getCurrentPoliciesVersion();
    if (user.policiesAcceptedVersion !== currentVersion) {
        throw new ApiError(403, 'POLICIES_NOT_ACCEPTED', 'Policies acceptance required', {
            current_policies_version: currentVersion,
            accepted_version: user.policiesAcceptedVersion
        });
    }
    return user;
};
