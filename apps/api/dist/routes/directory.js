import { z } from 'zod';
import { ApiError } from '../lib/http-errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
const listBusinessesQuerySchema = z.object({
    q: z.string().optional(),
    category: z.string().uuid().optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    sort: z.enum(['top_rated', 'most_reviewed', 'newest', 'name']).default('top_rated'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20)
});
const buildRatingDistribution = (scores) => {
    const bins = new Map();
    for (let i = 0; i <= 10; i += 1) {
        bins.set(i / 2, 0);
    }
    for (const score of scores) {
        const rounded = Math.round(score * 2) / 2;
        bins.set(rounded, (bins.get(rounded) ?? 0) + 1);
    }
    return Array.from(bins.entries()).map(([score, count]) => ({ score, count }));
};
export const directoryRoutes = async (app) => {
    app.get('/categories', async () => {
        const categories = await supabaseAdmin
            .from('categories')
            .select('id,slug,label_i18n_key')
            .eq('is_active', true)
            .order('slug', { ascending: true });
        if (categories.error) {
            throw new ApiError(500, 'INTERNAL_ERROR', categories.error.message);
        }
        return { data: categories.data ?? [] };
    });
    app.get('/businesses', async (request) => {
        const query = listBusinessesQuerySchema.parse(request.query);
        const from = (query.page - 1) * query.page_size;
        const to = from + query.page_size - 1;
        let q = supabaseAdmin
            .from('businesses')
            .select('id,name,created_at,status', { count: 'exact' })
            .eq('status', 'active');
        if (query.q)
            q = q.ilike('name', `%${query.q}%`);
        if (query.category) {
            const businessIdsRes = await supabaseAdmin
                .from('business_category_assignments')
                .select('business_id')
                .eq('category_id', query.category);
            const businessIds = (businessIdsRes.data ?? []).map((row) => row.business_id);
            if (businessIds.length === 0) {
                return { data: { items: [], page: query.page, page_size: query.page_size, total: 0 } };
            }
            q = q.in('id', businessIds);
        }
        if (query.sort === 'name')
            q = q.order('name', { ascending: true });
        if (query.sort === 'newest')
            q = q.order('created_at', { ascending: false });
        const res = await q.range(from, to);
        if (res.error)
            throw new ApiError(500, 'INTERNAL_ERROR', res.error.message);
        const businessIds = (res.data ?? []).map((b) => b.id);
        const [scoreRes, categoryRes, locationRes] = await Promise.all([
            businessIds.length
                ? supabaseAdmin
                    .from('business_score_summary')
                    .select('business_id,business_rating_count,weighted_overall_raw,weighted_overall_display,unweighted_overall_raw,unweighted_overall_display')
                    .in('business_id', businessIds)
                : Promise.resolve({ data: [], error: null }),
            businessIds.length
                ? supabaseAdmin
                    .from('business_category_assignments')
                    .select('business_id,categories(slug)')
                    .in('business_id', businessIds)
                : Promise.resolve({ data: [], error: null }),
            businessIds.length
                ? supabaseAdmin.from('business_locations').select('id,business_id,country,region,city,status').in('business_id', businessIds)
                : Promise.resolve({ data: [], error: null })
        ]);
        if (scoreRes.error || categoryRes.error || locationRes.error) {
            throw new ApiError(500, 'INTERNAL_ERROR', scoreRes.error?.message ?? categoryRes.error?.message ?? locationRes.error?.message ?? 'Lookup failed');
        }
        const locationByBusiness = new Map();
        for (const row of locationRes.data ?? []) {
            if (row.status !== 'active')
                continue;
            const current = locationByBusiness.get(row.business_id) ?? [];
            current.push({ country: row.country, region: row.region, city: row.city });
            locationByBusiness.set(row.business_id, current);
        }
        const scoresByBusiness = new Map((scoreRes.data ?? []).map((s) => [s.business_id, s]));
        const categoriesByBusiness = new Map();
        for (const row of categoryRes.data ?? []) {
            const slug = Array.isArray(row.categories)
                ? undefined
                : row.categories?.slug;
            if (!slug)
                continue;
            const current = categoriesByBusiness.get(row.business_id) ?? [];
            current.push(slug);
            categoriesByBusiness.set(row.business_id, current);
        }
        const filteredItems = (res.data ?? []).filter((business) => {
            const locations = locationByBusiness.get(business.id) ?? [];
            if (query.country && !locations.some((loc) => loc.country === query.country))
                return false;
            if (query.region && !locations.some((loc) => loc.region === query.region))
                return false;
            if (query.city && !locations.some((loc) => loc.city === query.city))
                return false;
            return true;
        });
        const items = filteredItems.map((business) => {
            const score = scoresByBusiness.get(business.id);
            return {
                id: business.id,
                name: business.name,
                categories: categoriesByBusiness.get(business.id) ?? [],
                locations_count: (locationByBusiness.get(business.id) ?? []).length,
                scores: {
                    weighted_overall_display: score?.weighted_overall_display ?? null,
                    weighted_overall_raw: score?.weighted_overall_raw ?? null,
                    unweighted_overall_display: score?.unweighted_overall_display ?? null,
                    unweighted_overall_raw: score?.unweighted_overall_raw ?? null,
                    business_rating_count: score?.business_rating_count ?? 0
                }
            };
        });
        if (query.sort === 'top_rated') {
            items.sort((a, b) => (b.scores.weighted_overall_raw ?? 0) - (a.scores.weighted_overall_raw ?? 0));
        }
        if (query.sort === 'most_reviewed') {
            items.sort((a, b) => b.scores.business_rating_count - a.scores.business_rating_count);
        }
        return {
            data: {
                items,
                page: query.page,
                page_size: query.page_size,
                total: res.count ?? items.length
            }
        };
    });
    app.get('/businesses/:businessId', async (request) => {
        const params = z.object({ businessId: z.string().uuid() }).parse(request.params);
        const [businessRes, locationRes, scoreRes, categoryRes] = await Promise.all([
            supabaseAdmin.from('businesses').select('*').eq('id', params.businessId).eq('status', 'active').single(),
            supabaseAdmin
                .from('business_locations')
                .select('*')
                .eq('business_id', params.businessId)
                .eq('status', 'active')
                .order('city', { ascending: true }),
            supabaseAdmin.from('business_score_summary').select('*').eq('business_id', params.businessId).maybeSingle(),
            supabaseAdmin
                .from('business_category_assignments')
                .select('categories(slug,label_i18n_key)')
                .eq('business_id', params.businessId)
        ]);
        if (businessRes.error || !businessRes.data) {
            throw new ApiError(404, 'NOT_FOUND', 'Business not found');
        }
        if (locationRes.error || scoreRes.error || categoryRes.error) {
            throw new ApiError(500, 'INTERNAL_ERROR', locationRes.error?.message ?? scoreRes.error?.message ?? categoryRes.error?.message ?? 'Lookup failed');
        }
        return {
            data: {
                ...businessRes.data,
                categories: categoryRes.data ?? [],
                scores: scoreRes.data ?? null,
                locations: locationRes.data ?? []
            }
        };
    });
    app.get('/locations/:locationId', async (request) => {
        const params = z.object({ locationId: z.string().uuid() }).parse(request.params);
        const query = z
            .object({
            page: z.coerce.number().int().min(1).default(1),
            page_size: z.coerce.number().int().min(1).max(50).default(10)
        })
            .parse(request.query);
        const from = (query.page - 1) * query.page_size;
        const to = from + query.page_size - 1;
        const [locationRes, scoreRes, ratingsRes, commentsRes] = await Promise.all([
            supabaseAdmin.from('business_locations').select('*').eq('id', params.locationId).eq('status', 'active').single(),
            supabaseAdmin.from('location_score_summary').select('*').eq('location_id', params.locationId).maybeSingle(),
            supabaseAdmin
                .from('ratings')
                .select('overall_score')
                .eq('location_id', params.locationId)
                .eq('status', 'approved'),
            supabaseAdmin
                .from('comments')
                .select('id,rating_id,user_id,content,visit_month,visit_year,created_at,status', { count: 'exact' })
                .eq('location_id', params.locationId)
                .eq('status', 'approved')
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .range(from, to)
        ]);
        if (locationRes.error || !locationRes.data) {
            throw new ApiError(404, 'NOT_FOUND', 'Location not found');
        }
        if (scoreRes.error || ratingsRes.error || commentsRes.error) {
            throw new ApiError(500, 'INTERNAL_ERROR', scoreRes.error?.message ?? ratingsRes.error?.message ?? commentsRes.error?.message ?? 'Lookup failed');
        }
        const commentIds = (commentsRes.data ?? []).map((c) => c.id);
        const repliesRes = commentIds.length
            ? await supabaseAdmin
                .from('business_replies')
                .select('id,comment_id,business_id,content,created_at,status')
                .in('comment_id', commentIds)
                .eq('status', 'approved')
                .is('deleted_at', null)
            : { data: [], error: null };
        if (repliesRes.error) {
            throw new ApiError(500, 'INTERNAL_ERROR', repliesRes.error.message);
        }
        const repliesByComment = new Map();
        for (const reply of repliesRes.data ?? []) {
            const current = repliesByComment.get(reply.comment_id) ?? [];
            current.push(reply);
            repliesByComment.set(reply.comment_id, current);
        }
        const ratingDistribution = buildRatingDistribution((ratingsRes.data ?? []).map((row) => Number(row.overall_score)));
        return {
            data: {
                location: locationRes.data,
                scores: scoreRes.data,
                rating_distribution: ratingDistribution,
                comments: (commentsRes.data ?? []).map((comment) => ({
                    ...comment,
                    business_replies: repliesByComment.get(comment.id) ?? []
                })),
                page: query.page,
                page_size: query.page_size,
                total_comments: commentsRes.count ?? 0
            }
        };
    });
};
