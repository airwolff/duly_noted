-- Backfill meetings.meeting_date from titles.
--
-- Nothing wrote meeting_date until worker-cron started deriving it at
-- discovery, so every existing row is null. That made the reader show
-- "Date unknown" and left the board list effectively unordered.
--
-- Mirrors the title arm of apps/worker-cron/src/meeting-date.ts: a month word
-- (matched on its first three letters), a day, and a four-digit year, e.g.
-- "Select Board - August 10, 2026". Titles without a date stay null; the cron's
-- upload-time fallback needs YouTube's publishedAt, which the table does not
-- store. Impossible dates (February 30) are skipped rather than rolled over.
--
-- Backwards-compatible per CLAUDE.md §6: a data-only update of a nullable
-- column no running code depends on being null.

with parsed as (
  select
    id,
    m[1] as month_word,
    m[2]::int as day,
    m[3]::int as year
  from public.meetings,
    lateral regexp_match(title, '\m([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\M') as m
  where meeting_date is null
    and m is not null
),
numbered as (
  select
    id,
    day,
    year,
    array_position(
      array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],
      lower(left(month_word, 3))
    ) as month
  from parsed
),
valid as (
  select id, make_date(year, month, day) as d
  from numbered
  where month is not null
    and day between 1 and extract(day from (make_date(year, month, 1) + interval '1 month - 1 day'))
)
update public.meetings mt
   set meeting_date = valid.d
  from valid
 where mt.id = valid.id;
