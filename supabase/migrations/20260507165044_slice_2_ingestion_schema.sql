-- Slice 2 ingestion schema deltas. Additive and backwards-compatible with the
-- previously deployed worker (CLAUDE.md §6). Adds the ingest-load-bearing
-- columns on boards/meetings, the worker queue RPC, the cron auto-promote RPC,
-- the meetings updated_at trigger, RLS policies + GRANTs on meetings, the
-- supporting indexes, and the meeting-artifacts Storage bucket.
--
-- Pass-2 schema work (FK indexes on memberships, soft-deletes, search columns,
-- triggers on remaining tables) remains deferred per SPEC.md Stage 5 pass 2.

-- ---------------------------------------------------------------------------
-- boards: discovery + auto-promotion fields
-- ---------------------------------------------------------------------------

alter table public.boards
  add column youtube_channel_id text,
  add column title_pattern text,
  add column min_duration_seconds int not null default 0;

-- YouTube channel IDs always start with 'UC'. Guard the substr() expression
-- below so a malformed id never produces a corrupted uploads_playlist_id.
alter table public.boards
  add constraint boards_youtube_channel_id_prefix
  check (youtube_channel_id is null or youtube_channel_id like 'UC%');

-- The uploads playlist id is the channel id with the leading 'UC' replaced by
-- 'UU'. Using substr() rather than replace() avoids the footgun where 'UC'
-- appears mid-string (replace() is global). Computed at the column level so
-- the cron does not need a channels.list call.
alter table public.boards
  add column uploads_playlist_id text
  generated always as ('UU' || substr(youtube_channel_id, 3)) stored;

-- ---------------------------------------------------------------------------
-- meetings: pipeline-state-bearing columns + uniqueness
-- ---------------------------------------------------------------------------

alter table public.meetings
  add column transcript_url text,
  add column audio_url text,
  add column asr_transcript_id text,
  add column duration_seconds int,
  add column title text,
  add column failed_at timestamptz;

-- youtube_id was nullable in the scaffold. The cron always populates it; the
-- worker requires it. Promote to UNIQUE (table is empty before this slice).
alter table public.meetings
  add constraint meetings_youtube_id_unique unique (youtube_id);

alter table public.meetings
  add constraint meetings_asr_transcript_id_unique unique (asr_transcript_id);

-- Worker poll filter; FK-side index for joins.
create index meetings_status_idx on public.meetings (status);
create index meetings_board_id_idx on public.meetings (board_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger (meetings only at this slice; pass 2 covers other tables)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies on meetings + matching table-level GRANTs
--
-- RLS was enabled in the scaffold migration with no policies (default deny).
-- service_role gets full access; authenticated reads only published meetings.
-- ---------------------------------------------------------------------------

create policy "service_role full access on meetings"
  on public.meetings
  for all
  to service_role
  using (true)
  with check (true);

create policy "authenticated reads published meetings"
  on public.meetings
  for select
  to authenticated
  using (status = 'published');

grant all on public.meetings to service_role;
grant select on public.meetings to authenticated;

-- ---------------------------------------------------------------------------
-- Worker queue RPC: claim_pending_meeting()
--
-- Atomic SELECT ... FOR UPDATE SKIP LOCKED + UPDATE in one Postgres function
-- so the worker can claim a row without a read-then-write race. Returns the
-- claimed row or no rows. SECURITY DEFINER is deliberate: pinned search_path,
-- granted only to service_role.
-- ---------------------------------------------------------------------------

create or replace function public.claim_pending_meeting()
returns table (
  id uuid,
  board_id uuid,
  youtube_id text,
  title text,
  duration_seconds int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select m.id into claimed_id
    from public.meetings m
   where m.status = 'pending'
   order by m.created_at asc
   for update skip locked
   limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.meetings m
     set status = 'extracting',
         updated_at = now()
   where m.id = claimed_id
   returning m.id, m.board_id, m.youtube_id, m.title, m.duration_seconds;
end;
$$;

revoke all on function public.claim_pending_meeting() from public;
grant execute on function public.claim_pending_meeting() to service_role;

-- ---------------------------------------------------------------------------
-- Cron auto-promote RPC: auto_promote_for_board(uuid)
--
-- Runs the discovered → pending promotion using the board's title_pattern
-- (Postgres ~* regex) and min_duration_seconds. Returns the count of rows
-- promoted. Single migration per CLAUDE.md §6 (migrations are append-only).
-- ---------------------------------------------------------------------------

create or replace function public.auto_promote_for_board(p_board_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  promoted int;
begin
  update public.meetings m
     set status = 'pending',
         updated_at = now()
    from public.boards b
   where m.board_id = b.id
     and b.id = p_board_id
     and m.status = 'discovered'
     and m.duration_seconds is not null
     and m.duration_seconds >= b.min_duration_seconds
     and b.title_pattern is not null
     and m.title ~* b.title_pattern;

  get diagnostics promoted = row_count;
  return promoted;
end;
$$;

revoke all on function public.auto_promote_for_board(uuid) from public;
grant execute on function public.auto_promote_for_board(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket: meeting-artifacts (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('meeting-artifacts', 'meeting-artifacts', false)
on conflict (id) do nothing;
