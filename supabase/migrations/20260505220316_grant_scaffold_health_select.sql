-- Grant SELECT on _scaffold_health to the API roles. RLS already restricts
-- which rows can be read; without table-level GRANTs the API cannot see the
-- table at all. These were applied manually via the SQL editor against the
-- live project; codifying here so `supabase db reset` produces the same
-- state. GRANT is idempotent, so re-applying against prod is a no-op.

grant select on public._scaffold_health to anon;
grant select on public._scaffold_health to authenticated;
grant select on public._scaffold_health to service_role;
