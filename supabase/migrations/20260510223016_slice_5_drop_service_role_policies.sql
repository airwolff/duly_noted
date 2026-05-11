-- Drop the four `service_role full access` policies introduced by
-- 20260510191756_slice_5_reader_ui_rls.sql on publications/towns/
-- boards/memberships. service_role bypasses RLS at runtime, so these
-- policies were never load-bearing — the original migration's own
-- comment calls them "for audit symmetry — not strictly required".
-- They violate the root CLAUDE.md §6 hard rule (RLS policy without a
-- matching table-level GRANT in the same migration) without delivering
-- functional access. Removal is the cleaner closure; service_role
-- retains the table-touch permissions it needs from earlier migrations
-- and continues bypassing RLS regardless. No GRANT changes required.

-- Policy name strings match the originals byte-for-byte. IF EXISTS
-- guards against drift if a manual SQL Editor edit ever renamed a
-- policy in the cloud.
drop policy if exists "service_role full access on publications"
  on public.publications;
drop policy if exists "service_role full access on towns"
  on public.towns;
drop policy if exists "service_role full access on boards"
  on public.boards;
drop policy if exists "service_role full access on memberships"
  on public.memberships;
