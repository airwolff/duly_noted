-- Slice 2 seed. Idempotent: every INSERT uses ON CONFLICT against an actual
-- unique constraint, foreign keys resolve via slug subqueries (never inline
-- UUIDs), and parent rows are inserted before child rows so reseeding cannot
-- produce duplicates or FK failures.

insert into public.publications (slug, name)
values ('midcoast-villager', 'Midcoast Villager')
on conflict (slug) do nothing;

insert into public.towns (publication_id, slug, name)
select p.id, 'lincolnville', 'Lincolnville'
  from public.publications p
 where p.slug = 'midcoast-villager'
on conflict (publication_id, slug) do nothing;

insert into public.boards (
  town_id,
  slug,
  name,
  youtube_channel_id,
  title_pattern,
  min_duration_seconds
)
select
  t.id,
  'select-board',
  'Select Board',
  'UC1QHI-zQvIIkptXJsupfTZg',
  'select board',
  600
  from public.towns t
  join public.publications p on p.id = t.publication_id
 where t.slug = 'lincolnville'
   and p.slug = 'midcoast-villager'
on conflict (town_id, slug) do nothing;

-- Smoke-test row that bypasses cron discovery: status='pending' so the worker
-- picks it up immediately on its next poll tick.
insert into public.meetings (board_id, youtube_id, status, title)
select b.id, 'vWsJcTssN9s', 'pending', 'Lincolnville Select Board Meeting'
  from public.boards b
  join public.towns t on t.id = b.town_id
  join public.publications p on p.id = t.publication_id
 where b.slug = 'select-board'
   and t.slug = 'lincolnville'
   and p.slug = 'midcoast-villager'
on conflict (youtube_id) do nothing;
