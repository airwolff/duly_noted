-- Slice 5 reader-UI RLS deltas. Replaces the pass-1 published-only
-- authenticated SELECT policies on meetings/segments with
-- membership-aware versions, and adds first-time authenticated SELECT
-- policies + GRANTs on publications/towns/boards/memberships. RLS +
-- GRANT only — no table-shape changes. Backwards-compatible with the
-- previously deployed worker (worker uses service_role; unaffected).
-- Closes NI-008.

-- Policy name strings match the originals byte-for-byte. IF EXISTS
-- guards against drift if a manual SQL Editor edit ever renamed a
-- policy in the cloud.
drop policy if exists "authenticated reads published meetings"
  on public.meetings;
drop policy if exists "authenticated read segments of published meetings"
  on public.segments;

-- service_role policies on the 4 previously policy-less tables.
-- service_role bypasses RLS at runtime, so these are for audit
-- symmetry with meetings/segments — not strictly required.
create policy "service_role full access on publications"
  on public.publications for all to service_role
  using (true) with check (true);
create policy "service_role full access on towns"
  on public.towns for all to service_role
  using (true) with check (true);
create policy "service_role full access on boards"
  on public.boards for all to service_role
  using (true) with check (true);
create policy "service_role full access on memberships"
  on public.memberships for all to service_role
  using (true) with check (true);

-- authenticated membership-aware SELECT policies.
create policy "authenticated read own publications"
  on public.publications for select to authenticated
  using (
    id in (
      select publication_id from public.memberships
       where user_id = auth.uid()
    )
  );

create policy "authenticated read own towns"
  on public.towns for select to authenticated
  using (
    publication_id in (
      select publication_id from public.memberships
       where user_id = auth.uid()
    )
  );

create policy "authenticated read own boards"
  on public.boards for select to authenticated
  using (
    exists (
      select 1
        from public.towns t
        join public.memberships m on m.publication_id = t.publication_id
       where t.id = boards.town_id
         and m.user_id = auth.uid()
    )
  );

create policy "authenticated read meetings via membership"
  on public.meetings for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1
        from public.boards b
        join public.towns t on t.id = b.town_id
        join public.memberships m on m.publication_id = t.publication_id
       where b.id = meetings.board_id
         and m.user_id = auth.uid()
    )
  );

-- segments inherits both the published gate and the tenant boundary
-- via the meetings RLS subquery (RLS applies recursively in subqueries
-- against authenticated-role-readable tables).
create policy "authenticated read segments via meeting"
  on public.segments for select to authenticated
  using (
    exists (
      select 1 from public.meetings m
       where m.id = segments.meeting_id
    )
  );

create policy "authenticated read own membership"
  on public.memberships for select to authenticated
  using (user_id = auth.uid());

-- GRANTs on the 4 newly-policied tables. meetings and segments
-- already have authenticated SELECT grants from slices 2 and 3.
grant select on public.publications to authenticated;
grant select on public.towns to authenticated;
grant select on public.boards to authenticated;
grant select on public.memberships to authenticated;
