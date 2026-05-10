-- Slice 4 summarization schema deltas. Additive and backwards-compatible with
-- the previously deployed worker (CLAUDE.md §6). Adds:
--   * 'summarizing_inflight' transient enum value on public.meeting_status
--   * meetings.summary + meetings.summary_generated_at columns
--   * public.claim_summarizing_meeting() RPC
--   * public.complete_summarization(uuid, text) RPC
--
-- Mirrors Slice 3's chaptering / claim_segmenting_meeting / complete_segmentation
-- pattern. The 'summarizing_inflight' value is the worker-holds transient
-- between 'summarizing' (segmentation-completion-set, ready for the LLM call)
-- and 'published' (post-summarization terminal state). CLAUDE.md §6 mandates
-- atomic claim; the LLM work cannot share a Postgres transaction with the
-- claim, so the transient value gates re-claim.
--
-- The existing meetings RLS policies and grants cover the new columns
-- unchanged. The set_updated_at() trigger from Slice 2 also covers them.

-- ---------------------------------------------------------------------------
-- meeting_status: 'summarizing_inflight' transient state
--
-- Placed before 'review' to preserve the published-flow ordering. ADD VALUE
-- caveat applies — the new value cannot appear as a literal in same-transaction
-- DML, but CREATE FUNCTION bodies are safe (deferred resolution). Same shape
-- as the slice 3 'chaptering' add.
-- ---------------------------------------------------------------------------

alter type public.meeting_status add value if not exists 'summarizing_inflight' before 'review';

-- ---------------------------------------------------------------------------
-- meetings: summary columns
--
-- Both nullable indefinitely — see SPEC §"Slice 4 schema deltas". NOT NULL is
-- deferred until and unless backfill completes; rows that fail summarization
-- never receive values and the nullable shape is correct as-is.
-- ---------------------------------------------------------------------------

alter table public.meetings
  add column summary text,
  add column summary_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- claim_summarizing_meeting()
--
-- FOR UPDATE SKIP LOCKED + atomic UPDATE status summarizing → summarizing_inflight.
-- Mirrors claim_segmenting_meeting(). SECURITY DEFINER with pinned search_path,
-- granted only to service_role.
-- ---------------------------------------------------------------------------

create or replace function public.claim_summarizing_meeting()
returns table (
  id uuid,
  board_id uuid,
  title text,
  meeting_date date,
  youtube_id text
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
   where m.status = 'summarizing'
   order by m.created_at asc
   for update skip locked
   limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.meetings m
     set status = 'summarizing_inflight'
   where m.id = claimed_id
   returning m.id, m.board_id, m.title, m.meeting_date, m.youtube_id;
end;
$$;

revoke all on function public.claim_summarizing_meeting() from public;
grant execute on function public.claim_summarizing_meeting() to service_role;

-- ---------------------------------------------------------------------------
-- complete_summarization(meeting_id, summary)
--
-- Transactionally writes the summary + advances status to 'published'. The
-- status='summarizing_inflight' guard preserves idempotency under duplicate
-- worker invocations: a re-run after the first commit finds zero rows and
-- raises.
-- ---------------------------------------------------------------------------

create or replace function public.complete_summarization(
  p_meeting_id uuid,
  p_summary    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  update public.meetings
     set summary = p_summary,
         summary_generated_at = now(),
         status = 'published'
   where id = p_meeting_id
     and status = 'summarizing_inflight';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'complete_summarization: meeting % not in summarizing_inflight state', p_meeting_id;
  end if;
end;
$$;

revoke all on function public.complete_summarization(uuid, text) from public;
grant execute on function public.complete_summarization(uuid, text) to service_role;
