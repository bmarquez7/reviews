-- Directory + Ratings App schema (PostgreSQL / Supabase compatible)

create extension if not exists pgcrypto;
create extension if not exists citext;

-- =========================
-- Enums
-- =========================

create type public.user_role as enum (
  'consumer',
  'business_owner',
  'moderator',
  'admin'
);

create type public.account_status as enum (
  'active',
  'suspended'
);

create type public.content_status as enum (
  'pending',
  'approved',
  'denied',
  'removed'
);

create type public.business_status as enum (
  'active',
  'suspended'
);

create type public.appeal_target_type as enum (
  'business',
  'location'
);

create type public.appeal_status as enum (
  'submitted',
  'under_review',
  'resolved',
  'rejected'
);

create type public.flag_target_type as enum (
  'rating',
  'comment',
  'business_reply'
);

create type public.moderation_target_type as enum (
  'rating',
  'comment',
  'business_reply',
  'user',
  'business',
  'appeal'
);

-- =========================
-- Helpers
-- =========================

create or replace function public.is_half_step(v numeric)
returns boolean
language sql
immutable
as $$
  select v between 0 and 5 and mod((v * 10)::int, 5) = 0;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Core user/account tables
-- =========================

-- For Supabase, you can map users.id to auth.users.id via trigger.
create table if not exists public.users (
  id uuid primary key,
  email citext not null unique,
  email_verified_at timestamptz,
  role public.user_role not null default 'consumer',
  status public.account_status not null default 'active',
  language_preference text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_language_len check (char_length(language_preference) between 2 and 10)
);

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  screen_name text,
  country_of_origin text not null,
  age smallint not null check (age >= 18 and age <= 120),
  age_public boolean not null default false,
  age_range_public text generated always as (
    case
      when age between 18 and 24 then '18-24'
      when age between 25 and 34 then '25-34'
      when age between 35 and 44 then '35-44'
      when age between 45 and 54 then '45-54'
      when age between 55 and 64 then '55-64'
      else '65+'
    end
  ) stored,
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_config (
  id boolean primary key default true,
  current_policies_version text not null,
  comments_premoderation boolean not null default false,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  constraint single_row check (id)
);

insert into public.platform_config (id, current_policies_version)
values (true, '2026-02-17')
on conflict (id) do nothing;

create table if not exists public.policies_acceptance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  policies_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_via text not null check (accepted_via in ('signup', 'pre_post', 'business_onboarding', 'reaccept')),
  ip inet,
  user_agent text,
  constraint policies_acceptance_unique unique (user_id, policies_version)
);

-- =========================
-- Directory tables
-- =========================

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label_i18n_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id),
  name text not null,
  owner_name text not null,
  description text,
  mission_statement text,
  primary_phone text,
  primary_email citext,
  website_url text,
  social_facebook text,
  social_instagram text,
  social_tiktok text,
  social_linkedin text,
  social_youtube text,
  social_other text,
  founded_year smallint,
  status public.business_status not null default 'active',
  is_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_founded_year check (founded_year is null or founded_year between 1800 and extract(year from now())::smallint)
);

create table if not exists public.business_category_assignments (
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (business_id, category_id)
);

create table if not exists public.business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_name text,
  address_line text not null,
  city text not null,
  region text,
  country text not null,
  postal_code text,
  location_phone text,
  location_email citext,
  location_hours jsonb,
  opened_year smallint,
  latitude numeric(9,6),
  longitude numeric(9,6),
  status public.business_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_opened_year check (opened_year is null or opened_year between 1800 and extract(year from now())::smallint)
);

-- =========================
-- Ratings + comments
-- =========================

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,

  pricing_transparency numeric(2,1) not null,
  friendliness numeric(2,1) not null,
  lgbtq_acceptance numeric(2,1) not null,
  racial_tolerance numeric(2,1) not null,
  religious_tolerance numeric(2,1) not null,
  accessibility_friendliness numeric(2,1) not null,
  cleanliness numeric(2,1) not null,

  overall_score numeric(3,2) generated always as (
    (
      pricing_transparency + friendliness + lgbtq_acceptance + racial_tolerance +
      religious_tolerance + accessibility_friendliness + cleanliness
    ) / 7.0
  ) stored,

  status public.content_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint one_rating_per_user_location unique (user_id, location_id),
  constraint rating_pricing_transparency_half check (public.is_half_step(pricing_transparency)),
  constraint rating_friendliness_half check (public.is_half_step(friendliness)),
  constraint rating_lgbtq_half check (public.is_half_step(lgbtq_acceptance)),
  constraint rating_racial_half check (public.is_half_step(racial_tolerance)),
  constraint rating_religious_half check (public.is_half_step(religious_tolerance)),
  constraint rating_accessibility_half check (public.is_half_step(accessibility_friendliness)),
  constraint rating_cleanliness_half check (public.is_half_step(cleanliness))
);

create table if not exists public.secondary_ratings (
  rating_id uuid primary key references public.ratings(id) on delete cascade,
  pricing_value numeric(2,1),
  child_care_availability numeric(2,1),
  child_friendliness numeric(2,1),
  party_size_accommodations numeric(2,1),
  accessibility_details_score numeric(2,1),
  accessibility_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secondary_pricing_value_half check (pricing_value is null or public.is_half_step(pricing_value)),
  constraint secondary_child_care_half check (child_care_availability is null or public.is_half_step(child_care_availability)),
  constraint secondary_child_friend_half check (child_friendliness is null or public.is_half_step(child_friendliness)),
  constraint secondary_party_size_half check (party_size_accommodations is null or public.is_half_step(party_size_accommodations)),
  constraint secondary_accessibility_half check (accessibility_details_score is null or public.is_half_step(accessibility_details_score))
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null unique references public.ratings(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  content text not null,
  visit_month smallint,
  visit_year smallint,
  status public.content_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comments_visit_month check (visit_month is null or visit_month between 1 and 12),
  constraint comments_visit_year check (visit_year is null or visit_year between 1900 and extract(year from now())::smallint)
  -- NOTE: minimum 10 words is enforced at API/app layer.
);

create table if not exists public.business_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  status public.content_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint one_reply_per_business_per_comment unique (comment_id, business_id)
);

-- =========================
-- Moderation + flags + audit
-- =========================

create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  target_type public.flag_target_type not null,
  target_id uuid not null,
  reporter_user_id uuid references public.users(id) on delete set null,
  reason text not null,
  details text,
  is_resolved boolean not null default false,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id),
  target_type public.moderation_target_type not null,
  target_id uuid not null,
  action text not null,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- Appeals
-- =========================

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  target_type public.appeal_target_type not null,
  target_business_id uuid references public.businesses(id) on delete cascade,
  target_location_id uuid references public.business_locations(id) on delete cascade,
  submitted_by uuid not null references public.users(id),
  reason text not null,
  details text not null,
  status public.appeal_status not null default 'submitted',
  admin_decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint appeals_target_consistency check (
    (target_type = 'business' and target_business_id is not null and target_location_id is null)
    or
    (target_type = 'location' and target_location_id is not null)
  )
);

-- One open appeal per location at a time (submitted/under_review)
create unique index if not exists appeals_one_open_per_location
on public.appeals (target_location_id)
where target_location_id is not null and status in ('submitted', 'under_review');

create table if not exists public.appeal_messages (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeals(id) on delete cascade,
  author_user_id uuid not null references public.users(id),
  message text not null,
  is_admin_note boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================
-- Indexes
-- =========================

create index if not exists users_role_status_idx on public.users(role, status);
create index if not exists user_profiles_country_idx on public.user_profiles(country_of_origin);

create index if not exists businesses_owner_idx on public.businesses(owner_user_id);
create index if not exists businesses_status_idx on public.businesses(status);
create index if not exists businesses_name_idx on public.businesses(name);

create index if not exists locations_business_idx on public.business_locations(business_id);
create index if not exists locations_geo_filter_idx on public.business_locations(country, region, city);
create index if not exists locations_status_idx on public.business_locations(status);

create index if not exists ratings_location_status_idx on public.ratings(location_id, status);
create index if not exists ratings_user_idx on public.ratings(user_id);
create index if not exists ratings_created_idx on public.ratings(created_at desc);

create index if not exists comments_location_status_idx on public.comments(location_id, status);
create index if not exists comments_user_idx on public.comments(user_id);
create index if not exists comments_created_idx on public.comments(created_at desc);

create index if not exists replies_comment_status_idx on public.business_replies(comment_id, status);

create index if not exists flags_target_idx on public.flags(target_type, target_id, is_resolved);
create index if not exists moderation_target_idx on public.moderation_actions(target_type, target_id);
create index if not exists moderation_actor_idx on public.moderation_actions(actor_user_id, created_at desc);
create index if not exists appeals_business_status_idx on public.appeals(business_id, status);
create index if not exists appeals_target_business_status_idx on public.appeals(target_business_id, status);

-- =========================
-- Triggers
-- =========================

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger set_businesses_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

create trigger set_locations_updated_at
before update on public.business_locations
for each row execute function public.set_updated_at();

create trigger set_ratings_updated_at
before update on public.ratings
for each row execute function public.set_updated_at();

create trigger set_secondary_ratings_updated_at
before update on public.secondary_ratings
for each row execute function public.set_updated_at();

create trigger set_comments_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

create trigger set_replies_updated_at
before update on public.business_replies
for each row execute function public.set_updated_at();

create trigger set_appeals_updated_at
before update on public.appeals
for each row execute function public.set_updated_at();

-- =========================
-- Score views
-- =========================

-- Location aggregates
create or replace view public.location_score_summary as
select
  l.id as location_id,
  count(r.id) filter (where r.status = 'approved') as rating_count,
  avg(r.overall_score) filter (where r.status = 'approved') as overall_score_raw,
  round((avg(r.overall_score) filter (where r.status = 'approved')) * 2) / 2 as overall_score_display,
  avg(r.pricing_transparency) filter (where r.status = 'approved') as pricing_transparency_avg,
  avg(r.friendliness) filter (where r.status = 'approved') as friendliness_avg,
  avg(r.lgbtq_acceptance) filter (where r.status = 'approved') as lgbtq_acceptance_avg,
  avg(r.racial_tolerance) filter (where r.status = 'approved') as racial_tolerance_avg,
  avg(r.religious_tolerance) filter (where r.status = 'approved') as religious_tolerance_avg,
  avg(r.accessibility_friendliness) filter (where r.status = 'approved') as accessibility_friendliness_avg,
  avg(r.cleanliness) filter (where r.status = 'approved') as cleanliness_avg
from public.business_locations l
left join public.ratings r on r.location_id = l.id
group by l.id;

-- Business aggregates (weighted + unweighted)
create or replace view public.business_score_summary as
with ls as (
  select
    l.business_id,
    l.id as location_id,
    coalesce(count(r.id) filter (where r.status = 'approved'), 0) as rating_count,
    avg(r.overall_score) filter (where r.status = 'approved') as location_overall
  from public.business_locations l
  left join public.ratings r on r.location_id = l.id
  group by l.business_id, l.id
)
select
  business_id,
  sum(rating_count) as business_rating_count,
  case
    when sum(rating_count) = 0 then null
    else sum(coalesce(location_overall, 0) * rating_count) / sum(rating_count)
  end as weighted_overall_raw,
  case
    when sum(rating_count) = 0 then null
    else round((sum(coalesce(location_overall, 0) * rating_count) / sum(rating_count)) * 2) / 2
  end as weighted_overall_display,
  avg(location_overall) filter (where location_overall is not null) as unweighted_overall_raw,
  round((avg(location_overall) filter (where location_overall is not null)) * 2) / 2 as unweighted_overall_display
from ls
group by business_id;

-- =========================
-- Supabase RLS notes (example starter)
-- =========================

-- Enable RLS
alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.ratings enable row level security;
alter table public.secondary_ratings enable row level security;
alter table public.comments enable row level security;
alter table public.business_replies enable row level security;
alter table public.flags enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.appeals enable row level security;
alter table public.appeal_messages enable row level security;
alter table public.policies_acceptance enable row level security;

-- Minimal public read access for approved/public content.
create policy "Public read active businesses" on public.businesses
for select using (status = 'active');

create policy "Public read active locations" on public.business_locations
for select using (status = 'active');

create policy "Public read approved ratings" on public.ratings
for select using (status = 'approved');

create policy "Public read approved comments" on public.comments
for select using (status = 'approved' and deleted_at is null);

create policy "Public read approved business replies" on public.business_replies
for select using (status = 'approved' and deleted_at is null);

-- Owner update example (ratings/comments)
create policy "Users upsert own ratings" on public.ratings
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users manage own comments" on public.comments
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- NOTE:
-- Add moderator/admin policies via custom JWT claims (e.g. auth.jwt()->>'role').
-- Keep writes to moderation tables restricted to moderator/admin roles only.
