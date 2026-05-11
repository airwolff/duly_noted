# 0021 — Hybrid search via Postgres FTS + pgvector + SQL RRF

- Status: Accepted
- Date: 2026-05-11
- Slice: 6

## Context

The locked product decision specifies "keyword + semantic search." Slice 6 lifts the gate held open by ADR 0020 and ships search.

Eight candidate implementations were researched pre-Slice-1 (`kb_search-implementation_S1` through `S8`): Postgres native FTS (S1), pgvector + OpenAI embeddings (S2), pgvector + open-source embeddings (S3), hybrid Postgres BM25 + pgvector (S4 — ParadeDB / `pg_search` / RRF), Meilisearch (S5), Typesense (S6), Elasticsearch (S7), Weaviate (S8).

The Slice 5 → Slice 6 handoff identified S4 as "most aligned with existing stack constraints." Verification against the KB and the Supabase + ParadeDB partner documentation surfaced the actual constraint: ParadeDB cannot run as a native extension on Supabase managed Postgres. The supported integration is logical replication from Supabase to a separately-deployed ParadeDB instance acting as a read-only search replica. The Supabase developer community has captured the operational cost of that path explicitly — logical replication crosses the RLS boundary, and Slice 5 just landed membership-aware RLS as the tenant boundary. A separate ParadeDB instance does not inherit Supabase's RLS engine; reimplementing the membership JOIN on the replica adds a parallel auth surface that diverges from the system of record.

The other six candidates either fail one or both of the constraint requirements (keyword + semantic search, no new infrastructure surface beyond Supabase/Render).

## Considered options

- **S1 + S2 + SQL RRF (chosen).** Postgres native FTS via `tsvector` GIN and `ts_rank_cd`; pgvector with OpenAI `text-embedding-3-small`; Reciprocal Rank Fusion as a stored procedure. The pattern is documented at `supabase.com/docs/guides/ai/hybrid-search` and is what Supabase itself recommends for this shape of workload.
- **S4 ParadeDB via logical replication.** Better lexical algorithm (BM25 with TF/IDF) at the cost of (a) a separate ParadeDB deployment, (b) reimplementing the membership-aware RLS join in a parallel auth surface, (c) cross-system synchronization concerns. At v1 corpus scale (~24 meetings/year, one board, low-hundreds of segments), BM25's lexical advantage over `ts_rank_cd` is not measurable.
- **S3 self-hosted open-source embeddings.** Saves ~$0.01 lifetime in embedding cost at v1 scale and adds Render compute for inference (additional service, additional moving part). Not worth the operational surface.
- **S5–S8 external vector / search services (Meilisearch, Typesense, Elasticsearch, Weaviate).** Each adds a separate service, separate persistence, separate auth, separate ops. None earn their keep at v1 scale.
- **Lexical-only (S1).** Misses semantic queries entirely. Violates the locked product decision.
- **Semantic-only (S2).** Misses exact-phrase queries that lexical handles cleanly (e.g., proper nouns, board names, statute citations).

## Decision

Slice 6 ships hybrid search as:

- **Lexical arm:** Postgres native FTS on `segments`. Generated stored column `search_tsv tsvector` with weighted `to_tsvector('english', ...)` over `title` (A), `description` (B), and `transcript_excerpt` (C). GIN index. `ts_rank_cd` for cover-density (proximity-aware) ranking.
- **Semantic arm:** `segments.embedding extensions.vector(1536)` populated from OpenAI `text-embedding-3-small` (see ADR 0022 for the model and Edge-Function-mediated query embedding decision). HNSW index with `vector_cosine_ops`.
- **Fusion:** Reciprocal Rank Fusion in a stored procedure `search_segments(query_text, query_embedding, match_count, full_text_weight, semantic_weight, rrf_k)`. Formula `score_i = weight_i / (rrf_k + rank_i)` summed across the two arms, ordered descending.

The lexical-arm dimension choice of native 1536 (rather than Matryoshka truncation to 512 per Supabase's example) is intentional: at v1 corpus size, storage and ANN-query-time savings are immaterial; quality preservation matters because retrieval misses on a newsroom-grade surface are user-visible. Future tuning lever if corpus grows past ~50k segments: re-embed with `dimensions: 512` and rebuild the HNSW index.

## Consequences

**Accepted:**

- One stack, one persistence layer, one auth boundary. Existing membership-aware RLS on `segments` (Slice 5) governs search results without policy duplication.
- The `search_segments` RPC runs with the caller's role, so RLS gating works without `SECURITY DEFINER`. The Edge Function passes through the user's JWT; the RPC runs as `authenticated`.
- Cost at v1 scale is negligible (<$0.01 lifetime backfill + ~$0.000002 per query).
- The pattern is canonical Supabase and the documented reference RPC is the starting point.

**Risks:**

- `ts_rank_cd` is not as principled a relevance signal as BM25 at scale. At v1 the corpus is small enough that this is invisible; at ~50k+ segments per board, the lexical arm may underperform. Mitigation: if quality degrades, the migration path to S4 ParadeDB via logical replication exists — but at that scale the project's auth posture has likely also changed and the RLS-on-replica problem is a separate, larger decision.
- pgvector HNSW build time scales with row count and dimensions. At 1536 dims, builds against tens of thousands of vectors stay sub-minute. Not a v1 concern.
- The semantic arm depends on OpenAI availability. Embedding-stage failures park rows at `failed` per CLAUDE.md §7 no-auto-retry rule. Manual reset reruns the stage.

**Revisit trigger:**

- Corpus grows past ~50k segments per board AND search-quality user feedback indicates lexical-arm underperformance.
- A second tenant onboards AND that tenant's corpus is materially larger than the first (cross-tenant search remains out of scope).
- ParadeDB ships a native in-Supabase extension path (eliminating the RLS-on-replica problem). Reconsider on that announcement.

## Alternatives considered

- **S4 ParadeDB via logical replication.** Rejected: loses RLS gating that Slice 5 built, and the membership boundary is the system's only tenant-isolation mechanism. Reimplementing it on a replica is a regression of foundational work.
- **S3 self-hosted open-source embeddings.** Rejected: trivially cheaper but adds a service to ops. Not worth it at v1.
- **External vector DB (Pinecone, Weaviate, Qdrant, etc.).** Rejected: another service, another auth surface, another deploy. Hybrid lives in one place: Postgres.
- **Defer search further.** Rejected: locked product decision specifies search; Slice 5 already deferred it once.

## Reference

- Supabase hybrid-search documentation: `supabase.com/docs/guides/ai/hybrid-search` (canonical reference pattern this slice follows).
- Project KB: `kb_search-implementation_S1-postgres-fts_2026-04-29_v1.xml`, `kb_search-implementation_S2-pgvector-supabase-openai_2026-04-29_v1.xml`, `kb_search-implementation_S4-hybrid-postgres-bm25-vector_2026-04-29_v1.xml` (and S3, S5–S8 for the rejected alternatives).
- Supabase + ParadeDB integration documentation: `supabase.com/partners/paradedb`.
- Supabase community discussion on RLS loss in logical replication: github.com/orgs/supabase/discussions/18061.
