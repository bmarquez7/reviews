-- Supabase SQL schema for Tirana Events Calendar

create extension if not exists "uuid-ossp";

create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'pending',
  title_en text not null,
  title_es text,
  title_sq text,
  description_en text not null,
  description_es text,
  description_sq text,
  location_en text,
  location_es text,
  location_sq text,
  event_type text not null,
  area text not null,
  event_language text[] not null,
  date_start timestamptz not null,
  date_end timestamptz,
  price_type text not null,
  price_min numeric,
  price_max numeric,
  currency text default 'ALL',
  ticket_url text,
  event_image_url text,
  organizer_name text,
  organizer_email text,
  submitter_name text,
  submitter_email text,
  submitter_note text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_events_updated_at
before update on public.events
for each row execute procedure public.set_updated_at();

-- Row Level Security
alter table public.events enable row level security;

-- Anyone can read approved events
create policy "Public read approved" on public.events
for select using (status = 'approved');

-- Authenticated admins can read all events (including pending)
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'events'
      and policyname = 'Admin read all'
  ) then
    create policy "Admin read all" on public.events
    for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- Anyone can insert (submissions go to pending)
create policy "Public insert" on public.events
for insert with check (true);

-- Only authenticated admins can update/delete
create policy "Admin update" on public.events
for update using (auth.role() = 'authenticated');

create policy "Admin delete" on public.events
for delete using (auth.role() = 'authenticated');
