-- 50 real Tirana businesses imported from OpenStreetMap (2026-02-19)
-- Source: https://www.openstreetmap.org (ODbL), queried via Overpass API

begin;

with owner_user as (
  select id
  from public.users
  order by created_at asc
  limit 1
),
source_rows(name, category_slug, address_line, city, region, country, latitude, longitude) as (
  values
    ('4 PM', 'restaurant', 'Lidhja e Prizrenit 005', 'Tirana', 'Tirane', 'Albania', 41.317276, 19.818777),
    ('Aba 21', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.320282, 19.823062),
    ('Alpin', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.251234, 19.895121),
    ('Alteo', 'restaurant', 'Sadik Petrela', 'Tirana', 'Tirane', 'Albania', 41.338166, 19.840724),
    ('Bar Angel', 'restaurant', 'Rruga e Kavajës', 'Tirana', 'Tirane', 'Albania', 41.323554, 19.795417),
    ('Bar Dollia', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.323504, 19.793801),
    ('Bar Peroni', 'restaurant', 'Drago Siliqi', 'Tirana', 'Tirane', 'Albania', 41.322574, 19.830584),
    ('Bioteka', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.318522, 19.818632),
    ('Bohemian Burger', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.324757, 19.809877),
    ('Caramel', 'restaurant', 'Bulevardi Dëshmorët e Kombit', 'Tirana', 'Tirane', 'Albania', 41.322283, 19.819597),
    ('Carlsberg', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.317639, 19.818894),
    ('City Bar', 'restaurant', 'Papa Gjon Pali II', 'Tirana', 'Tirane', 'Albania', 41.319990, 19.823530),
    ('Creperie "I saw it first"', 'restaurant', 'Rruga Dëshmorët e 4 Shkurtit', 'Tirane', 'Tirane', 'Albania', 41.317228, 19.814747),
    ('Eiffel', 'restaurant', 'Rruga Kongresi i Manastirit', 'Tirana', 'Tirane', 'Albania', 41.338346, 19.833862),
    ('Emergency', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.321176, 19.811351),
    ('ERA', 'restaurant', 'Rruga Papa Gjon Pali II 11', 'Tirana', 'Tirane', 'Albania', 41.319765, 19.823596),
    ('Fiore', 'restaurant', 'Rruga Dervish Hima', 'Tirana', 'Tirane', 'Albania', 41.319566, 19.825568),
    ('Fish House', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.323261, 19.813950),
    ('Forest', 'restaurant', 'Shëtitore Parku i Madh', 'Tirana', 'Tirane', 'Albania', 41.313456, 19.816446),
    ('Fusion @Coin', 'restaurant', 'Papa Gjon Pali II', 'Tirana', 'Tirane', 'Albania', 41.319957, 19.822881),
    ('GrAal', 'restaurant', 'Rruga Dervish Hima', 'Tirana', 'Tirane', 'Albania', 41.319538, 19.825414),
    ('Il Gusto', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.321944, 19.819448),
    ('Kafe Flora', 'restaurant', 'Rruga e Durrësit (under construction ...)', 'Tirana', 'Tirane', 'Albania', 41.329675, 19.814524),
    ('Kometa Café & More', 'restaurant', 'Rruga. Grigor Heba', 'Tirana', 'Tirane', 'Albania', 41.316057, 19.809570),
    ('Komiteti - Kafe & Muzeum', 'restaurant', 'Rruga Fatmir Haxhiu 2', 'Tirana', 'Tirane', 'Albania', 41.323302, 19.822594),
    ('La Vita e Bella', 'restaurant', 'Rruga Jul Variboba', 'Tirana', 'Tirane', 'Albania', 41.322924, 19.822912),
    ('LA''s by 29', 'restaurant', 'Rruga Kristo Luarasi', 'Tirane', 'Tirane', 'Albania', 41.312038, 19.812115),
    ('Lulishte "1 Maj"', 'restaurant', 'Rruga e Elbasanit', 'Tirana', 'Tirane', 'Albania', 41.326062, 19.825272),
    ('Magic Club Tirana', 'restaurant', 'Rruga Pjetër Bogdani', 'Tirana', 'Tirane', 'AL', 41.321546, 19.817480),
    ('Meduza', 'restaurant', 'Rruga Mustafa Matohiti', 'Tirana', 'Tirane', 'Albania', 41.322386, 19.824070),
    ('Menza Kolonat', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.321253, 19.834989),
    ('Menza Marion', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.321478, 19.834368),
    ('Miri', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirane', 'Tirane', 'Albania', 41.331714, 19.777600),
    ('New York Tirana Bagels', 'restaurant', 'Themistokli Gërmenji', 'Tirana', 'Tirane', 'Albania', 41.320870, 19.824905),
    ('Ods Garden', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.329395, 19.824248),
    ('Oriental City', 'restaurant', 'Themistokli Gërmenji', 'Tirana', 'Tirane', 'Albania', 41.320911, 19.825156),
    ('Pastarela', 'restaurant', 'Rruga Mustafa Matohiti', 'Tirana', 'Tirane', 'Albania', 41.322579, 19.823614),
    ('PepPer Lounge', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.322103, 19.817148),
    ('Piceri Hallall', 'restaurant', 'rruga ''Perlat Rexhepi''', 'Tirane', 'Tirane', 'Albania', 41.318120, 19.816334),
    ('Pireu', 'restaurant', 'Rruga Qamil Guranjaku', 'Tirana', 'Tirane', 'Albania', 41.322184, 19.826778),
    ('Pizzeria Saporita', 'restaurant', 'Rruga Emin Duraku', 'Tirana', 'Tirane', 'Albania', 41.319208, 19.809824),
    ('Pjateli', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.259232, 19.878656),
    ('Primitivo', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.310595, 19.837175),
    ('Prince Park', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.313633, 19.833555),
    ('Proper Pizza 1', 'restaurant', 'Gjin Bue Shpata', 'Tirane', 'Tirane', 'Albania', 41.318331, 19.812375),
    ('Red Eye', 'restaurant', 'Jorgjia Truja', 'Tirane', 'Tirane', 'Albania', 41.321673, 19.835882),
    ('Reka', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.250167, 19.896574),
    ('Restorant Tomahawk Tirane', 'restaurant', 'Rruga Dëshmorët e 4 Shkurtit', 'Tirane', 'Tirane', 'Albania', 41.316267, 19.815292),
    ('Roma', 'restaurant', 'Rruga e Elbasanit', 'Tirana', 'Tirane', 'Albania', 41.320912, 19.825707),
    ('Runway 35', 'restaurant', 'Address not listed (OpenStreetMap)', 'Tirana', 'Tirane', 'Albania', 41.418542, 19.713915)
),
inserted_businesses as (
  insert into public.businesses (
    owner_user_id,
    name,
    owner_name,
    description,
    status,
    is_claimed
  )
  select
    o.id,
    s.name,
    'Unclaimed',
    'Imported from OpenStreetMap directory seed (Tirana).',
    'active'::public.business_status,
    false
  from source_rows s
  cross join owner_user o
  where not exists (
    select 1
    from public.businesses b
    where lower(b.name) = lower(s.name)
  )
  returning id, name
)
insert into public.business_locations (
  business_id,
  location_name,
  address_line,
  city,
  region,
  country,
  latitude,
  longitude,
  status
)
select
  b.id,
  s.name,
  s.address_line,
  s.city,
  s.region,
  s.country,
  s.latitude,
  s.longitude,
  'active'::public.business_status
from source_rows s
join public.businesses b on lower(b.name) = lower(s.name)
where not exists (
  select 1
  from public.business_locations l
  where l.business_id = b.id and lower(l.city) = lower(s.city)
);

insert into public.business_category_assignments (business_id, category_id)
select
  b.id,
  c.id
from source_rows s
join public.businesses b on lower(b.name) = lower(s.name)
join public.categories c on c.slug = s.category_slug
on conflict do nothing;

commit;
