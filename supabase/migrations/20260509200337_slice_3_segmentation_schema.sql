-- Slice 3 segmentation schema deltas. Additive and backwards-compatible with
-- the previously deployed worker (CLAUDE.md §6). Adds:
--   * 'chaptering' transient enum value on public.meeting_status
--   * public.segments table + index + trigger + RLS + GRANTs
--   * public.claim_segmenting_meeting() RPC
--   * public.complete_segmentation(uuid, jsonb) RPC
--
-- The 'chaptering' value is the worker-holds transient between 'segmenting'
-- (Edge Function-set, ready for the LLM pipeline) and 'summarizing'
-- (post-segmentation, ready for Slice 4). Mirrors the Slice 2 precedent
-- where 'extracting' is the worker-holds transient between 'pending' and
-- 'transcribing'. CLAUDE.md §6 mandates that the queue claim atomically
-- updates status; the LLM work cannot share a Postgres transaction with the
-- claim, so the transient value gates re-claim.

-- ---------------------------------------------------------------------------
-- meeting_status: 'chaptering' transient state
--
-- ADD VALUE in a Postgres transaction stores the new enum value; the value
-- cannot be used as a literal in subsequent DML inside the same transaction,
-- but CREATE FUNCTION only stores plpgsql body text (not eagerly resolved),
-- so the RPC bodies below referencing 'chaptering' are safe.
-- ---------------------------------------------------------------------------

alter type public.meeting_status add value if not exists 'chaptering' before 'summarizing';

-- ---------------------------------------------------------------------------
-- segments
-- ---------------------------------------------------------------------------

create table public.segments (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.meetings(id) on delete cascade,
  sequence_order      int  not null,
  marker_type         text not null check (marker_type in (
                        'AGENDA_ITEM', 'PUBLIC_COMMENT', 'DISCUSSION', 'VOTE', 'PROCEDURE'
                      )),
  title               text not null,
  description         text not null,
  start_time_seconds  int  not null check (start_time_seconds >= 0),
  end_time_seconds    int  not null check (end_time_seconds > start_time_seconds),
  transcript_excerpt  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (meeting_id, sequence_order)
);

-- FK-side index for reader-UI lookup. The (meeting_id, sequence_order)
-- UNIQUE covers ordered iteration, so no separate composite index is needed.
create index segments_meeting_id_idx on public.segments (meeting_id);

create trigger segments_set_updated_at
  before update on public.segments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS + GRANTs (paired per CLAUDE.md §6)
-- ---------------------------------------------------------------------------

alter table public.segments enable row level security;

create policy "service_role full access on segments"
  on public.segments
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated users may read segments only when the parent meeting is
-- published. Same pass-2 deferral as meetings (NI-008): no per-publication
-- tenant filter at v1; single-tenant deployment makes the predicate
-- trivially true. Membership-aware policy lands in pass 2.
create policy "authenticated read segments of published meetings"
  on public.segments
  for select
  to authenticated
  using (exists (
    select 1 from public.meetings m
    where m.id = segments.meeting_id and m.status = 'published'
  ));

grant all on public.segments to service_role;
grant select on public.segments to authenticated;

-- ---------------------------------------------------------------------------
-- claim_segmenting_meeting()
--
-- FOR UPDATE SKIP LOCKED + atomic UPDATE status segmenting → chaptering.
-- Mirrors claim_pending_meeting(). SECURITY DEFINER with pinned search_path,
-- granted only to service_role.
-- ---------------------------------------------------------------------------

create or replace function public.claim_segmenting_meeting()
returns table (
  id uuid,
  transcript_url text,
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
   where m.status = 'segmenting'
   order by m.created_at asc
   for update skip locked
   limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.meetings m
     set status = 'chaptering'
   where m.id = claimed_id
   returning m.id, m.transcript_url, m.duration_seconds;
end;
$$;

revoke all on function public.claim_segmenting_meeting() from public;
grant execute on function public.claim_segmenting_meeting() to service_role;

-- ---------------------------------------------------------------------------
-- complete_segmentation(meeting_id, segments_json)
--
-- Transactionally INSERT N segments + UPDATE meetings status='summarizing'.
-- The status='chaptering' guard preserves idempotency under duplicate worker
-- invocations: a re-run after the first commit finds zero rows and raises,
-- and the segments INSERT will already have been rolled back if the UPDATE
-- short-circuits inside the same function call.
--
-- p_segments shape (per element):
--   { sequence_order, marker_type, title, description,
--     start_time_seconds, end_time_seconds, transcript_excerpt }
-- ---------------------------------------------------------------------------

create or replace function public.complete_segmentation(
  p_meeting_id uuid,
  p_segments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  if jsonb_typeof(p_segments) <> 'array' then
    raise exception 'complete_segmentation: p_segments must be a jsonb array';
  end if;

  insert into public.segments (
    meeting_id,
    sequence_order,
    marker_type,
    title,
    description,
    start_time_seconds,
    end_time_seconds,
    transcript_excerpt
  )
  select
    p_meeting_id,
    (s ->> 'sequence_order')::int,
    s ->> 'marker_type',
    s ->> 'title',
    s ->> 'description',
    (s ->> 'start_time_seconds')::int,
    (s ->> 'end_time_seconds')::int,
    s ->> 'transcript_excerpt'
  from jsonb_array_elements(p_segments) as s;

  update public.meetings
     set status = 'summarizing'
   where id = p_meeting_id
     and status = 'chaptering';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'complete_segmentation: meeting % not in chaptering state', p_meeting_id;
  end if;
end;
$$;

revoke all on function public.complete_segmentation(uuid, jsonb) from public;
grant execute on function public.complete_segmentation(uuid, jsonb) to service_role;
