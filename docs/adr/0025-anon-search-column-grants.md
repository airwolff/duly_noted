# 0025. Anon read of segment search columns

Date: 2026-10-31
Status: Accepted

## Context

ADR 0024 made a publication world-readable through anon RLS policies and
column-scoped grants. It granted `search_segments` EXECUTE to anon on the
reasoning that the function is SECURITY INVOKER, so RLS would scope results
with no further change. It also withheld `segments.embedding` from anon,
"for payload size as much as for hygiene", and its column list omitted
`segments.search_tsv`.

Both reasoning lines held separately and failed together. A SECURITY INVOKER
function reads columns with the caller's privileges, and `search_segments`
reads `search_tsv` (full-text arm) and `embedding` (semantic arm). Every
signed-out search failed with `42501 permission denied for table segments`.
It went unnoticed because `public_read` stayed false until 2026-10-31, the
first time the anon path was exercised.

## Considered options

- **Grant anon SELECT on `search_tsv` and `embedding`.** One additive
  grant. Rows stay gated by the existing anon segments policy.
- **Make `search_segments` SECURITY DEFINER.** Forbidden for RPCs called from
  user surfaces (root `CLAUDE.md` §6); it would also bypass the membership
  policies for authenticated callers.
- **Keyword-only search for anon.** Avoids `embedding` but still needs
  `search_tsv`, and requires a second function or a branch in the Edge
  Function. Worse results on the surface the public flag exists to show.

## Decision

Grant anon SELECT on `segments.search_tsv` and `segments.embedding`.

ADR 0024's exclusion of `embedding` was about payload and hygiene, not
confidentiality: embeddings derive from public-record transcripts and
disclose nothing the anon-readable `transcript_excerpt` does not. Payload
only grows when a caller explicitly selects the column; the web app never
does.

## Consequences

- Signed-out search works on any `public_read` publication.
- An anon caller can fetch raw vectors via PostgREST for segments it can
  already see. Accepted.
- ADR 0024's column-scoping still holds for `meetings`, whose withheld
  columns are internal storage paths and vendor identifiers.
- Lesson: when granting EXECUTE on a SECURITY INVOKER function to a role
  with column-scoped grants, check the function body's column reads against
  the grant list.
