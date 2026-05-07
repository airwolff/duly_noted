-- Slice 2 audit fix-pass follow-up. Three changes, all forward-only:
--   1. Promote meetings.youtube_id to NOT NULL. SPEC.md §Stage 5 mandates
--      this; the Slice 2 migration only added UNIQUE. The cron always
--      populates youtube_id and the worker requires it, so the column has
--      always been effectively non-null in practice — this just makes the
--      schema agree.
--   2-3. Reissue claim_pending_meeting() and auto_promote_for_board(uuid)
--      with the redundant `updated_at = now()` removed from their UPDATE
--      clauses. The meetings_set_updated_at BEFORE UPDATE trigger already
--      sets new.updated_at, so the explicit assignment was dead code that
--      invited drift. CREATE OR REPLACE preserves existing GRANT/REVOKE.

alter table public.meetings
  alter column youtube_id set not null;

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
     set status = 'extracting'
   where m.id = claimed_id
   returning m.id, m.board_id, m.youtube_id, m.title, m.duration_seconds;
end;
$$;

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
     set status = 'pending'
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
