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
const assertBusinessOwner = async (userId, businessId) => {
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
export const businessRoutes = async (app) => {
    app.post('/businesses', async (request) => {
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
            const assignmentRes = await supabaseAdmin.from('business_category_assignments').insert(body.category_ids.map((categoryId) => ({ business_id: created.data.id, category_id: categoryId })));
            if (assignmentRes.error) {
                throw new ApiError(422, 'VALIDATION_ERROR', assignmentRes.error.message);
            }
        }
        return { data: created.data };
    });
    app.post('/businesses/:businessId/locations', async (request) => {
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
    });
    app.post('/comments/:commentId/business-reply', async (request) => {
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
            .upsert({
            comment_id: params.commentId,
            business_id: locationRes.data.business_id,
            author_user_id: user.id,
            content: body.content,
            status: 'approved'
        }, { onConflict: 'comment_id,business_id' })
            .select('id,status')
            .single();
        if (created.error || !created.data) {
            throw new ApiError(422, 'VALIDATION_ERROR', created.error?.message ?? 'Unable to save reply');
        }
        return { data: { reply_id: created.data.id, status: created.data.status } };
    });
    app.post('/appeals', async (request) => {
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
    });
    app.get('/businesses/:businessId/appeals', async (request) => {
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
    });
};
