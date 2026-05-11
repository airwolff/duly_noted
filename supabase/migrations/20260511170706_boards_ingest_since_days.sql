-- Per-board ingestion horizon. Constrains how far back the cron looks for new
-- meeting videos on a board's YouTube channel. Additive, NOT NULL with default,
-- backwards-compatible with the previously deployed cron (CLAUDE.md §6). The
-- cron reads this column to compute a cutoff and short-circuit pagination once
-- a stale playlistItems.list entry appears.

alter table public.boards
  add column ingest_since_days int not null default 365;

comment on column public.boards.ingest_since_days is
  'How many days back the cron looks for new uploads on this board''s channel. '
  'Per-board so historical-reconstruction boards can override without affecting steady-state.';
