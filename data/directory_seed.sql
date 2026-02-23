-- Minimal seed data for directory app testing

insert into public.categories (slug, label_i18n_key)
values
  ('restaurant', 'category.restaurant'),
  ('cafe', 'category.cafe'),
  ('hotel', 'category.hotel'),
  ('clinic', 'category.clinic'),
  ('retail', 'category.retail')
on conflict (slug) do nothing;

-- Ensure platform config exists and stays at desired default
insert into public.platform_config (id, current_policies_version, comments_premoderation)
values (true, '2026-02-17', false)
on conflict (id)
do update set
  current_policies_version = excluded.current_policies_version,
  comments_premoderation = excluded.comments_premoderation,
  updated_at = now();
