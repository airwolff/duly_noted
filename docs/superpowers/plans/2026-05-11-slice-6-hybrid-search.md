# Slice 6 — Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the search gate held open by ADR 0020 — readers can keyword- and semantic-search across segments of published meetings within their publication via a hybrid Postgres FTS + pgvector arm fused with Reciprocal Rank Fusion.

**Architecture:** A single migration adds an `embedding` and `embedding_inflight` enum value on `meeting_status`, an `embedding extensions.vector(1536)` column and a generated `search_tsv tsvector` column on `segments`, HNSW + GIN indexes, and four RPCs (`claim_embedding_meeting`, `complete_embedding`, `abandon_embedding_meeting`, `search_segments`). The Slice 4 `complete_summarization` RPC is amended to advance to `embedding` instead of `published`. A new worker handler at `apps/worker/src/embedding/` consumes `embedding` rows, generates per-segment embeddings via OpenAI `text-embedding-3-small`, and advances to `published`. A new Edge Function `supabase/functions/search/` validates the caller's JWT, embeds the query, and calls `search_segments` with the user's JWT forwarded so membership-aware RLS gates results. The reader gains a `/{publication.slug}/search?q=...` route and a search affordance from the publication page.

**Tech Stack:** Postgres 17 + pgvector (HNSW, `vector_cosine_ops`), Postgres native FTS (`tsvector` + GIN + `ts_rank_cd` + `websearch_to_tsquery`), SQL Reciprocal Rank Fusion, Supabase Edge Functions (Deno), OpenAI `text-embedding-3-small` (1536-dim native) via `fetch`, Node 24 worker (TypeScript strict), Next.js 15 App Router (server components, edge runtime), Zod everywhere external input crosses a boundary, Vitest for worker unit tests.

---

## File Structure

**New files:**

- `supabase/migrations/20260511HHMMSS_slice_6_search_schema.sql` — schema deltas (enum values, `segments.embedding`, `segments.search_tsv`, HNSW + GIN indexes), `complete_summarization` amendment, `claim_embedding_meeting`, `complete_embedding`, `abandon_embedding_meeting`, `search_segments` RPCs + GRANTs.
- `packages/shared/src/embedding/index.ts` — public exports.
- `packages/shared/src/embedding/constants.ts` — `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`.
- `packages/shared/src/embedding/inputs.ts` — `buildEmbeddingInput({ title, description, transcript_excerpt })` returns the single string per segment for the OpenAI input.
- `packages/shared/src/embedding/schemas.ts` — Zod schema for the OpenAI embeddings response (`data[].embedding` validated as a 1536-length array of numbers).
- `apps/worker/src/embedding/openai.ts` — fetch-based OpenAI wrapper with retry (1s/4s/16s), `retry-after` honoring, Zod response validation. Exports `createOpenAIEmbedder(apiKey) => CallEmbedder`.
- `apps/worker/src/embedding/openai.test.ts` — wrapper unit tests (retry, success, 429 with `retry-after`, response-shape failure).
- `apps/worker/src/embedding/run.ts` — `runEmbeddingOnce(deps)` claim/loop/complete handler.
- `apps/worker/src/embedding/run.test.ts` — handler unit tests (idle, success, no-segments, OpenAI throws, response-length mismatch, complete RPC errors).
- `apps/worker/scripts/backfill-embeddings.ts` — one-shot script.
- `supabase/functions/search/index.ts` — Edge Function, JWT-verified at gateway, embeds query and calls `search_segments` with caller JWT forwarded.
- `apps/web/src/app/[publication]/search/page.tsx` — server-component search results page.
- `apps/web/src/components/search-input.tsx` — server-component GET-form input.
- `apps/web/src/components/search-result-card.tsx` — server-component result card.

**Modified files:**

- `packages/db/src/types.ts` — add `'embedding'`, `'embedding_inflight'` to `MeetingStatus`; add `embedding`/`search_tsv` to `segments` Row/Insert/Update; add new RPCs (`claim_embedding_meeting`, `complete_embedding`, `abandon_embedding_meeting`, `search_segments`) to `Functions`.
- `packages/shared/src/index.ts` — re-export `./embedding/index.js`.
- `apps/worker/src/env.ts` — add `OPENAI_API_KEY`.
- `apps/worker/.env.example` — add `OPENAI_API_KEY=`.
- `apps/worker/src/pipeline/run.ts` — insert `runEmbeddingOnce` dispatch between `runSummarizationOnce` and `runSegmentationOnce` (closest-to-publication first), thread `callEmbedder` through `RunDeps`, extend `RunOutcome` with `{ kind: 'embedded'; meetingId: string; segmentCount: number }`.
- `apps/worker/src/poll-loop.ts` — add `case 'embedded'` log line.
- `apps/worker/src/index.ts` — instantiate `createOpenAIEmbedder` and pass into `startPollLoop`.
- `apps/worker/package.json` — add `"backfill:embeddings"` script.
- `apps/web/src/app/[publication]/page.tsx` — add a single "Search this publication" link to `/{slug}/search`.
- `render.yaml` — add `OPENAI_API_KEY` to the `duly-noted-worker` envVarGroup; do NOT add to `duly-noted-cron`.
- `docs/adr/0020-reader-ui-ships-without-search.md` — status changes to `Superseded by Slice 6`.

**No changes:**

- `supabase/config.toml` — default `verify_jwt = true` is what `search` needs; no `[functions.search]` block required (and adding one would be a foot-gun). Document the absence in the migration header comment.
- Slice 5 RLS — the membership-aware `authenticated read segments via meeting` policy already covers the new `embedding` / `search_tsv` columns and gates `search_segments` results.

---

## Task 1: Migration — segments columns + enum values + `complete_summarization` amendment

**Files:**

- Create: `supabase/migrations/20260511HHMMSS_slice_6_search_schema.sql` (replace `HHMMSS` with the actual UTC time at creation — use `date -u +%Y%m%d%H%M%S`).

**Why this is split across tasks 1–3:** The migration is one file but is built incrementally so each chunk is reviewed in isolation before the next chunk lands.

- [ ] **Step 1: Create the migration file with the schema-delta header and the pgvector extension guard**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_slice_6_search_schema.sql"
```

Then write:

```sql
-- Slice 6 hybrid-search schema deltas. Additive and backwards-compatible
-- with the previously deployed worker (CLAUDE.md §6). Adds:
--   * 'embedding' + 'embedding_inflight' transient enum values on
--     public.meeting_status, both inserted before 'review'
--   * segments.embedding extensions.vector(1536)
--   * segments.search_tsv tsvector generated stored (weighted A/B/C across
--     title/description/transcript_excerpt)
--   * HNSW index on segments.embedding (vector_cosine_ops)
--   * GIN index on segments.search_tsv
--   * public.claim_embedding_meeting() RPC
--   * public.complete_embedding(uuid, jsonb) RPC
--   * public.abandon_embedding_meeting(uuid, text) RPC
--   * public.search_segments(text, vector(1536), int, float, float, int) RPC
--   * amendment to public.complete_summarization() — advance target moves
--     from 'published' to 'embedding' (per SPEC.md §"Slice 4 schema
--     deltas" Slice 6 amendment).
--
-- The Slice 4 RPC amendment is backwards-compatible with the previously
-- deployed worker: the old worker calls complete_summarization with the
-- same args and gets the same return value; rows transit to 'embedding'
-- instead of 'published' and sit there until the new worker handler picks
-- them up. The Slice 5 RLS policy on meetings filters by status =
-- 'published', so rows mid-transit are invisible to readers — no
-- user-visible regression during the migrate/deploy race.
--
-- search_segments is the authenticated user-facing RPC. It is NOT
-- SECURITY DEFINER — it runs as the caller so the Slice 5 membership-
-- aware RLS policies on segments and joined parent tables gate the
-- result set. The Edge Function forwards the caller's JWT to PostgREST
-- so this works. The claim/complete/abandon trio is SECURITY DEFINER +
-- service_role-only, paralleling Slice 3 and Slice 4.
--
-- No supabase/config.toml change: the default verify_jwt = true is what
-- the search function needs. Only the asr-webhook needs verify_jwt =
-- false (vendor callback). Adding a [functions.search] block would be a
-- foot-gun if anyone copies the asr-webhook shape.

create extension if not exists vector with schema extensions;
```

- [ ] **Step 2: Append the enum-value additions**

Both new values insert before `'review'` per SPEC §"Slice 6 schema deltas". Use `if not exists` to tolerate cloud-side drift (NI-style defensive `IF EXISTS` on DROPs; for `ADD VALUE` Postgres has a native `IF NOT EXISTS` clause).

```sql
-- ---------------------------------------------------------------------------
-- meeting_status: 'embedding' and 'embedding_inflight'
--
-- ADD VALUE caveat: the new values cannot appear as a literal in same-
-- transaction DML, but CREATE FUNCTION bodies are safe (deferred resolution).
-- Same pattern as Slice 3's 'chaptering' add and Slice 4's
-- 'summarizing_inflight' add.
-- ---------------------------------------------------------------------------

alter type public.meeting_status add value if not exists 'embedding' before 'review';
alter type public.meeting_status add value if not exists 'embedding_inflight' before 'review';
```

- [ ] **Step 3: Append the `segments` column additions and indexes**

```sql
-- ---------------------------------------------------------------------------
-- segments: embedding + search_tsv columns
--
-- The embedding column is nullable indefinitely: rows backfilled by the
-- one-shot script populate it; rows that fail the embedding stage stay NULL
-- forever (the meeting is at status='failed' and not reader-visible).
-- search_tsv is a generated stored column so existing rows populate
-- automatically at ALTER TABLE time. Weights match SPEC §Slice 6 schema:
-- title=A, description=B, transcript_excerpt=C.
-- ---------------------------------------------------------------------------

alter table public.segments
  add column embedding extensions.vector(1536),
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(transcript_excerpt, '')), 'C')
  ) stored;

-- HNSW on embedding for the semantic arm. vector_cosine_ops matches the
-- OpenAI text-embedding-3-small convention (L2-normalized vectors; cosine
-- and inner product produce identical ranking but cosine is the broader
-- pgvector convention).
create index segments_embedding_hnsw_idx
  on public.segments
  using hnsw (embedding extensions.vector_cosine_ops);

-- GIN on search_tsv for the lexical arm.
create index segments_search_tsv_gin_idx
  on public.segments
  using gin (search_tsv);
```

- [ ] **Step 4: Append the `complete_summarization` amendment**

Per SPEC §"Slice 4 schema deltas" Slice 6 amendment. The function body is the only thing that changes — args and return shape are unchanged so the previously-deployed worker keeps working through the deploy race.

```sql
-- ---------------------------------------------------------------------------
-- complete_summarization() amendment — Slice 6
--
-- The advance target moves from 'published' to 'embedding'. The function
-- signature is unchanged. The previously deployed worker continues to
-- succeed against this RPC; rows transit to 'embedding' instead of
-- 'published' and become invisible to the reader (the Slice 5 RLS policy
-- on meetings filters status = 'published'). The new worker handler in
-- apps/worker/src/embedding/ picks them up and advances them.
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
         status = 'embedding'
   where id = p_meeting_id
     and status = 'summarizing_inflight';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'complete_summarization: meeting % not in summarizing_inflight state', p_meeting_id;
  end if;
end;
$$;

-- Grant unchanged; the existing service_role EXECUTE grant carries over.
```

- [ ] **Step 5: Commit the schema chunk**

```bash
git add supabase/migrations/*_slice_6_search_schema.sql
git commit -m "feat(slice-6): add segments search columns + amend complete_summarization"
```

---

## Task 2: Migration — embedding-pipeline RPCs (claim/complete/abandon)

**Files:**

- Modify: same migration file from Task 1.

- [ ] **Step 1: Append `claim_embedding_meeting()`**

SPEC §"Slice 6 schema deltas" line 567: "Match Slice 4's `claim_summarizing_meeting()` shape; the segments JOIN is the only addition." Return shape includes the meeting id and a jsonb array of its segments so the worker handler does not need a separate query.

```sql
-- ---------------------------------------------------------------------------
-- claim_embedding_meeting()
--
-- FOR UPDATE SKIP LOCKED + atomic UPDATE status embedding → embedding_inflight,
-- returning the meeting id and the meeting's segments as a jsonb array.
-- Mirrors claim_summarizing_meeting() shape with the segments JOIN added
-- per SPEC §"Slice 6 schema deltas". SECURITY DEFINER with pinned
-- search_path; granted only to service_role.
-- ---------------------------------------------------------------------------

create or replace function public.claim_embedding_meeting()
returns table (
  id uuid,
  segments jsonb
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
   where m.status = 'embedding'
   order by m.created_at asc
   for update skip locked
   limit 1;

  if claimed_id is null then
    return;
  end if;

  update public.meetings m
     set status = 'embedding_inflight'
   where m.id = claimed_id;

  return query
  select
    claimed_id,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id,
                   'sequence_order', s.sequence_order,
                   'title', s.title,
                   'description', s.description,
                   'transcript_excerpt', s.transcript_excerpt
                 )
                 order by s.sequence_order
               )
          from public.segments s
         where s.meeting_id = claimed_id
      ),
      '[]'::jsonb
    );
end;
$$;

revoke all on function public.claim_embedding_meeting() from public;
grant execute on function public.claim_embedding_meeting() to service_role;
```

- [ ] **Step 2: Append `complete_embedding()`**

Transactionally writes per-segment embeddings + advances status to `published`. The `status = 'embedding_inflight'` guard preserves idempotency under duplicate worker invocations. The jsonb arg shape is `[{"segment_id": "...", "embedding": [...]}, ...]`.

```sql
-- ---------------------------------------------------------------------------
-- complete_embedding(meeting_id, segment_embeddings)
--
-- Iterates the jsonb array and writes per-segment embeddings, then
-- atomically advances status from 'embedding_inflight' to 'published'.
-- The status='embedding_inflight' guard preserves idempotency under
-- duplicate worker invocations.
--
-- p_segment_embeddings shape (per element):
--   { "segment_id": "<uuid>", "embedding": [<1536 floats>] }
-- ---------------------------------------------------------------------------

create or replace function public.complete_embedding(
  p_meeting_id uuid,
  p_segment_embeddings jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  if jsonb_typeof(p_segment_embeddings) <> 'array' then
    raise exception 'complete_embedding: p_segment_embeddings must be a jsonb array';
  end if;

  update public.segments s
     set embedding = ((e ->> 'embedding'))::extensions.vector(1536)
    from jsonb_array_elements(p_segment_embeddings) as e
   where s.id = (e ->> 'segment_id')::uuid
     and s.meeting_id = p_meeting_id;

  update public.meetings
     set status = 'published'
   where id = p_meeting_id
     and status = 'embedding_inflight';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'complete_embedding: meeting % not in embedding_inflight state', p_meeting_id;
  end if;
end;
$$;

revoke all on function public.complete_embedding(uuid, jsonb) from public;
grant execute on function public.complete_embedding(uuid, jsonb) to service_role;
```

- [ ] **Step 3: Append `abandon_embedding_meeting()`**

Failure-path RPC. SPEC §"Slice 6 schema deltas" line 569 specifies it; matches the semantics of `markFailed` but scoped to the `embedding_inflight` guard for atomicity.

```sql
-- ---------------------------------------------------------------------------
-- abandon_embedding_meeting(meeting_id, error_text)
--
-- Moves status embedding_inflight → failed, records last_error (truncated
-- by the caller) and failed_at. Idempotent: a row no longer in
-- embedding_inflight is left alone.
-- ---------------------------------------------------------------------------

create or replace function public.abandon_embedding_meeting(
  p_meeting_id uuid,
  p_error_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meetings
     set status = 'failed',
         last_error = left(p_error_text, 4000),
         failed_at = now()
   where id = p_meeting_id
     and status = 'embedding_inflight';
end;
$$;

revoke all on function public.abandon_embedding_meeting(uuid, text) from public;
grant execute on function public.abandon_embedding_meeting(uuid, text) to service_role;
```

- [ ] **Step 4: Commit the pipeline-RPC chunk**

```bash
git add supabase/migrations/*_slice_6_search_schema.sql
git commit -m "feat(slice-6): add embedding pipeline RPCs (claim/complete/abandon)"
```

---

## Task 3: Migration — `search_segments` RPC + GRANTs

**Files:**

- Modify: same migration file.

- [ ] **Step 1: Append the `search_segments` RPC**

User-facing RPC. NOT `SECURITY DEFINER` — runs as caller so Slice 5 membership-aware RLS gates the result set via the joined parent tables. `language sql stable` is sufficient; pin `search_path` to `public, extensions` so the vector operators resolve.

The implementation follows the Supabase hybrid-search reference (`supabase.com/docs/guides/ai/hybrid-search`) with two adjustments per ADR 0021: native 1536-dim vectors (no Matryoshka truncation) and `websearch_to_tsquery` for friendlier user-input parsing.

The Supabase canonical pattern's "fan-out then rerank": each arm pulls `match_count * 2` candidates, fused via RRF, then re-limited to `match_count`. The CTE `LEAST(match_count, 50) * 2` caps the inner pulls to prevent runaway queries. The outer `LEAST(match_count, 50)` enforces a 50-result hard cap, matching the web layer's `SHOW_MORE_MATCH_COUNT` and the Edge Function's `MAX_MATCH_COUNT`.

```sql
-- ---------------------------------------------------------------------------
-- search_segments(query_text, query_embedding, match_count, weights, rrf_k)
--
-- Hybrid lexical + semantic search across segments. Returns the top
-- match_count rows ordered by Reciprocal Rank Fusion score, joined to
-- parent meetings/boards/towns/publications so the reader can render
-- breadcrumbs and a meeting-page link.
--
-- NOT SECURITY DEFINER. Runs as the caller so the Slice 5 membership-
-- aware RLS policies on segments and joined parent tables gate the
-- result set. The Edge Function forwards the caller's JWT to PostgREST.
--
-- Implementation follows supabase.com/docs/guides/ai/hybrid-search.
-- RRF formula: score = sum_i ( weight_i / (rrf_k + rank_i) ).
-- Inner-CTE limit (match_count * 2, capped at 100) is the canonical fan-
-- out-then-rerank pattern.
--
-- The 50-row hard cap matches the Slice 6 product surface: default
-- match_count is 20 with a single "show more" affordance bumping to
-- match_count = 50 per SPEC §Stage 9. The cap is here as a defensive
-- ceiling — never a real result-size constraint at v1 scale.
-- ---------------------------------------------------------------------------

create or replace function public.search_segments(
  query_text         text,
  query_embedding    extensions.vector(1536),
  match_count        int,
  full_text_weight   float default 1.0,
  semantic_weight    float default 1.0,
  rrf_k              int   default 50
)
returns table (
  segment_id          uuid,
  meeting_id          uuid,
  publication_slug    text,
  publication_name    text,
  town_slug           text,
  town_name           text,
  board_slug          text,
  board_name          text,
  meeting_title       text,
  meeting_date        date,
  segment_title       text,
  segment_description text,
  marker_type         text,
  transcript_excerpt  text,
  start_time_seconds  int,
  rrf_score           float
)
language sql
stable
set search_path = public, extensions
as $$
  with full_text as (
    select
      s.id,
      row_number() over (
        order by ts_rank_cd(s.search_tsv, websearch_to_tsquery('english', query_text)) desc
      ) as rank_ix
    from public.segments s
    where s.search_tsv @@ websearch_to_tsquery('english', query_text)
    order by ts_rank_cd(s.search_tsv, websearch_to_tsquery('english', query_text)) desc
    limit least(match_count, 50) * 2
  ),
  semantic as (
    select
      s.id,
      row_number() over (order by s.embedding <=> query_embedding) as rank_ix
    from public.segments s
    where s.embedding is not null
    order by s.embedding <=> query_embedding
    limit least(match_count, 50) * 2
  )
  select
    s.id                       as segment_id,
    m.id                       as meeting_id,
    p.slug                     as publication_slug,
    p.name                     as publication_name,
    t.slug                     as town_slug,
    t.name                     as town_name,
    b.slug                     as board_slug,
    b.name                     as board_name,
    m.title                    as meeting_title,
    m.meeting_date,
    s.title                    as segment_title,
    s.description              as segment_description,
    s.marker_type,
    s.transcript_excerpt,
    s.start_time_seconds,
    (
      coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
      coalesce(1.0 / (rrf_k + semantic.rank_ix),  0.0) * semantic_weight
    )                          as rrf_score
  from public.segments s
    join public.meetings    m on m.id = s.meeting_id
    join public.boards      b on b.id = m.board_id
    join public.towns       t on t.id = b.town_id
    join public.publications p on p.id = t.publication_id
    left join full_text on full_text.id = s.id
    left join semantic  on semantic.id  = s.id
  where full_text.id is not null or semantic.id is not null
  order by rrf_score desc
  limit least(match_count, 50);
$$;

revoke all on function public.search_segments(
  text, extensions.vector(1536), int, float, float, int
) from public;
grant execute on function public.search_segments(
  text, extensions.vector(1536), int, float, float, int
) to authenticated;
```

- [ ] **Step 2: Commit the search-RPC chunk**

```bash
git add supabase/migrations/*_slice_6_search_schema.sql
git commit -m "feat(slice-6): add search_segments RPC with hybrid RRF"
```

- [ ] **Step 3: Smoke-test the migration against a local Supabase stack**

```bash
supabase start
supabase db reset
```

Expected: clean apply, no errors. If `supabase` CLI is not installed locally (per `supabase/config.toml` header: "the Supabase CLI is not installed locally"), this step is deferred to the CI migrate workflow; mark the step done with a note in the commit and rely on the GitHub Action to validate.

---

## Task 4: Update `packages/db/src/types.ts`

**Files:**

- Modify: `packages/db/src/types.ts`.

This is hand-extended (per the file's header comment) until generated types land. Add the new enum values, columns, and RPC signatures so the worker, web, and Edge Function TypeScript all compile.

- [ ] **Step 1: Extend `MeetingStatus` and `segments` row types**

Find:

```ts
export type MeetingStatus =
  | 'discovered'
  | 'pending'
  | 'extracting'
  | 'transcribing'
  | 'segmenting'
  | 'chaptering'
  | 'summarizing'
  | 'summarizing_inflight'
  | 'review'
  | 'published'
  | 'failed';
```

Replace with (inserting both new values before `'review'` to mirror the enum order):

```ts
export type MeetingStatus =
  | 'discovered'
  | 'pending'
  | 'extracting'
  | 'transcribing'
  | 'segmenting'
  | 'chaptering'
  | 'summarizing'
  | 'summarizing_inflight'
  | 'embedding'
  | 'embedding_inflight'
  | 'review'
  | 'published'
  | 'failed';
```

Find the `segments: { Row: { ... } }` block. The current shape ends with `updated_at: string;`. Add the new columns to Row, and `embedding` to Insert/Update. `search_tsv` is a generated stored column — omit it from Insert and Update entirely so a misguided `.update({ search_tsv: ... })` is a compile-time error.

In `Row`, append (after `updated_at: string;`):

```ts
embedding: string | null;
search_tsv: string | null;
```

In `Insert`, append (after the last existing field — typically `updated_at?: string;`):

```ts
          embedding?: string | null;
```

In `Update`, append:

```ts
          embedding?: string | null;
```

The `embedding` column is `extensions.vector(1536)`. PostgREST returns it as a JSON array, but supabase-js generated types model unknown column types as `unknown` or `string`. The hand-extended type uses `string | null` — pgvector text representation in transit — which matches both the backfill's direct UPDATE path (which writes a `[...]` string literal) and the worker-side never-reading invariant (the worker writes via RPC, not direct UPDATE). If the worker or backfill ever needs to READ the embedding back, refine to `number[] | string | null`.

- [ ] **Step 2: Add the four new RPC signatures to `Functions`**

Find the `Functions: { ... }` block. After `complete_summarization`, append:

```ts
      claim_embedding_meeting: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          segments: Json;
        }[];
      };
      complete_embedding: {
        Args: { p_meeting_id: string; p_segment_embeddings: Json };
        Returns: void;
      };
      abandon_embedding_meeting: {
        Args: { p_meeting_id: string; p_error_text: string };
        Returns: void;
      };
      search_segments: {
        Args: {
          query_text: string;
          query_embedding: string;
          match_count: number;
          full_text_weight?: number;
          semantic_weight?: number;
          rrf_k?: number;
        };
        Returns: {
          segment_id: string;
          meeting_id: string;
          publication_slug: string;
          publication_name: string;
          town_slug: string;
          town_name: string;
          board_slug: string;
          board_name: string;
          meeting_title: string | null;
          meeting_date: string | null;
          segment_title: string;
          segment_description: string;
          marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
          transcript_excerpt: string;
          start_time_seconds: number;
          rrf_score: number;
        }[];
      };
```

`query_embedding: string` — the supabase-js client serializes the JS array to a pgvector text literal before sending; declare it as the on-the-wire shape.

- [ ] **Step 3: Verify the typecheck passes**

```bash
pnpm -F @duly-noted/db typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(slice-6): add embedding/search column + RPC types"
```

---

## Task 5: Shared embedding module

**Files:**

- Create: `packages/shared/src/embedding/index.ts`
- Create: `packages/shared/src/embedding/constants.ts`
- Create: `packages/shared/src/embedding/inputs.ts`
- Create: `packages/shared/src/embedding/inputs.test.ts`
- Create: `packages/shared/src/embedding/schemas.ts`
- Create: `packages/shared/src/embedding/schemas.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests for `buildEmbeddingInput`**

Create `packages/shared/src/embedding/inputs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEmbeddingInput } from './inputs.js';

describe('buildEmbeddingInput', () => {
  it('concatenates title, description, and transcript excerpt with newlines', () => {
    expect(
      buildEmbeddingInput({
        title: 'Budget item',
        description: 'Discussion of the budget.',
        transcript_excerpt: 'We discussed the budget today.',
      }),
    ).toBe('Budget item\nDiscussion of the budget.\nWe discussed the budget today.');
  });

  it('trims trailing whitespace on each field', () => {
    expect(
      buildEmbeddingInput({
        title: 'Title  ',
        description: '  Description.\n',
        transcript_excerpt: 'Excerpt.',
      }),
    ).toBe('Title\nDescription.\nExcerpt.');
  });

  it('throws when the combined input is empty', () => {
    expect(() =>
      buildEmbeddingInput({ title: '', description: '', transcript_excerpt: '' }),
    ).toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @duly-noted/shared test -- inputs.test.ts
```

Expected: FAIL with "Cannot find module './inputs.js'".

- [ ] **Step 3: Write `constants.ts`**

Create `packages/shared/src/embedding/constants.ts`:

```ts
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
```

- [ ] **Step 4: Write `inputs.ts`**

Create `packages/shared/src/embedding/inputs.ts`:

```ts
export interface EmbeddingInputFields {
  title: string;
  description: string;
  transcript_excerpt: string;
}

export function buildEmbeddingInput(fields: EmbeddingInputFields): string {
  const parts = [fields.title.trim(), fields.description.trim(), fields.transcript_excerpt.trim()];
  const joined = parts.join('\n').trim();
  if (joined === '') {
    throw new Error('buildEmbeddingInput: cannot build an empty input');
  }
  return joined;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm -F @duly-noted/shared test -- inputs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing tests for the OpenAI response schema**

Create `packages/shared/src/embedding/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openaiEmbeddingResponseSchema } from './schemas.js';
import { EMBEDDING_DIMENSIONS } from './constants.js';

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);
}

describe('openaiEmbeddingResponseSchema', () => {
  it('accepts a well-formed single-input response', () => {
    const parsed = openaiEmbeddingResponseSchema.parse({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: dummyVector() }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('rejects an embedding with the wrong length', () => {
    expect(() =>
      openaiEmbeddingResponseSchema.parse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    ).toThrow();
  });

  it('rejects non-number elements in embedding', () => {
    const v = dummyVector();
    v[0] = 'oops' as unknown as number;
    expect(() =>
      openaiEmbeddingResponseSchema.parse({
        data: [{ embedding: v }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

```bash
pnpm -F @duly-noted/shared test -- schemas.test.ts
```

Expected: FAIL with "Cannot find module './schemas.js'".

- [ ] **Step 8: Write `schemas.ts`**

Create `packages/shared/src/embedding/schemas.ts`:

```ts
import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from './constants.js';

/**
 * OpenAI embeddings response shape, narrowed to the fields the worker
 * and the Edge Function consume. Other fields (object, model, usage) are
 * permitted via passthrough.
 *
 * Per CLAUDE.md §6, every embedding's length is validated to equal the
 * configured dimension count before persistence — this schema is the
 * enforcement surface.
 */
export const openaiEmbeddingResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export type OpenAIEmbeddingResponse = z.infer<typeof openaiEmbeddingResponseSchema>;
```

- [ ] **Step 9: Run to verify it passes**

```bash
pnpm -F @duly-noted/shared test -- schemas.test.ts
```

Expected: PASS.

- [ ] **Step 10: Wire the index exports**

Create `packages/shared/src/embedding/index.ts`:

```ts
export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './constants.js';
export { buildEmbeddingInput } from './inputs.js';
export type { EmbeddingInputFields } from './inputs.js';
export { openaiEmbeddingResponseSchema } from './schemas.js';
export type { OpenAIEmbeddingResponse } from './schemas.js';
```

Modify `packages/shared/src/index.ts`. The current file ends with:

```ts
export * from './summarization/index.js';
```

Append:

```ts
export * from './embedding/index.js';
```

- [ ] **Step 11: Run the full shared-package test suite**

```bash
pnpm -F @duly-noted/shared test
pnpm -F @duly-noted/shared typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/embedding packages/shared/src/index.ts
git commit -m "feat(slice-6): add shared embedding constants, input builder, response schema"
```

---

## Task 6: Worker env — add `OPENAI_API_KEY`

**Files:**

- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/.env.example`

- [ ] **Step 1: Add the env var to the schema**

Find in `apps/worker/src/env.ts`:

```ts
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASR_VENDOR_API_KEY: z.string().min(1),
  ASR_WEBHOOK_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
});
```

Replace with:

```ts
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASR_VENDOR_API_KEY: z.string().min(1),
  ASR_WEBHOOK_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
});
```

- [ ] **Step 2: Update `.env.example`**

Find:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ASR_VENDOR_API_KEY=
ASR_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
```

Replace with:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ASR_VENDOR_API_KEY=
ASR_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm -F worker typecheck
pnpm -F worker test
```

Expected: typecheck passes; test suite unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/env.ts apps/worker/.env.example
git commit -m "feat(slice-6): require OPENAI_API_KEY in worker env"
```

---

## Task 7: Worker — OpenAI embeddings client

**Files:**

- Create: `apps/worker/src/embedding/openai.ts`
- Create: `apps/worker/src/embedding/openai.test.ts`

- [ ] **Step 1: Write failing tests for `createOpenAIEmbedder`**

Create `apps/worker/src/embedding/openai.test.ts`. The tests use Vitest's `vi.fn()` to stub `fetch` and verify retry semantics. Mirror the structure of `apps/worker/src/pipeline/asr-submit.test.ts`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '@duly-noted/shared';
import { createOpenAIEmbedder } from './openai.js';

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);
}

function okJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

describe('createOpenAIEmbedder', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the embeddings array on success', async () => {
    const v1 = dummyVector();
    const v2 = dummyVector().map((x) => x + 0.1);
    const fetchSpy = vi.fn(async () =>
      okJsonResponse({
        data: [
          { index: 0, embedding: v1 },
          { index: 1, embedding: v2 },
        ],
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [] });
    const result = await embed(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      input: string[];
    };
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.input).toEqual(['a', 'b']);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
  });

  it('retries on 429 then succeeds', async () => {
    const v = dummyVector();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(okJsonResponse({ data: [{ embedding: v }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0] });
    const result = await embed(['x']);

    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 then fails after exhausting attempts', async () => {
    const fetchSpy = vi.fn(async () => new Response('upstream', { status: 503 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0, 0, 0] });
    await expect(embed(['x'])).rejects.toThrow(/openai/);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('does NOT retry on 4xx other than 429', async () => {
    const fetchSpy = vi.fn(async () => new Response('bad key', { status: 401 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0, 0, 0] });
    await expect(embed(['x'])).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a response with a mismatched embedding length', async () => {
    const fetchSpy = vi.fn(async () => okJsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [] });
    await expect(embed(['x'])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F worker test -- embedding/openai.test.ts
```

Expected: FAIL with "Cannot find module './openai.js'".

- [ ] **Step 3: Write `openai.ts`**

Create `apps/worker/src/embedding/openai.ts`:

```ts
import { EMBEDDING_MODEL, openaiEmbeddingResponseSchema } from '@duly-noted/shared';

/**
 * Fetch-based wrapper around the OpenAI embeddings endpoint. Returns one
 * 1536-dim vector per input string, preserving input order. Implements
 * SPEC §Stage 9 / ADR 0022 retry policy: three retries with exponential
 * backoff (1s, 4s, 16s) scoped to transient errors only (429, 5xx,
 * network failures). Auth/4xx and parse errors propagate immediately.
 *
 * Honors `retry-after` headers when present on 429 responses by delaying
 * at least that long before the next attempt.
 *
 * Response shape is Zod-validated (length check enforced via the shared
 * schema's `.length(1536)`) before return; the caller never sees an
 * untrusted shape per CLAUDE.md §6.
 */

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_RETRY_DELAYS_MS = [1000, 4000, 16000];

export type CallEmbedder = (inputs: string[]) => Promise<number[][]>;

export interface OpenAIEmbedderOptions {
  retryDelaysMs?: number[];
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asNum = Number(header);
  if (!Number.isNaN(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export function createOpenAIEmbedder(
  apiKey: string,
  options: OpenAIEmbedderOptions = {},
): CallEmbedder {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  return async function embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(OPENAI_EMBEDDINGS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: inputs,
          }),
        });
      } catch (err) {
        lastErr = err;
        if (attempt === retryDelaysMs.length) break;
        await sleep(retryDelaysMs[attempt] ?? 0);
        continue;
      }

      if (response.ok) {
        const json: unknown = await response.json();
        const parsed = openaiEmbeddingResponseSchema.parse(json);
        if (parsed.data.length !== inputs.length) {
          throw new Error(
            `openai embeddings: expected ${inputs.length} vectors, got ${parsed.data.length}`,
          );
        }
        return parsed.data.map((d) => d.embedding);
      }

      if (!isRetriableStatus(response.status)) {
        const text = await response.text().catch(() => '');
        throw new Error(`openai embeddings: ${response.status} ${text}`);
      }

      // retriable status — set up next attempt
      const text = await response.text().catch(() => '');
      lastErr = new Error(`openai embeddings: ${response.status} ${text}`);
      if (attempt === retryDelaysMs.length) break;
      const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
      const baseDelay = retryDelaysMs[attempt] ?? 0;
      await sleep(retryAfter !== null ? Math.max(retryAfter, baseDelay) : baseDelay);
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F worker test -- embedding/openai.test.ts
```

Expected: PASS (all five test cases).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/embedding/openai.ts apps/worker/src/embedding/openai.test.ts
git commit -m "feat(slice-6): add OpenAI embeddings client with retry"
```

---

## Task 8: Worker — embedding handler (`runEmbeddingOnce`)

**Files:**

- Create: `apps/worker/src/embedding/run.ts`
- Create: `apps/worker/src/embedding/run.test.ts`

- [ ] **Step 1: Write failing tests for `runEmbeddingOnce`**

Create `apps/worker/src/embedding/run.test.ts`. Mirror the stub-client shape from `apps/worker/src/pipeline/summarize.test.ts`.

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { EMBEDDING_DIMENSIONS } from '@duly-noted/shared';
import type { CallEmbedder } from './openai.js';
import { runEmbeddingOnce } from './run.js';

interface RpcCall {
  fn: string;
  args: unknown;
}

interface ClaimSegment {
  id: string;
  sequence_order: number;
  title: string;
  description: string;
  transcript_excerpt: string;
}

interface StubOptions {
  claim: { id: string; segments: ClaimSegment[] } | null;
  completeError?: string;
  abandonError?: string;
}

function makeStubClient(options: StubOptions): {
  client: SupabaseClient<Database>;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      if (fn === 'claim_embedding_meeting') {
        return Promise.resolve({
          data: options.claim ? [{ id: options.claim.id, segments: options.claim.segments }] : [],
          error: null,
        });
      }
      if (fn === 'complete_embedding') {
        if (options.completeError) {
          return Promise.resolve({ data: null, error: { message: options.completeError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (fn === 'abandon_embedding_meeting') {
        if (options.abandonError) {
          return Promise.resolve({ data: null, error: { message: options.abandonError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${fn}` } });
    },
  } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
}

const baseSegments: ClaimSegment[] = [
  {
    id: 'seg-1',
    sequence_order: 0,
    title: 'Call to order',
    description: 'Chair calls the meeting to order.',
    transcript_excerpt: 'This meeting is called to order.',
  },
  {
    id: 'seg-2',
    sequence_order: 1,
    title: 'Treasurer report',
    description: 'Monthly financials presented.',
    transcript_excerpt: 'The treasurer presented the report.',
  },
];

describe('runEmbeddingOnce', () => {
  it('returns idle when no embedding row is claimable', async () => {
    const { client } = makeStubClient({ claim: null });
    const embed: CallEmbedder = vi.fn();
    const outcome = await runEmbeddingOnce({ supabase: client, embed });
    expect(outcome).toEqual({ kind: 'idle' });
    expect(embed).not.toHaveBeenCalled();
  });

  it('embeds segments and calls complete_embedding on success', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-1', segments: baseSegments },
    });
    const embeddings = baseSegments.map(() => dummyVector());
    const embed: CallEmbedder = vi.fn().mockResolvedValueOnce(embeddings);

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('embedded');
    if (outcome.kind === 'embedded') {
      expect(outcome.meetingId).toBe('meeting-1');
      expect(outcome.segmentCount).toBe(2);
    }

    expect(embed).toHaveBeenCalledTimes(1);
    const completeCall = rpcCalls.find((c) => c.fn === 'complete_embedding');
    expect(completeCall).toBeDefined();
    const args = completeCall!.args as {
      p_meeting_id: string;
      p_segment_embeddings: Array<{ segment_id: string; embedding: number[] }>;
    };
    expect(args.p_meeting_id).toBe('meeting-1');
    expect(args.p_segment_embeddings).toHaveLength(2);
    expect(args.p_segment_embeddings[0]!.segment_id).toBe('seg-1');
    expect(args.p_segment_embeddings[0]!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('abandons when the claimed meeting has no segments (no embedder call)', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-2', segments: [] },
    });
    const embed: CallEmbedder = vi.fn();

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/no segments/);
    }
    expect(embed).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === 'complete_embedding')).toBe(false);
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });

  it('abandons when the embedder throws', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-3', segments: baseSegments },
    });
    const embed: CallEmbedder = vi.fn().mockRejectedValueOnce(new Error('upstream timeout'));

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/upstream timeout/);
    }
    const abandon = rpcCalls.find((c) => c.fn === 'abandon_embedding_meeting');
    expect(abandon).toBeDefined();
    const args = abandon!.args as { p_meeting_id: string; p_error_text: string };
    expect(args.p_meeting_id).toBe('meeting-3');
    expect(args.p_error_text).toMatch(/upstream timeout/);
  });

  it('abandons when complete_embedding RPC errors', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-4', segments: baseSegments },
      completeError: 'meeting not in embedding_inflight state',
    });
    const embed: CallEmbedder = vi
      .fn()
      .mockResolvedValueOnce(baseSegments.map(() => dummyVector()));

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/complete_embedding/);
    }
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });

  it('abandons when the embedder returns the wrong number of vectors', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-5', segments: baseSegments },
    });
    const embed: CallEmbedder = vi.fn().mockResolvedValueOnce([dummyVector()]); // 1 instead of 2

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/expected 2 vectors, got 1/);
    }
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F worker test -- embedding/run.test.ts
```

Expected: FAIL with "Cannot find module './run.js'".

- [ ] **Step 3: Write `run.ts`**

Create `apps/worker/src/embedding/run.ts`:

```ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@duly-noted/db';
import { buildEmbeddingInput } from '@duly-noted/shared';
import type { CallEmbedder } from './openai.js';

/**
 * Slice 6 embedding orchestrator. Picks up a meeting at status='embedding'
 * (Slice 4-amended complete_summarization-set), generates one embedding
 * per segment via OpenAI text-embedding-3-small, and atomically writes the
 * embeddings + advances status to 'published' via the complete_embedding
 * RPC. The claim RPC moves the row to the transient 'embedding_inflight'
 * state so re-claim is gated while the embedding API call runs outside
 * the Postgres transaction.
 *
 * On any thrown error after claim, the row is abandoned via
 * abandon_embedding_meeting RPC (status → failed, last_error populated).
 * Per CLAUDE.md §7 there is no automatic retry — the OpenAI client
 * handles transient retries internally; an exception escaping it is
 * terminal.
 */

const claimSegmentSchema = z.object({
  id: z.string().uuid(),
  sequence_order: z.number().int(),
  title: z.string(),
  description: z.string(),
  transcript_excerpt: z.string(),
});

const claimSegmentsSchema = z.array(claimSegmentSchema);

type ClaimSegment = z.infer<typeof claimSegmentSchema>;

export type EmbeddingOutcome =
  | { kind: 'idle' }
  | { kind: 'embedded'; meetingId: string; segmentCount: number }
  | { kind: 'failed'; meetingId: string; message: string };

export interface EmbeddingDeps {
  supabase: SupabaseClient<Database>;
  embed: CallEmbedder;
}

interface ClaimedEmbeddingMeeting {
  id: string;
  segments: ClaimSegment[];
}

async function claimEmbeddingMeeting(
  supabase: SupabaseClient<Database>,
): Promise<ClaimedEmbeddingMeeting | null> {
  const { data, error } = await supabase.rpc('claim_embedding_meeting');
  if (error) {
    throw new Error(`claim_embedding_meeting RPC failed: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  if (!row) {
    throw new Error('claim_embedding_meeting RPC returned empty row in non-empty data array');
  }
  return {
    id: row.id,
    segments: claimSegmentsSchema.parse(row.segments),
  };
}

async function abandon(
  supabase: SupabaseClient<Database>,
  meetingId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.rpc('abandon_embedding_meeting', {
    p_meeting_id: meetingId,
    p_error_text: message,
  });
  if (error) {
    // Surface to the tick loop; this is a worker-internal pathology, not a
    // recoverable per-meeting failure.
    throw new Error(`abandon_embedding_meeting RPC failed for ${meetingId}: ${error.message}`);
  }
}

export async function runEmbeddingOnce(deps: EmbeddingDeps): Promise<EmbeddingOutcome> {
  const meeting = await claimEmbeddingMeeting(deps.supabase);
  if (!meeting) return { kind: 'idle' };

  try {
    if (meeting.segments.length === 0) {
      throw new Error('embedding row has no segments');
    }

    const inputs = meeting.segments.map((s) =>
      buildEmbeddingInput({
        title: s.title,
        description: s.description,
        transcript_excerpt: s.transcript_excerpt,
      }),
    );
    const embeddings = await deps.embed(inputs);

    if (embeddings.length !== meeting.segments.length) {
      throw new Error(`expected ${meeting.segments.length} vectors, got ${embeddings.length}`);
    }

    const segmentEmbeddings = meeting.segments.map((s, i) => ({
      segment_id: s.id,
      embedding: embeddings[i]!,
    }));

    const { error: completeErr } = await deps.supabase.rpc('complete_embedding', {
      p_meeting_id: meeting.id,
      p_segment_embeddings: segmentEmbeddings as unknown as Json,
    });
    if (completeErr) {
      throw new Error(`complete_embedding RPC failed: ${completeErr.message}`);
    }

    return { kind: 'embedded', meetingId: meeting.id, segmentCount: meeting.segments.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await abandon(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F worker test -- embedding/run.test.ts
```

Expected: PASS (all six test cases).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/embedding/run.ts apps/worker/src/embedding/run.test.ts
git commit -m "feat(slice-6): add embedding worker handler"
```

---

## Task 9: Worker — pipeline wiring (`run.ts`)

**Files:**

- Modify: `apps/worker/src/pipeline/run.ts`
- Modify: `apps/worker/src/index.ts`

Closest-to-publication dispatch order means: `embed` runs before `summarize` so older work drains first. SPEC §"Background job architecture" implies the order; the existing `run.ts` already places summarize before segment for the same reason.

- [ ] **Step 1: Extend `RunOutcome` and `RunDeps`**

Find in `apps/worker/src/pipeline/run.ts`:

```ts
export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'submitted'; meetingId: string; transcriptId: string }
  | { kind: 'segmented'; meetingId: string; segmentCount: number }
  | { kind: 'summarized'; meetingId: string }
  | { kind: 'failed'; meetingId: string; message: string };

export interface RunDeps {
  supabase: SupabaseClient<Database>;
  supabaseUrl: string;
  asrVendorApiKey: string;
  asrWebhookSecret: string;
  callStructured: CallStructured;
}
```

Replace with:

```ts
export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'submitted'; meetingId: string; transcriptId: string }
  | { kind: 'segmented'; meetingId: string; segmentCount: number }
  | { kind: 'summarized'; meetingId: string }
  | { kind: 'embedded'; meetingId: string; segmentCount: number }
  | { kind: 'failed'; meetingId: string; message: string };

export interface RunDeps {
  supabase: SupabaseClient<Database>;
  supabaseUrl: string;
  asrVendorApiKey: string;
  asrWebhookSecret: string;
  callStructured: CallStructured;
  embed: CallEmbedder;
}
```

Then at the top of the file, add the import. Find:

```ts
import { runSegmentationOnce } from './segment.js';
import { runSummarizationOnce } from './summarize.js';
```

Add after:

```ts
import type { CallEmbedder } from '../embedding/openai.js';
import { runEmbeddingOnce } from '../embedding/run.js';
```

- [ ] **Step 2: Insert the embedding dispatch ahead of summarize**

Find the body of `runPipelineOnce`:

```ts
export async function runPipelineOnce(deps: RunDeps): Promise<RunOutcome> {
  const summarizeOutcome = await runSummarizationOnce({
    supabase: deps.supabase,
    callStructured: deps.callStructured,
  });
  if (summarizeOutcome.kind !== 'idle') {
    return summarizeOutcome;
  }
  const segmentOutcome = await runSegmentationOnce({
    supabase: deps.supabase,
    callStructured: deps.callStructured,
  });
  if (segmentOutcome.kind !== 'idle') {
    return segmentOutcome;
  }
  return runPendingOnce(deps);
}
```

Replace with:

```ts
export async function runPipelineOnce(deps: RunDeps): Promise<RunOutcome> {
  const embedOutcome = await runEmbeddingOnce({
    supabase: deps.supabase,
    embed: deps.embed,
  });
  if (embedOutcome.kind !== 'idle') {
    return embedOutcome;
  }
  const summarizeOutcome = await runSummarizationOnce({
    supabase: deps.supabase,
    callStructured: deps.callStructured,
  });
  if (summarizeOutcome.kind !== 'idle') {
    return summarizeOutcome;
  }
  const segmentOutcome = await runSegmentationOnce({
    supabase: deps.supabase,
    callStructured: deps.callStructured,
  });
  if (segmentOutcome.kind !== 'idle') {
    return segmentOutcome;
  }
  return runPendingOnce(deps);
}
```

Update the docstring above `runPipelineOnce`. Find:

```ts
/**
 * Run the worker pipeline for a single tick. Dispatch order is closest-to-
 * publication first: summarize → segment → pending. Older work drains
 * through the pipeline rather than starving behind newer pending rows. Each
 * handler returns idle if there is no work in its state, falling through to
 * the next. On any error after a claim, the meeting is marked failed and
 * the tick returns; per CLAUDE.md §7 there is no automatic retry.
 */
```

Replace with:

```ts
/**
 * Run the worker pipeline for a single tick. Dispatch order is closest-to-
 * publication first: embed → summarize → segment → pending. Older work
 * drains through the pipeline rather than starving behind newer pending
 * rows. Each handler returns idle if there is no work in its state,
 * falling through to the next. On any error after a claim, the meeting
 * is marked failed and the tick returns; per CLAUDE.md §7 there is no
 * automatic retry.
 */
```

- [ ] **Step 3: Wire the embedder into `index.ts`**

Find in `apps/worker/src/index.ts`:

```ts
import { createServiceClient } from '@duly-noted/db';
import { loadEnv } from './env.js';
import { createAnthropicCaller } from './pipeline/anthropic.js';
import { startPollLoop } from './poll-loop.js';
```

Add after the last import:

```ts
import { createOpenAIEmbedder } from './embedding/openai.js';
```

Find:

```ts
const callStructured = createAnthropicCaller(env.ANTHROPIC_API_KEY);

const handle = startPollLoop({
  supabase,
  supabaseUrl: env.SUPABASE_URL,
  asrVendorApiKey: env.ASR_VENDOR_API_KEY,
  asrWebhookSecret: env.ASR_WEBHOOK_SECRET,
  callStructured,
});
```

Replace with:

```ts
const callStructured = createAnthropicCaller(env.ANTHROPIC_API_KEY);
const embed = createOpenAIEmbedder(env.OPENAI_API_KEY);

const handle = startPollLoop({
  supabase,
  supabaseUrl: env.SUPABASE_URL,
  asrVendorApiKey: env.ASR_VENDOR_API_KEY,
  asrWebhookSecret: env.ASR_WEBHOOK_SECRET,
  callStructured,
  embed,
});
```

- [ ] **Step 4: Typecheck + run all worker tests**

```bash
pnpm -F worker typecheck
pnpm -F worker test
```

Expected: PASS. The existing pipeline tests do not exercise the new branch (they test handlers in isolation) so they should not regress.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipeline/run.ts apps/worker/src/index.ts
git commit -m "feat(slice-6): wire embedding handler into pipeline dispatch"
```

---

## Task 10: Worker — poll-loop logging for `embedded` outcomes

**Files:**

- Modify: `apps/worker/src/poll-loop.ts`

- [ ] **Step 1: Add the `case 'embedded'` log branch**

Find the `logOutcome` switch:

```ts
    case 'summarized':
      console.log(
        `worker tick ${new Date().toISOString()} summarized meeting=${outcome.meetingId}`,
      );
      return;
    case 'failed':
```

Insert a new case before `case 'failed':`:

```ts
    case 'summarized':
      console.log(
        `worker tick ${new Date().toISOString()} summarized meeting=${outcome.meetingId}`,
      );
      return;
    case 'embedded':
      console.log(
        `worker tick ${new Date().toISOString()} embedded meeting=${outcome.meetingId} segments=${outcome.segmentCount}`,
      );
      return;
    case 'failed':
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -F worker typecheck
```

Expected: PASS (exhaustive-switch check covers the new case).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/poll-loop.ts
git commit -m "feat(slice-6): log embedded outcomes in the worker tick"
```

---

## Task 11: Edge Function — `supabase/functions/search/index.ts`

**Files:**

- Create: `supabase/functions/search/index.ts`

The function structurally mirrors `asr-webhook` (env-from-Deno, Zod-validated body, `jsonResponse` helper, structured error responses). The two key differences:

1. JWT verification ENABLED at the gateway (the default for Edge Functions; do NOT add a `[functions.search]` `verify_jwt = false` block). Inside the function, forward the caller's `Authorization` header to the supabase-js client so PostgREST runs the `search_segments` RPC as the caller's role and Slice 5 RLS gates results.
2. Uses `SUPABASE_ANON_KEY` plus the forwarded JWT, not `SUPABASE_SERVICE_ROLE_KEY`. This is the user-facing pattern; service-role would bypass RLS and break tenant isolation.

The Edge Function's required env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENAI_API_KEY`) are set via `supabase secrets set` per the Dashlane-manual-sync workflow.

- [ ] **Step 1: Write the Edge Function**

Create `supabase/functions/search/index.ts`:

```ts
// Supabase Edge Function: user-facing hybrid search.
// Runs at: ${SUPABASE_URL}/functions/v1/search
//
// JWT verification is performed at the gateway (default Edge Function
// behavior — distinct from asr-webhook which sets verify_jwt = false in
// supabase/config.toml). The caller's JWT is forwarded to the
// supabase-js client below so PostgREST runs search_segments as the
// caller's role; Slice 5's membership-aware RLS gates the result set
// without policy duplication.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY. Set via
// `supabase secrets set` per the Dashlane manual-sync workflow
// (CLAUDE.md §6).

// @deno-types="npm:zod@3.23.8"
import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const DEFAULT_MATCH_COUNT = 20;
const MAX_MATCH_COUNT = 50;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  OPENAI_API_KEY: requireEnv('OPENAI_API_KEY'),
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`search: required env var ${name} is missing`);
  }
  return value;
}

const requestSchema = z.object({
  query: z.string().min(1).max(500),
  match_count: z.number().int().positive().max(MAX_MATCH_COUNT).optional(),
});

const openaiEmbeddingResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // Gateway-level JWT verification has already run. We still need the
  // header to forward downstream so PostgREST sees the caller's role.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`search: bad request: ${message}`);
    return jsonResponse({ error: 'bad_request' }, 400);
  }

  // Generate query embedding via OpenAI. Single retry-less attempt: the
  // user is sitting on the search page; failure surfaces as a 502 and the
  // page renders an error state.
  const oaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: payload.query,
    }),
  });
  if (!oaiResponse.ok) {
    const text = await oaiResponse.text().catch(() => '');
    console.error(`search: openai embed failed: ${oaiResponse.status} ${text}`);
    return jsonResponse({ error: 'embedding_failed' }, 502);
  }

  let embedding: number[];
  try {
    const json: unknown = await oaiResponse.json();
    const parsed = openaiEmbeddingResponseSchema.parse(json);
    embedding = parsed.data[0]!.embedding;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`search: openai response invalid: ${message}`);
    return jsonResponse({ error: 'embedding_invalid' }, 502);
  }

  // Forward the caller's JWT so search_segments runs as authenticated.
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pass the embedding as a pgvector text literal so PostgREST's typed-
  // parameter encoding does not need to know about vector.
  const queryEmbedding = `[${embedding.join(',')}]`;

  const { data, error } = await supabase.rpc('search_segments', {
    query_text: payload.query,
    query_embedding: queryEmbedding,
    match_count: payload.match_count ?? DEFAULT_MATCH_COUNT,
  });
  if (error) {
    console.error(`search: rpc failed: ${error.message}`);
    return jsonResponse({ error: 'search_failed' }, 500);
  }

  return jsonResponse({ results: data ?? [] }, 200);
});
```

- [ ] **Step 2: Verify the function's file structure matches `supabase functions deploy` expectations**

```bash
ls supabase/functions/search/
```

Expected: shows `index.ts` only. The Supabase CLI deploys one `index.ts` per function directory.

- [ ] **Step 3: Append the deploy step to the GitHub Action**

The existing `.github/workflows/deploy-edge-functions.yml` deploys `asr-webhook`. Open it.

```bash
cat .github/workflows/deploy-edge-functions.yml
```

Find the step:

```yaml
- name: Deploy asr-webhook
  run: supabase functions deploy asr-webhook --project-ref "$SUPABASE_PROJECT_REF"
```

Append:

```yaml
- name: Deploy search
  run: supabase functions deploy search --project-ref "$SUPABASE_PROJECT_REF"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/search .github/workflows/deploy-edge-functions.yml
git commit -m "feat(slice-6): add search Edge Function with JWT-forwarded RPC"
```

---

## Task 12: Web — search route page + supporting components

**Files:**

- Create: `apps/web/src/components/search-input.tsx`
- Create: `apps/web/src/components/search-result-card.tsx`
- Create: `apps/web/src/app/[publication]/search/page.tsx`
- Modify: `apps/web/src/components/segment-card.tsx`

The page is a server component. It reads `searchParams.q`, validates the user's membership in the publication via the existing `resolvePublication` helper (the membership-aware RLS policy returns `null` for non-members), and if `q` is present, invokes the `search` Edge Function via `supabase.functions.invoke()` which forwards the user's JWT automatically.

Empty `q` renders the input only. Non-empty `q` renders the input plus results.

The supporting components are created in dependency order: `SearchInput` and `SearchResultCard` first, then the page that imports them. The pre-existing `SegmentCard` gets an `id` attribute so the search-result deep link (`#segment-{id}`) lands in the right place.

- [ ] **Step 1: Write the `SearchInput` component**

A plain HTML GET-form. No `"use client"` directive — server-component default, the form submission re-renders the page with `?q=...` in the URL.

Create `apps/web/src/components/search-input.tsx`:

```ts
export function SearchInput({ defaultQuery }: { defaultQuery?: string }) {
  return (
    <form action="" method="GET" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={defaultQuery}
        placeholder="Search published meetings…"
        aria-label="Search query"
        className="flex-1 rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
      >
        Search
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write the `SearchResultCard` component**

Create `apps/web/src/components/search-result-card.tsx`:

```ts
import Link from 'next/link';

export interface SearchResult {
  segment_id: string;
  meeting_id: string;
  publication_slug: string;
  town_slug: string;
  town_name: string;
  board_slug: string;
  board_name: string;
  meeting_title: string | null;
  meeting_date: string | null;
  segment_title: string;
  segment_description: string;
  marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
  transcript_excerpt: string;
  start_time_seconds: number;
  rrf_score: number;
}

const MARKER_LABEL: Record<SearchResult['marker_type'], string> = {
  AGENDA_ITEM: 'Agenda item',
  PUBLIC_COMMENT: 'Public comment',
  DISCUSSION: 'Discussion',
  VOTE: 'Vote',
  PROCEDURE: 'Procedure',
};

const SNIPPET_MAX_LEN = 280;

function snippet(text: string): string {
  return text.length > SNIPPET_MAX_LEN ? `${text.slice(0, SNIPPET_MAX_LEN).trimEnd()}…` : text;
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  const href =
    `/${result.publication_slug}/${result.town_slug}/${result.board_slug}/${result.meeting_id}` +
    `#segment-${result.segment_id}`;
  return (
    <article className="rounded border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {result.town_name} / {result.board_name}
        {result.meeting_date ? ` · ${result.meeting_date}` : ''}
      </p>
      <Link href={href} className="mt-1 block">
        <span className="font-semibold text-blue-700 hover:underline">
          {result.meeting_title ?? '(untitled)'} — {result.segment_title}
        </span>
      </Link>
      <p className="mt-1 text-xs">
        <span className="rounded bg-slate-100 px-2 py-0.5 uppercase tracking-wide text-slate-700">
          {MARKER_LABEL[result.marker_type]}
        </span>
      </p>
      <p className="mt-2 text-sm text-slate-700">{snippet(result.transcript_excerpt)}</p>
    </article>
  );
}
```

- [ ] **Step 3: Write the search page**

Create `apps/web/src/app/[publication]/search/page.tsx`:

```ts
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication } from '@/lib/resolvers.js';
import { SearchInput } from '@/components/search-input.js';
import { SearchResultCard, type SearchResult } from '@/components/search-result-card.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const DEFAULT_MATCH_COUNT = 20;
const SHOW_MORE_MATCH_COUNT = 50;

interface InvokeResponse {
  results?: SearchResult[];
  error?: string;
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ publication: string }>;
  searchParams: Promise<{ q?: string; more?: string }>;
}) {
  const { publication: pSlug } = await params;
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const matchCount = sp.more === '1' ? SHOW_MORE_MATCH_COUNT : DEFAULT_MATCH_COUNT;

  const supabase = await getSupabaseServerClient();
  const publication = await resolvePublication(supabase, pSlug);
  if (!publication) notFound();

  let results: SearchResult[] = [];
  let errorMessage: string | null = null;
  if (query.length > 0) {
    const { data, error } = await supabase.functions.invoke<InvokeResponse>('search', {
      body: { query, match_count: matchCount },
    });
    if (error) {
      errorMessage = error.message || 'Search failed';
    } else {
      results = data?.results ?? [];
    }
  }

  const showMoreHref =
    query.length > 0 && results.length === DEFAULT_MATCH_COUNT && sp.more !== '1'
      ? `/${publication.slug}/search?q=${encodeURIComponent(query)}&more=1`
      : null;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-slate-500">
        <Link href={`/${publication.slug}`} className="hover:underline">
          {publication.name}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold">Search</h1>
      <div className="mt-4">
        <SearchInput defaultQuery={query} />
      </div>

      {query.length === 0 && (
        <p className="mt-8 text-slate-500">Enter a query to search published meetings.</p>
      )}

      {errorMessage && (
        <div className="mt-8 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Search failed: {errorMessage}.{' '}
          <Link
            href={`/${publication.slug}/search?q=${encodeURIComponent(query)}`}
            className="underline"
          >
            Retry
          </Link>
        </div>
      )}

      {query.length > 0 && !errorMessage && results.length === 0 && (
        <p className="mt-8 text-slate-500">No segments matched. Try different keywords.</p>
      )}

      {results.length > 0 && (
        <section className="mt-8 space-y-4">
          {results.map((r) => (
            <SearchResultCard key={r.segment_id} result={r} />
          ))}
        </section>
      )}

      {showMoreHref && (
        <p className="mt-6">
          <Link href={showMoreHref} className="text-blue-700 hover:underline">
            Show more
          </Link>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Wire the anchor target on `SegmentCard`**

The `SearchResultCard` `href` ends with `#segment-${result.segment_id}`. The existing `SegmentCard` (`apps/web/src/components/segment-card.tsx`) renders the segment as a bare `<article>` with no id, so a browser jump from search results to `/...//${meeting.id}#segment-${segment.id}` would land at the page top. Add the anchor.

Find in `apps/web/src/components/segment-card.tsx`:

```tsx
    <article className="rounded border border-slate-200 p-4">
```

Replace with:

```tsx
    <article id={`segment-${segment.id}`} className="rounded border border-slate-200 p-4">
```

- [ ] **Step 5: Typecheck the web app**

```bash
pnpm -F web typecheck
```

Expected: PASS. If `supabase.functions.invoke` complains about the result type, the inline `<InvokeResponse>` generic resolves it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/search-input.tsx apps/web/src/components/search-result-card.tsx apps/web/src/app/\[publication\]/search apps/web/src/components/segment-card.tsx
git commit -m "feat(slice-6): add reader search route with hybrid results"
```

---

## Task 13: Web — surface search entry on the publication page

**Files:**

- Modify: `apps/web/src/app/[publication]/page.tsx`

- [ ] **Step 1: Add the search link between the heading and the towns list**

`Link` is already imported from `next/link` (the existing page uses it for the town tiles). Find:

```tsx
      <h1 className="text-3xl font-bold">{publication.name}</h1>
      <ul className="mt-6 space-y-2">
```

Replace with:

```tsx
      <h1 className="text-3xl font-bold">{publication.name}</h1>
      <p className="mt-2">
        <Link
          href={`/${publication.slug}/search`}
          className="text-blue-700 hover:underline"
        >
          Search this publication →
        </Link>
      </p>
      <ul className="mt-6 space-y-2">
```

- [ ] **Step 2: Typecheck and run the web app locally**

```bash
pnpm -F web typecheck
pnpm -F web dev
```

In a browser: navigate to `/{your-publication-slug}` → click "Search this publication" → empty input page renders → type a query → see results render. Verify the empty-state, no-results, and a few-results paths.

If `OPENAI_API_KEY` is not yet provisioned in the Supabase Edge Function env, this manual check returns the `502 embedding_failed` error state. That is expected pre-secret-set; document it in the commit message and proceed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\[publication\]/page.tsx
git commit -m "feat(slice-6): link to search route from publication page"
```

---

## Task 14: Backfill script — `apps/worker/scripts/backfill-embeddings.ts`

**Files:**

- Create: `apps/worker/scripts/backfill-embeddings.ts`
- Modify: `apps/worker/package.json`

One-shot. Reads cloud Supabase service-role credentials from `apps/worker/.env.local`. Queries segments with `embedding IS NULL` joined to `meetings WHERE status = 'published'`. Writes per-segment embeddings via direct UPDATE (NOT via `complete_embedding`, which expects the `embedding_inflight` state-machine path). No status transition — backfill is for rows that already published before the new pipeline existed. Re-running is a no-op.

- [ ] **Step 1: Write the script**

Create `apps/worker/scripts/backfill-embeddings.ts`:

```ts
import { createServiceClient } from '@duly-noted/db';
import { buildEmbeddingInput } from '@duly-noted/shared';
import { loadEnv } from '../src/env.js';
import { createOpenAIEmbedder } from '../src/embedding/openai.js';

/**
 * One-shot backfill for segments whose parent meetings are already
 * published but whose embedding column is NULL. Reads cloud credentials
 * from .env.local. Generates one embedding per segment via OpenAI and
 * writes it via direct UPDATE — NOT via complete_embedding, which assumes
 * the state-machine path (embedding_inflight -> published) and would
 * fail-loud against an already-published row.
 *
 * Idempotent. Re-running against a fully-backfilled corpus prints "no
 * segments need backfill" and exits 0.
 *
 * Batches inputs in groups of 100 — well under the OpenAI 2048-input-per-
 * call cap; aligns with the AssemblyAI per-call quota practice elsewhere.
 *
 * Invoke with: pnpm -F worker backfill:embeddings
 */

const BATCH_SIZE = 100;

interface SegmentRow {
  id: string;
  title: string;
  description: string;
  transcript_excerpt: string;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const embed = createOpenAIEmbedder(env.OPENAI_API_KEY);

  // Fetch only the segments that need work. The !inner join scopes to
  // published-meeting segments.
  const { data: rawRows, error } = await supabase
    .from('segments')
    .select('id, title, description, transcript_excerpt, meetings!inner(status)')
    .is('embedding', null)
    .eq('meetings.status', 'published')
    .order('id', { ascending: true });
  if (error) {
    throw new Error(`segments fetch failed: ${error.message}`);
  }
  const rows = (rawRows ?? []) as unknown as SegmentRow[];
  if (rows.length === 0) {
    console.log('backfill-embeddings: no segments need backfill');
    return;
  }
  console.log(`backfill-embeddings: ${rows.length} segments queued`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((s) =>
      buildEmbeddingInput({
        title: s.title,
        description: s.description,
        transcript_excerpt: s.transcript_excerpt,
      }),
    );
    const embeddings = await embed(inputs);
    if (embeddings.length !== batch.length) {
      throw new Error(
        `batch ${i / BATCH_SIZE}: expected ${batch.length} vectors, got ${embeddings.length}`,
      );
    }
    for (let j = 0; j < batch.length; j += 1) {
      const seg = batch[j]!;
      const vec = embeddings[j]!;
      const literal = `[${vec.join(',')}]`;
      const { error: upErr } = await supabase
        .from('segments')
        .update({ embedding: literal })
        .eq('id', seg.id);
      if (upErr) {
        throw new Error(`update failed for segment ${seg.id}: ${upErr.message}`);
      }
    }
    console.log(
      `backfill-embeddings: processed ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`,
    );
  }

  console.log('backfill-embeddings: done');
}

await main();
```

- [ ] **Step 2: Add the package script**

Find in `apps/worker/package.json`:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch --env-file=.env.local src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
```

Replace with:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch --env-file=.env.local src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "backfill:embeddings": "tsx --env-file=.env.local scripts/backfill-embeddings.ts"
  },
```

- [ ] **Step 3: Verify the script typechecks**

```bash
pnpm -F worker typecheck
```

Expected: PASS. If `tsc` does not include `scripts/` by default, the worker `tsconfig.json` needs to include it. Inspect:

```bash
cat apps/worker/tsconfig.json
```

If `include` is set to `["src"]`, extend it to `["src", "scripts"]`. If `include` is omitted (TS picks everything under `rootDir`), no change. Confirm by re-running typecheck.

- [ ] **Step 4: Lint**

```bash
pnpm -F worker lint
```

If `eslint src` does not cover scripts, update the lint script:

```json
"lint": "eslint src scripts",
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/scripts/backfill-embeddings.ts apps/worker/package.json apps/worker/tsconfig.json
git commit -m "feat(slice-6): add embeddings backfill script"
```

---

## Task 15: Render env + secrets matrix

**Files:**

- Modify: `render.yaml`

Per CLAUDE.md §6: `OPENAI_API_KEY` lives only on `apps/worker` and the `supabase/functions/search` Edge Function. Not on Cloudflare Pages. Not on `apps/worker-cron`.

- [ ] **Step 1: Add `OPENAI_API_KEY` to the `duly-noted-worker` envVarGroup**

Find in `render.yaml`:

```yaml
- name: duly-noted-worker
  envVars:
    - key: ASR_VENDOR_API_KEY
      sync: false
    - key: ASR_WEBHOOK_SECRET
      sync: false
```

Replace with:

```yaml
- name: duly-noted-worker
  envVars:
    - key: ASR_VENDOR_API_KEY
      sync: false
    - key: ASR_WEBHOOK_SECRET
      sync: false
    - key: OPENAI_API_KEY
      sync: false
```

Verify the matrix comment block above the `envVarGroups:` line. Find:

```yaml
# Per SPEC.md Stage 1 secrets matrix:
#   - duly-noted-shared: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   - duly-noted-worker: ASR_VENDOR_API_KEY, ASR_WEBHOOK_SECRET
#   - duly-noted-cron:   YOUTUBE_API_KEY
# The cron must NOT see ASR_VENDOR_API_KEY; the worker must NOT see YOUTUBE_API_KEY.
```

Replace with:

```yaml
# Per SPEC.md Stage 1 secrets matrix (Slice 6 update):
#   - duly-noted-shared: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   - duly-noted-worker: ASR_VENDOR_API_KEY, ASR_WEBHOOK_SECRET, OPENAI_API_KEY
#   - duly-noted-cron:   YOUTUBE_API_KEY
# The cron must NOT see ASR_VENDOR_API_KEY or OPENAI_API_KEY; the worker
# must NOT see YOUTUBE_API_KEY. ANTHROPIC_API_KEY is provisioned via the
# Render dashboard separately (it is not currently declared in
# render.yaml — Slice 4 carryover).
```

- [ ] **Step 2: Verify the YAML is well-formed**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('render.yaml')); print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add render.yaml
git commit -m "feat(slice-6): provision OPENAI_API_KEY on worker env group"
```

- [ ] **Step 4: Edge Function secret note (manual step at deploy time)**

After this PR merges and the migrate workflow has applied the migration, run (locally with the Supabase access token):

```bash
supabase secrets set OPENAI_API_KEY=<value> --project-ref <ref>
supabase secrets set SUPABASE_ANON_KEY=<value> --project-ref <ref>  # if not already set
```

These are not Codified in `render.yaml`; they live in Supabase's secrets store. The Dashlane source-of-truth workflow drives the values; this step is the manual sync per CLAUDE.md §2.

Document this in the PR description.

---

## Task 16: ADR 0020 — supersede

**Files:**

- Modify: `docs/adr/0020-reader-ui-ships-without-search.md`

- [ ] **Step 1: Inspect the current status line**

```bash
head -5 docs/adr/0020-reader-ui-ships-without-search.md
```

- [ ] **Step 2: Update the status**

Find the status line (it will be near the top, format `- Status: Accepted` or similar). Change it to:

```
- Status: Superseded by Slice 6
```

Below the status, append a one-line note pointing at the supersedence (immediately following the existing date/slice/header lines, before the body):

```
- Superseded by: docs/superpowers/plans/2026-05-11-slice-6-hybrid-search.md, ADR 0021, ADR 0022.
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0020-reader-ui-ships-without-search.md
git commit -m "docs(adr-0020): mark superseded by Slice 6"
```

---

## Task 17: Final verification

- [ ] **Step 1: Run the full repo gate**

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r lint && pnpm format:check
```

Expected: all four pass. This is the CLAUDE.md §5 "before declaring a task done" gate.

If any gate fails:

- typecheck: investigate the specific package; the most likely failure is the `packages/db/src/types.ts` shape not matching how a consumer destructures the new RPC return. Adjust the type to match observed usage.
- test: rerun with `--reporter=verbose` to locate the failing case.
- lint: address per ESLint output. Do not bypass with `eslint-disable` unless the rule is provably misfiring.
- format: `pnpm format` to auto-fix.

- [ ] **Step 2: Manual smoke test against the local Supabase stack (if available)**

```bash
supabase start
supabase db reset    # applies all migrations including the new one
supabase functions serve search
```

In a separate terminal:

```bash
# Capture an authenticated user's JWT (use the project's login flow or
# supabase.auth.signInWithOtp via a scratch script).
JWT=...

curl -X POST http://127.0.0.1:54321/functions/v1/search \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"budget","match_count":5}'
```

Expected: `{"results": [...]}` shaped per the RPC return. Likely empty on a fresh `db reset` (no published meetings); the empty array confirms the path works.

If `supabase` CLI is not installed locally (per the existing config.toml header), skip this step and rely on the CI deploy + a post-deploy smoke check via the web UI.

- [ ] **Step 3: Run the audit skill via the user's `/code-audit` invocation**

The build brief ends with: "Audit prompt covering schema deltas, RPC SECURITY DEFINER and RLS interplay, vendor key isolation, Edge Function JWT enforcement, and reader UI happy/sad paths." The `code-audit` skill already covers all of these (SPEC compliance, CLAUDE.md compliance, schema and tenant integrity, dead code, migration safety, hallucination check), and is what the project runs after each slice (see `docs/audits/` for prior outputs).

Hand off to the user with: "Slice 6 ready for audit — invoke `/code-audit`."

---

## Notes on rejected approaches and known footguns

**Why `claim_embedding_meeting` returns `(id, segments jsonb)` rather than `(id)` + a separate query:** SPEC §"Slice 6 schema deltas" line 567 specifies "the segments JOIN is the only addition" relative to Slice 4's claim RPC. The jsonb-aggregate shape implements that literally. The alternative — keep the RPC narrow and query segments separately in the handler — would be simpler but contradicts the SPEC. Tradeoff resolved in favor of the SPEC's wording.

**Why the embedding is passed to PostgREST as a `'[1,2,3]'` text literal (Edge Function) and as a flat array of floats (backfill direct UPDATE):** pgvector accepts both shapes when typed correctly. Text-literal form avoids edge cases in supabase-js's typed-parameter encoding for the `extensions.vector` type. The backfill writes the same text-literal form to `segments.embedding` via direct UPDATE, which PostgREST passes through unchanged.

**Why `verify_jwt` is left at the default for `search`:** `asr-webhook` sets it false because it is a vendor callback with header-based auth. `search` is user-facing; the gateway's JWT check is the first line of defense. Setting `verify_jwt = false` would push authentication entirely into the function body — easy to forget on a future edit. Default-on is the safer posture and matches the CLAUDE.md §6 distinction "user-facing Edge Functions ... keep JWT verification ENABLED."

**Why `search_segments` is NOT `SECURITY DEFINER`:** Per CLAUDE.md §6 and ADR 0021, the RPC runs as the caller so Slice 5's membership-aware RLS gates the result set. `SECURITY DEFINER` would bypass RLS and break tenant isolation. The worker-side claim/complete/abandon trio uses `SECURITY DEFINER` because the worker is service-role and the policy boundary is irrelevant.

**Why no automatic retry on `failed` rows:** CLAUDE.md §7 lock. Manual reset is the documented recovery path; the embedding stage inherits the same posture as segmentation and summarization.

**Why no `auto_chapters` / `summarization` / etc. on AssemblyAI side — re-affirmed:** Slice 4 owns summarization via Anthropic; Slice 6 owns embeddings via OpenAI. Vendor add-ons remain locked off (CLAUDE.md §7, ADR 0010).
