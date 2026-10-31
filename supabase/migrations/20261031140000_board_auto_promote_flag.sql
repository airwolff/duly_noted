-- Per-board switch for discovered → pending auto-promotion.
--
-- Context: the demo set of meetings is chosen by hand. With the worker on,
-- every board's hourly cron would otherwise promote each new matching video
-- into the paid pipeline (~$1–1.50 per meeting). With auto_promote = false the
-- cron still catalogs videos at `discovered` (YouTube quota only, no vendor
-- cost), and a meeting enters the pipeline only when an operator sets it to
-- `pending`.
--
-- Defaults to true so every existing board keeps its current behaviour on
-- apply. Turning promotion off or on is a one-row data change.
--
-- Backwards-compatible per CLAUDE.md §6: one additive column with a default,
-- and the RPC keeps its signature, security mode, and grants. The running cron
-- calls it unchanged.

alter table public.boards
  add column auto_promote boolean not null default true;

comment on column public.boards.auto_promote is
  'When false, auto_promote_for_board leaves this board''s discovered meetings alone; they enter the pipeline only when set to pending by hand.';

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
     and b.auto_promote
     and m.status = 'discovered'
     and m.duration_seconds is not null
     and m.duration_seconds >= b.min_duration_seconds
     and b.title_pattern is not null
     and m.title ~* b.title_pattern;

  get diagnostics promoted = row_count;
  return promoted;
end;
$$;
