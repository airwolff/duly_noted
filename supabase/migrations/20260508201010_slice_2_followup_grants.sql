-- Service_role GRANTs on scaffold tables that the cron queries directly.
-- The scaffold migration only granted on _scaffold_health; Slice 2's
-- cron path against cloud Supabase surfaced the gap (permission denied
-- for table boards). Quick-fix was applied manually via SQL Editor in
-- cloud; this migration codifies it for reproducibility across
-- environments and clean `supabase db reset` runs.
grant select on public.publications to service_role;
grant select on public.towns to service_role;
grant select on public.boards to service_role;
