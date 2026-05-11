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
