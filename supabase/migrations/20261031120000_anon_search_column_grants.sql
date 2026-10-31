-- Let anon run search_segments on public_read publications (ADR 0025).
--
-- search_segments is SECURITY INVOKER, so it reads segments.search_tsv (the
-- full-text arm) and segments.embedding (the semantic arm) as the caller. The
-- public_read migration granted anon a column list that omits both, so every
-- signed-out search failed with 42501 "permission denied for table segments".
--
-- Row visibility is unchanged: the anon segments policy still limits rows to
-- published meetings of public_read publications. This only adds the two
-- columns the search function reads.
--
-- Backwards-compatible per CLAUDE.md §6: a purely additive grant. The worker
-- runs as service_role and is unaffected.

grant select (search_tsv, embedding) on public.segments to anon;
