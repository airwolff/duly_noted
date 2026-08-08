-- Public read access, gated per publication.
--
-- Context: the product is invitation-only and multi-tenant-ready, and the
-- intent is that publications pay for access. That model is unchanged. What
-- this adds is a per-publication opt-in so a single publication can be made
-- world-readable without dismantling the membership-scoped policies that the
-- paid model depends on.
--
-- The column defaults to false, so:
--   * every existing publication stays private on apply
--   * every future publication is private the moment it is created
--   * public is an explicit, reversible data change (one UPDATE), not a code
--     change and not a migration
--
-- The anon policies below mirror the authenticated ones from slice 5 exactly,
-- with the membership subquery swapped for the public_read flag. Meetings keep
-- the status = 'published' gate, so unpublished, failed, and in-flight rows are
-- never anon-visible.
--
-- Backwards-compatible per CLAUDE.md §6: purely additive (one column with a
-- default, new policies, new grants). The running worker is unaffected — it
-- operates as service_role, whose policies and grants are untouched.

alter table public.publications
  add column public_read boolean not null default false;

comment on column public.publications.public_read is
  'When true, anon may read this publication''s towns, boards, published meetings, and segments. Default false: the paid, invitation-only path is the default and public access is an explicit opt-in.';

-- ---------------------------------------------------------------------------
-- anon SELECT policies. Mirrors of the slice 5 authenticated policies with
-- the membership predicate replaced by the flag.
-- ---------------------------------------------------------------------------

create policy "anon read public publications"
  on public.publications for select to anon
  using (public_read);

create policy "anon read towns of public publications"
  on public.towns for select to anon
  using (
    publication_id in (
      select id from public.publications where public_read
    )
  );

create policy "anon read boards of public publications"
  on public.boards for select to anon
  using (
    exists (
      select 1
        from public.towns t
        join public.publications p on p.id = t.publication_id
       where t.id = boards.town_id
         and p.public_read
    )
  );

create policy "anon read published meetings of public publications"
  on public.meetings for select to anon
  using (
    status = 'published'
    and exists (
      select 1
        from public.boards b
        join public.towns t on t.id = b.town_id
        join public.publications p on p.id = t.publication_id
       where b.id = meetings.board_id
         and p.public_read
    )
  );

-- Same shape as the authenticated segments policy: the published gate and the
-- tenant boundary both arrive through the meetings RLS subquery.
create policy "anon read segments of public meetings"
  on public.segments for select to anon
  using (
    exists (
      select 1 from public.meetings m
       where m.id = segments.meeting_id
    )
  );

-- ---------------------------------------------------------------------------
-- GRANTs. Required alongside every policy (CLAUDE.md §6) — RLS without GRANT
-- silently fails to expose the API path.
--
-- Column-scoped where the table carries columns anon has no business reading:
--   * meetings.audio_url / asr_transcript_id / transcript_url — internal
--     storage paths and vendor identifiers
--   * meetings.last_error / failed_at — operational detail; a failed row is
--     not anon-visible anyway, but the columns should not be grantable
--   * segments.embedding — a 1536-float vector per segment. Excluded for
--     payload size as much as for hygiene.
-- ---------------------------------------------------------------------------

grant select (id, slug, name, public_read, created_at)
  on public.publications to anon;

grant select (id, publication_id, slug, name, created_at)
  on public.towns to anon;

grant select (id, town_id, slug, name, created_at)
  on public.boards to anon;

grant select (
  id, board_id, status, title, meeting_date, summary, summary_generated_at,
  duration_seconds, youtube_id, created_at, updated_at
) on public.meetings to anon;

grant select (
  id, meeting_id, sequence_order, marker_type, title, description,
  start_time_seconds, end_time_seconds, transcript_excerpt, created_at,
  updated_at
) on public.segments to anon;

-- Search. search_segments is SECURITY INVOKER by design so RLS scopes the
-- result set to the caller; granting anon EXECUTE therefore returns only
-- segments of public publications, with no further change to the function.
grant execute on function public.search_segments(
  text, extensions.vector(1536), int, float, float, int
) to anon;
