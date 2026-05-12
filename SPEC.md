# SPEC.md — Stage 1: Foundation and Stack

## Deployment topology

Four surfaces:

- **Cloudflare Pages** — Next.js (App Router) web app at `dulynoted.report`. Stateless. Reader UI and admin UI. No webhook receivers, no long-running compute.
- **Supabase Pro** — Postgres (data, RLS, pgvector), Auth (magic link), Storage (audio + transcript artifacts), and Edge Functions (Deno runtime) for vendor webhook receivers and user-facing API endpoints (e.g. search).
- **Render** — `apps/worker` Background Worker (Starter, $7/mo) running the ingestion and pipeline state machine; `apps/worker-cron` Cron Job ($1/mo) discovering new YouTube uploads hourly.
- **AssemblyAI** — managed ASR vendor, Universal-3 Pro tier. Receives signed Supabase Storage URLs; calls back to a Supabase Edge Function on completion.
- **OpenAI** — embedding-model vendor (`text-embedding-3-small`, 1536 dims). Called from `apps/worker` for index-time embedding generation; called from `supabase/functions/search` for query-time embedding generation. Not called from the web app.

Postgres is the queue. The Render worker advances meeting state by polling rows on `meetings.status`; no Redis, SQS, or external queue at v1.

## Background job architecture

State machine on `meetings.status`:

```
discovered → pending → extracting → transcribing → segmenting → summarizing → embedding → published
                                                                                       ↘  failed
```

The `review` enum slot is reserved for the future operator review UI slice (Backlog B4) and slots between `embedding` and `published` in the enum ordering; no row sits in `review` at v1.

- **Cron Job** writes new `discovered` rows from YouTube Data API responses, filtered by per-board `ingest_since_days` horizon (default 365), then auto-promotes to `pending` based on per-board title pattern + minimum duration.
- **Worker** picks up `pending` rows with `SELECT ... FOR UPDATE SKIP LOCKED`, runs `yt-dlp` to extract audio, uploads to Supabase Storage, submits a signed Storage URL to AssemblyAI, and parks the row at `transcribing`.
- **Supabase Edge Function** (`asr-webhook`) receives the AssemblyAI callback, verifies the `X-DulyNoted-Webhook` auth header, fetches the full transcript JSON from AssemblyAI, writes the artifact to Storage, advances state to `segmenting`. The Edge Function is the only surface that holds both `ASR_VENDOR_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` simultaneously; this is the architecturally chosen surface for the receiver.
- **Worker** picks up `segmenting` rows, runs the LLM segmentation pass, advances to `summarizing`. Picks up `summarizing` rows, runs the meeting-summary pass, advances to `embedding`. Picks up `embedding` rows, generates per-segment embeddings via OpenAI, advances to `published`.

Failure semantics: any step that errors writes `status = 'failed'`, a `last_error` field, and `failed_at`; the worker re-polls `failed` rows only on manual reset (no automatic retry storms). Worker invocations are idempotent — picking up the same row twice never double-charges any vendor or double-writes a segment or embedding.

Transient inflight states (`chaptering`, `summarizing_inflight`, `embedding_inflight`) provide the claim/complete semaphore for each LLM- or embedding-call stage. They are implementation detail; the diagram above shows only the public states.

## Repo structure

Monorepo, pnpm workspaces.

```
duly-noted/
├── apps/
│   ├── web/            # Next.js 14+ App Router → Cloudflare Pages
│   ├── worker/         # Node/TS Background Worker → Render (custom Dockerfile)
│   └── worker-cron/    # Node/TS Cron Job → Render
├── packages/
│   ├── db/             # Supabase types, client factories, migrations
│   └── shared/         # Domain types, prompt templates, segmentation schemas
├── supabase/
│   ├── migrations/     # SQL migrations
│   ├── functions/      # Edge Functions (Deno) — vendor webhook receivers, user-facing API
│   ├── seed.sql        # Local + smoke-test seed data
│   └── config.toml
├── .github/workflows/  # CI
├── pnpm-workspace.yaml
├── package.json
└── CLAUDE.md
```

Turborepo is **not** added at v1. Migration path is documented and ~30 minutes when CI runtime warrants it.

## Environment and secrets

Source of truth: Dashlane vault. No secrets in any repo.

> **Matrix scope:** This table documents the _target v1 topology_ — the full
> set of keys each surface will require when all stages are complete. Keys are
> added to a surface's Zod env schema only in the slice that introduces the
> consuming code. `ANTHROPIC_API_KEY` enters the worker's Zod env schema in
> Slice 3 (segmentation pipeline; see Stage 4 below) and is reused in Slice 4
> (summarization; see Stage 6 below) without further env changes.
> `OPENAI_API_KEY` enters the worker's Zod env schema and the Edge Function's
> env in Slice 6 (embedding pipeline + search query embedding; see Stage 9 below).

Per-surface secret list:

| Secret                          | Cloudflare Pages | Render Worker | Render Cron | Supabase Edge Function  |
| ------------------------------- | ---------------- | ------------- | ----------- | ----------------------- |
| `SUPABASE_URL`                  | —                | yes           | yes         | yes (built-in)          |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes              | —             | —           | —                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes              | —             | —           | —                       |
| `SUPABASE_SERVICE_ROLE_KEY`     | —                | yes           | yes         | yes (built-in)          |
| `YOUTUBE_API_KEY`               | —                | —             | yes         | —                       |
| `ASR_VENDOR_API_KEY`            | —                | yes           | —           | yes (`asr-webhook`)     |
| `ANTHROPIC_API_KEY`             | —                | yes (Slice 3) | —           | —                       |
| `OPENAI_API_KEY`                | —                | yes (Slice 6) | —           | yes (`search`, Slice 6) |
| `ASR_WEBHOOK_SECRET`            | —                | yes           | —           | yes (`asr-webhook`)     |

`ASR_WEBHOOK_SECRET` is set on the Render worker (which injects it as the `webhook_auth_header_value` in AssemblyAI submit calls) and on the Supabase Edge Function (which verifies the inbound `X-DulyNoted-Webhook` header against it). Cloudflare Pages does not touch the webhook flow.

`OPENAI_API_KEY` is set on the Render worker (which uses it for per-segment embedding generation during the `embedding` pipeline stage) and on the `search` Edge Function (which uses it for query-time embedding generation on behalf of authenticated users). Cloudflare Pages does not hold it; the web app calls the `search` Edge Function and never the OpenAI API directly.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are exposed automatically inside Edge Functions via `Deno.env.get('SUPABASE_URL')` and `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`; no manual secret-set required for those two.

Every app validates its env at startup with Zod and fails loudly. `.env.example` is checked in with placeholders and kept in sync as new keys are added. `.env.local` is gitignored.

## CI/CD

- **Cloudflare Pages**: git integration on `main`. Preview deploys on PRs serve as the only non-prod environment.
- **Render Worker + Cron**: git integration on `main`. Both services redeploy on any push to `main`; path-based deploy filtering is not configured. Acceptable at v1 — Render Starter bills monthly, not per-deploy, and worker-cron's scheduled invocation absorbs mid-deploy restarts. The worker uses a custom `apps/worker/Dockerfile` (yt-dlp + ffmpeg).
- **Supabase Edge Functions**: deployed via `supabase functions deploy <name>` from a GitHub Action on merge to `main`. Secrets set out-of-band via `supabase secrets set`.
- **GitHub Actions** runs on every PR: install (frozen lockfile), typecheck across workspaces, lint, test.
- **Migrations**: Supabase CLI run from a GitHub Action on merge to `main`, in parallel with Render's auto-deploy. Migrations are forward-only and must be backwards-compatible with the previously deployed worker — additive changes (new columns, new tables, new indexes) deploy ahead of the code that reads them; destructive changes (drop column, drop table, narrow constraint) follow the expand/contract pattern across multiple deploys, with the destructive step landing only after no running code references the old structure. With backwards-compatibility as the substantive guarantee, the migrate workflow's parallelism with Render's auto-deploy is acceptable: the worker tolerates a brief window where new code runs against the pre-migration schema (additive case) or where post-migration schema is read by old code (destructive case, mid-expand). Rollback is by writing a forward migration that undoes. Tightening to enforced migration-before-deploy ordering (deploy hook, concurrency gate, or worker-side migration-version check) is a Slice 2 concern only if a specific change cannot be expressed as a backwards-compatible step.
- **Branch strategy**: trunk-based on `main`. No `develop`, no `staging`.

## Fixed cost (Stage 1 surface)

| Line                               | Monthly  | Annual    |
| ---------------------------------- | -------- | --------- |
| Cloudflare Pages                   | $0       | $0        |
| Supabase Pro                       | $25      | $300      |
| Render Background Worker (Starter) | $7       | $84       |
| Render Cron Job                    | ~$1      | ~$12      |
| Domain (dulynoted.report)          | ~$1      | ~$12      |
| **Total fixed**                    | **~$34** | **~$408** |

Variable cost (ASR, LLM, embeddings, egress) is set in Stages 2, 4, 6, 9.

## Changelog note for KB

`kb_civic-sunlight-mvp-cost-model_2026-04-29_v1.xml` is built on a Vercel + Supabase Pro assumption. The Stage 1 decision moves hosting to Cloudflare Pages and adds a Render line. Net annual fixed cost moves from ~$540/yr to ~$408/yr. The model's CONFLICT-06 (Vercel ToS) and SS-03 are no longer load-bearing. CONFLICT-07 (Supabase Pro inactivity pause) still binds. The cost model file remains the authoritative reference for ASR and LLM lines, with the additional ASR-vendor binding established in Stage 2 and the embedding-vendor binding established in Stage 9.

**Locked decisions:** see ADR 0001 (Render Background Worker for the pipeline) and ADRs 0002–0007 for the remaining Stage 1 decisions.

**Open items inherited by later stages:**

- ~~Stage 2: ASR vendor selection~~ — closed in Stage 2 below.
- ~~Stage 3: audio extraction path~~ — closed in Stage 3 below.
- ~~Stage 4: segmentation methodology~~ — closed in Stage 4 below.
- ~~Operator review step inclusion sets the `review` state semantics.~~ — closed: v1 auto-advances `summarizing → embedding → published` directly (Slice 6). Operator review gate deferred (Backlog B4).
- Stage 5: full DDL for `meetings.status` enum, including index and constraint design (pass 2). Slice 2/3/4/6 deltas in Stage 5 below cover the ingest+segmentation+summarization+search-load-bearing subset; pass 2 still pending.

---

# Stage 2 — ASR vendor

**Vendor: AssemblyAI Universal-3 Pro.** $0.21/hr at 2026-05 list pricing, diarization included in base rate. English-primary; six-language support sufficient for Maine municipal meetings. Universal-3 Pro selected over Universal-2 ($0.15/hr) for accent, rare-word, and alphanumeric accuracy. The $0.06/hr premium is acceptable cost for the quality delta.

**ToS posture.** AssemblyAI ToS §4.3 grants AssemblyAI a license to train on customer audio with plan-conditional opt-out. Opt-out is by email request to `data-opt-out@assemblyai.com` from the account-tied address; written confirmation establishes the forward-looking effective timestamp. Confirmation must land before the first ASR submission of any kind, including dev/testing.

- Opt-out request sent: 2026-05-07
- Opt-out confirmation received: pending — update this line with the confirmation date when received

**Submit pattern.** Async with webhook callback, called from `apps/worker`:

- `POST https://api.assemblyai.com/v2/transcript`
- Body: `{ audio_url, speaker_labels: true, speech_models: ['universal-3-pro'], webhook_url, webhook_auth_header_name: "X-DulyNoted-Webhook", webhook_auth_header_value: ASR_WEBHOOK_SECRET }`. Required by AssemblyAI's current API; submits without `speech_models` return 400 with `"speech_models" must be a non-empty list`.
- `audio_url` is a Supabase Storage signed URL with 1-hour TTL
- `webhook_url` points at the Supabase Edge Function: `https://{project-ref}.supabase.co/functions/v1/asr-webhook`
- `auto_chapters` is **disabled**. Known SINGLE-SOURCE risk of silent 500s on Universal-3 Pro; chapter generation is downstream Stage 4 work using our own LLM pipeline.
- Other premium add-ons (`sentiment_analysis`, `content_safety`, `iab_categories`, vendor-side `summarization`) are also disabled at v1.

The submit response contains `transcript_id`. The worker writes this to `meetings.asr_transcript_id` and parks the row at `transcribing`.

**Webhook flow** (`supabase/functions/asr-webhook/index.ts`):

1. Verify `X-DulyNoted-Webhook` header against `ASR_WEBHOOK_SECRET`. Return 401 if mismatch; do not log payload.
2. Parse JSON body: `{ transcript_id, status }`.
3. `SELECT id, status FROM meetings WHERE asr_transcript_id = $1`. If no row found, log and return 200 (stale or duplicate delivery). If status is not `transcribing`, return 200 (idempotency — already processed).
4. If AssemblyAI status is not `completed`, set `meetings.status = 'failed'`, `last_error = payload error message`, `failed_at = now()`, return 200.
5. Fetch full transcript JSON: `GET https://api.assemblyai.com/v2/transcript/{transcript_id}` with `Authorization: Bearer {ASR_VENDOR_API_KEY}`.
6. Upload to Storage at `meetings/{meeting_id}/transcript.json` (private bucket `meeting-artifacts`).
7. `UPDATE meetings SET transcript_url = $1, status = 'segmenting', updated_at = now() WHERE id = $2 AND status = 'transcribing'`. The conditional `WHERE` preserves idempotency under duplicate webhook delivery.
8. Return 200.

The Edge Function is one of two surfaces (the other being `apps/web`) the public internet can reach. It must validate the auth header before any side effect.

**Cost expectation at v1 scale.** Lincolnville Select Board meets ~24×/year. At ~2 hr/meeting, ~48 hr/year ≈ $10/year ASR variable cost. Bounded.

**Locked decisions:** see ADRs 0008–0010.

---

# Stage 3 — Audio extraction + cron discovery

**Path: yt-dlp invoking the YouTube backend, executed in `apps/worker`.** Class A (caption-track retrieval) is closed off — YouTube API ToS classifies `captions.download` as channel-owner-OAuth-gated, and the 30-day data retention rule is incompatible with a permanent transcript archive. yt-dlp for _audio_ extraction (then ASR via Stage 2) is the surviving path.

**Container.** `apps/worker/Dockerfile` is a custom image based on `node:24-bookworm-slim` with:

- `apt-get install -y ffmpeg ca-certificates curl`
- yt-dlp installed as a static binary downloaded to `/usr/local/bin/yt-dlp` and made executable; version pinned via build arg
- ffmpeg version captured in the image (whatever the Debian bookworm package supplies); update intentionally, not on rebuild

**Extraction command.** `yt-dlp -x --audio-format opus -o '{path}' '{youtube_url}'`. Opus minimizes Storage footprint (~15 MB/hour); AssemblyAI accepts opus natively.

**Storage.** Bucket `meeting-artifacts`, private. Path `meetings/{meeting_id}/audio.opus`. Audio retained indefinitely at v1; deletion policy revisited when storage cost lands as a real line item.

**Cron discovery quota pattern (per board, per scan):**

- Compute uploads playlist ID by string substitution: `UC{rest}` → `UU{rest}`. Documented YouTube convention; no `channels.list` call needed at scan time.
- `playlistItems.list?playlistId={uploadsId}&part=snippet&maxResults=10` — 1 unit
- For each item in the response, parse `snippet.publishedAt` (RFC 3339 datetime) and compare against the per-board cutoff `now() - boards.ingest_since_days`. Items older than the cutoff are skipped. Because `playlistItems.list` orders the uploads playlist most-recent-first by YouTube convention, pagination short-circuits the moment a stale item appears — subsequent pages would be entirely stale and the `nextPageToken` is discarded for the remainder of this scan.
- `videos.list?id={comma-separated-new-ids}&part=contentDetails,snippet` — 1 unit, batched up to 50 IDs (called only against items that passed the horizon filter)
- Total: 2 quota units per board scan, regardless of how many videos are returned (within batch limits)
- `search.list` is **forbidden** (100 units/call)

Cron schedule: hourly (`0 * * * *`). Lincolnville Select Board meets monthly; hourly is overkill but predictable and cheap.

**Auto-promotion `discovered → pending`.** Per-board rule: cron INSERTs new rows at `status = 'discovered'` (only for items inside the per-board `ingest_since_days` horizon) with title and `duration_seconds`, then updates to `pending` where:

```sql
status = 'discovered'
AND duration_seconds >= boards.min_duration_seconds
AND title ~* boards.title_pattern
```

For Lincolnville Select Board:

- `title_pattern = 'select board'`
- `min_duration_seconds = 600`
- `ingest_since_days = 365` (default)

Town Meeting and Planning Board content on the same channel are separate board entities with their own patterns when added; each can carry its own `ingest_since_days` for cases like historical-reconstruction onboarding.

**Failure modes.**

- yt-dlp version drift: pinned in Dockerfile via build arg. Bumps are intentional commits.
- YouTube anti-bot throttling: not expected at v1 volume; revisit if it surfaces.
- Video unavailable / private / removed: `meetings.status = 'failed'`, `last_error` records yt-dlp stderr, manual reset required.
- AssemblyAI submission rejected: same handling — `status = 'failed'`, vendor error in `last_error`.

**Locked decisions:** see ADRs 0011–0013. ADR 0019 covers the residential-proxy egress path layered on top of the yt-dlp extraction decision.

---

# Stage 4 — Segmentation

**Method.** Three-step LLM pipeline adapted from Oberoi's March 2024 baseline (citymeetings.nyc).

- **Step 1 — marker extraction.** Sequential transcript chunks (~8K tokens each) processed independently. LLM identifies start markers of one of the five marker types defined below, returning the T-token of the first sentence of each.
- **Step 2 — chapter boundary determination.** Per marker, LLM is given the marker plus the transcript portion from that marker to the next. Returns the T-token of the chapter's last sentence.
- **Step 3 — title and description generation.** Per chapter, LLM produces a marker-type-conditioned title and a 1–2 sentence description.

Single-pass per chunk, per marker, per chapter — no multi-LLM consensus, no retry on schema-valid output. Multi-LLM consensus and claim grounding are explicit v2 deferrals (CLAUDE.md §7).

**Methodology note.** Oberoi's current (post-summer 2024) production approach is operator section-marking + AI sub-marker extraction, requiring a custom review UI. The three-step automated pipeline used here is Oberoi's earlier (March 2024) baseline, which he acknowledged as overfit to NYC City Council meetings. Maine selectboard meetings are structurally simpler and more agenda-predictable; the automated baseline is sufficient for v1. The operator section-marking approach supersedes this when the slice that builds the operator review UI lands.

**Marker taxonomy** (`marker_type` enum, per-board tunability deferred to pass 2):

| Marker           | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `AGENDA_ITEM`    | Opening of an item from the published agenda                        |
| `PUBLIC_COMMENT` | Start of a member of the public speaking                            |
| `DISCUSSION`     | Board-member discussion of an agenda item                           |
| `VOTE`           | Explicit verbal vote on a motion                                    |
| `PROCEDURE`      | Call to order, adjournment, executive session entry/exit, roll call |

**Timestamp scheme.** `[T{integer}]` synthetic tokens (Oberoi 3/3-corroborated approach). Real timestamps from AssemblyAI's `utterances[]` array (millisecond `start` field) are replaced with sequential `[T0]`, `[T1]`, `[T2]`… tokens injected ahead of every utterance in the LLM input. An out-of-band lookup table maps T-indices back to real timestamps. The LLM is instructed to reference and return only T-tokens. This eliminates the documented hallucination class where LLMs fabricate plausible-looking timestamps not present in the transcript. Token injection logic and lookup table builder live in `packages/shared/src/segmentation/t-tokens.ts`.

**LLM.**

- Model: `claude-opus-4-7` (Anthropic flagship as of 2026-04-16).
- Tokenizer note: Opus 4.7 ships with an updated tokenizer that can produce up to ~35% more tokens for the same input text vs. Opus 4.6. Cost projections in this section are inflated accordingly.
- Adaptive thinking: Opus 4.7 has adaptive thinking always on; the `temperature` parameter is not accepted by the API and must be omitted from request bodies. Effort levels are `low`, `medium`, `high`, `xhigh`, `max`; default adaptive is the v1 choice.
- List pricing (2026-05): $5/M input, $25/M output. Prompt caching reduces cached input to $0.50/M (90% off). Batch API: 50% off both legs.
- API surface: `apps/worker` calls Anthropic SDK directly. `ANTHROPIC_API_KEY` enters the worker Zod env schema in Slice 3.

**Output enforcement.** Anthropic native structured outputs (`output_config.format` with JSON schema, GA on Opus 4.7 / Sonnet 4.6 / Sonnet 4.5 / Opus 4.5 / Haiku 4.5; the legacy beta `output_format` and `anthropic-beta: structured-outputs-2025-11-13` header are not used). The `instructor` library Oberoi used with OpenAI is not a dependency. Constrained decoding guarantees schema conformance; it does not guarantee factual accuracy. Per CLAUDE.md §6, every LLM output is also Zod-validated before any DB write. JSON schemas live in `packages/shared/src/segmentation/schemas.ts`; Zod schemas mirror them. T-token validator: rejects any returned token not present in the lookup table for the meeting under processing. Schema-level constraints not supported by Anthropic's structured outputs (`minLength`, `maxLength`, `minimum`, `maximum`, recursive schemas) live in Zod only.

**State transition.** Worker picks up `meetings.status = 'segmenting'` with `SELECT … FOR UPDATE SKIP LOCKED`, runs the three-step pipeline, writes N rows to `segments` in a single transaction with `UPDATE meetings SET status = 'summarizing'`. No operator gate at this transition.

**Failure modes.**

- LLM returns a T-token not in the lookup table: Zod validator rejects, worker writes `status = 'failed'`, `last_error` captures the offending token, manual reset required.
- LLM returns a chapter with `start_time_seconds >= end_time_seconds`: Zod validator rejects, same handling.
- Anthropic API timeout, 429, or 5xx: worker retries up to 3× with exponential backoff (1s, 4s, 16s), then fails the row. Honor `retry-after` / `retry-after-ms` response headers when present in preference to the fixed schedule.
- Empty `utterances[]` array in the transcript artifact: worker fails the row at pickup before any LLM call.
- Step 1 returns zero markers for a chunk: that chunk produces no chapters (acceptable; not a failure).

**Cost expectation at v1 scale.** Lincolnville Select Board ~24 meetings/year × ~2 hr/meeting. Per-meeting estimate: ~100K input + ~15K output tokens across all three passes (after Opus 4.7 tokenizer inflation) ≈ $1.20/meeting ≈ ~$29/year. Bounded.

**Locked decisions:** see ADRs 0014–0018.

---

# Stage 6 — Summarization

**Method.** Single LLM call per meeting producing a meeting-level summary. Input is the meeting's segments (title + marker_type + description + transcript_excerpt per row, ordered by `sequence_order`) plus meeting/board/town metadata. Output is one prose summary stored on the meeting row.

The chapter-level summarization Oberoi performs as a separate prompt is already covered by Stage 4 Step 3 (title + 1–2 sentence description per chapter). Stage 6 does not re-deepen those; reader UI cards consume the Stage 4 output directly. Whether per-chapter description deepening is worthwhile is unproven and deferred until reader UI testing surfaces a quality gap.

The summary input is segments-only at v1 — the handler does not open `transcript.json`. Whether transcript-aware summarization yields meaningfully better quality is an unproven hypothesis; see Backlog B5 for the eval-script approach to test both paths offline before committing to the heavier production handler.

**Hallucination guardrails.** Three layers, in priority order:

1. **Entity grounding (Oberoi pattern, adapted).** The system prompt enumerates the meeting's known entities — board name, town name, meeting title, meeting date, agenda item titles parsed from `AGENDA_ITEM` segments — and instructs the LLM to ground all claims (votes, decisions, dollar amounts, dates) in the supplied segment context only. Person-name handling is stricter at v1: the prompt instructs the LLM to use only names that appear verbatim in a segment's `transcript_excerpt`, preserve AssemblyAI diarization labels (e.g. "Speaker A") unchanged when no name is given, and never invent positions or titles for any speaker. The full Oberoi metadata-grounding pattern (KB `kb_hallucination-mitigation-summarization` C2/C3) requires a separate speaker-identification pre-pass mapping diarization labels to a board-member roster — the v1 deviation lives because Slice 3 has no such pre-pass and the `boards` table has no member roster (see Backlog B6).
2. **Schema enforcement.** Anthropic structured outputs constrain the response shape; Zod validates the parsed object before any DB write.
3. **Length bounds.** Zod-enforced (not in the JSON schema, since `minLength`/`maxLength` are not supported by Anthropic's structured outputs). Summary length must fall within configured min/max — out-of-bounds output triggers retry per the failure modes below, and on persistent failure the row goes to `status = 'failed'`.

Heavier post-hoc verification (RAGAS Faithfulness, claim-to-segment alignment scoring, multi-LLM consensus) stays deferred to V2 per CLAUDE.md §7.

**Methodology note.** Oberoi's documented pattern is "a separate prompt generates the meeting summary from chapters plus transcript, with human edit before publication" (KB `kb_transcript-segmentation-methodology` A2). V1 deviates on two axes: (1) segments-only input rather than chapters-plus-transcript (see B5), and (2) no human edit before publication (see B4). Both deviations are deliberate MVP scope cuts with explicit revisit triggers in the Backlog.

**LLM.**

- Model: `claude-opus-4-7`. Same model as Stage 4. Reusing the Slice 3 wiring eliminates per-stage model selection complexity at v1; cost differential vs. Sonnet 4.6 is negligible at ~24 calls/year.
- Tokenizer, pricing, adaptive thinking, structured outputs, retry/header-honoring policy: identical to Stage 4 above.

**Output enforcement.** Native structured outputs with a JSON schema for `{ summary: string }`. Zod schema mirrors it and additionally enforces length bounds. JSON + Zod schemas live in `packages/shared/src/summarization/schemas.ts`.

**State transition.** The worker uses two RPCs paralleling Slice 3's `claim_segmenting_meeting()` / `complete_segmentation()` pair, ensuring the CLAUDE.md §6 lock-then-atomic-update rule holds across the LLM call's duration without keeping a Postgres connection open for the full call:

- `claim_summarizing_meeting()` — opens a transaction, executes `SELECT ... FOR UPDATE SKIP LOCKED` against rows at `status = 'summarizing'` (LIMIT 1), atomically updates the locked row to `status = 'summarizing_inflight'`, commits, returns the row. The transient `summarizing_inflight` state is the semaphore: once claimed, the row is invisible to other workers polling `summarizing`, so concurrent or restarted workers cannot redundantly call the LLM and double-bill Anthropic.
- `complete_summarization(meeting_id uuid, summary text)` — atomically writes the summary, sets `summary_generated_at = now()`, advances status from `summarizing_inflight` to `embedding`, with `WHERE status = 'summarizing_inflight'` providing write-side idempotency under any duplicate-call edge case.

Failure path mirrors Slice 3's: a separate UPDATE (or an `abandon_summarizing_meeting` RPC if Slice 3 has the parallel) sets `summarizing_inflight → failed` with `last_error` and `failed_at` populated.

The user-facing transition advanced by this stage is `summarizing → embedding` (handed off to Stage 9). The `summarizing_inflight` state is a transient implementation detail not shown in the §"Background job architecture" diagram, paralleling Slice 3's transient `chaptering` state.

**Failure modes.**

- Anthropic API timeout, 429, or 5xx: worker retries up to 3× with exponential backoff (1s, 4s, 16s), then fails the row. Honor `retry-after` / `retry-after-ms` response headers when present in preference to the fixed schedule.
- Schema-shape validation failure (Anthropic-side, expected to be impossible with structured outputs but covered defensively): Zod rejects, worker writes `status = 'failed'`, `last_error` captures the validation message, manual reset required.
- Length-bound violation: same handling — fails the row with `last_error` recording the actual length and the configured bounds.
- Empty `segments` array at pickup: worker fails the row before any LLM call. Should not occur post-Slice-3 (segmenting writes ≥1 segment or fails the row); guarded defensively because the LLM call without context produces meaningless output.
- Successful call but model-flagged refusal (rare): worker fails the row with `last_error` capturing the refusal reason.

**Cost expectation at v1 scale.** ~24 meetings/year × 1 call/meeting. Per-meeting estimate: ~10K input tokens (segment list with excerpts; well below transcript size) + ~500 output tokens (one prose summary) after tokenizer inflation ≈ $0.06/meeting ≈ ~$1.50/year. Negligible.

**Locked decisions.** No new ADRs required at Slice 4. Stage 6 reuses Stage 4's locked decisions on model choice (ADR 0014), structured outputs surface (ADR 0018), and overall LLM-call discipline. The "v1 auto-advance with no operator gate" stance is a SPEC-level closure of an open item, not an ADR — if that stance becomes contested when Backlog B4 reopens, an ADR captures the resolution then.

---

# Stage 5 — pass 1 schema (as built)

The pre-slice scaffold ships the minimum-viable schema. Pass 2 (after Slice 2) replaces this with the full DDL: indexes beyond primary keys (including FK-side indexes — see Indexes paragraph), soft-delete columns, search columns, real RLS policies paired with the corresponding table-level GRANTs, and a `set_updated_at()` BEFORE UPDATE trigger applied to every table with an `updated_at` column.

**Tables.** Six tables, plus one connectivity-check table. RLS is enabled on every table; no business policies exist beyond an anon SELECT on `_scaffold_health` (the homepage's boot probe). Default-deny applies to everything else until pass 2.

| Table              | Purpose                                        | Notable columns                                                                                                                                                           |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_scaffold_health` | Connectivity probe seeded with `'scaffold ok'` | `id uuid pk`, `message text`, `created_at timestamptz`                                                                                                                    |
| `publications`     | Tenant root                                    | `id uuid pk`, `slug text unique`, `name text`                                                                                                                             |
| `towns`            | Geographic unit under a publication            | `id uuid pk`, `publication_id uuid fk`, unique `(publication_id, slug)`                                                                                                   |
| `boards`           | Meeting body under a town                      | `id uuid pk`, `town_id uuid fk`, unique `(town_id, slug)`                                                                                                                 |
| `meetings`         | The pipeline state row                         | `id uuid pk`, `board_id uuid fk`, `status meeting_status` (default `'discovered'`), `youtube_id text`, `meeting_date date`, `last_error text`, `created_at`, `updated_at` |
| `memberships`      | User ↔ publication join with role              | `user_id uuid → auth.users`, `publication_id uuid fk`, `role text check in ('reader','editor','admin')`, unique `(user_id, publication_id)`                               |

**Enum.** `public.meeting_status` matches the public-state portion of the state machine in §"Background job architecture": `discovered, pending, extracting, transcribing, segmenting, summarizing, embedding, review, published, failed`. Transient inflight states (`chaptering`, `summarizing_inflight`, `embedding_inflight`) are added in Slice 3, Slice 4, and Slice 6 schema deltas respectively; they are implementation detail and not shown in the documented diagram.

**Identity.** No `public.users` table. `auth.users` is canonical; `memberships.user_id` joins against it directly. A `public.profiles` table can be added in pass 2 if profile fields land on the roadmap.

**Indexes.** Only the primary keys and the `unique` constraints listed above. Postgres does not create indexes on FK referencing columns — only on the referenced (PK) side. The composite UNIQUEs on `towns` and `boards` happen to cover their FK columns as the leading column, which is incidental. FK-side indexes for `meetings.board_id`, `memberships.publication_id`, and any other referencing columns are deferred to pass 2 alongside performance-tuning indexes (status filtering, date ordering, search).

**Grants.** Supabase API access requires both RLS policies and table-level `GRANT`s for the `anon`, `authenticated`, and `service_role` roles. The scaffold migration grants SELECT on `_scaffold_health`; pass 2 grants the rest as policies are written. (Codified in the `*_grant_scaffold_health_select.sql` follow-up migration.)

## Slice 2 schema deltas

Additive, single migration file `NNNN_slice_2_ingestion_schema.sql`, backwards-compatible with the previously deployed worker.

**Boards table additions:**

- `youtube_channel_id text` (nullable; cron skips boards without one)
- `title_pattern text` (nullable; Postgres `~*` regex; cron auto-promote rule)
- `min_duration_seconds int default 0` (cron auto-promote rule)
- `ingest_since_days int not null default 365` (cron horizon; cron skips `playlistItems.list` entries with `snippet.publishedAt` older than `now() - ingest_since_days`. Per-board so historical-reconstruction boards can override without affecting steady-state.)
- `uploads_playlist_id text generated always as ('UU' || substr(youtube_channel_id, 3)) stored` (computed; eliminates a `channels.list` call per scan). Paired with `CHECK (youtube_channel_id IS NULL OR youtube_channel_id LIKE 'UC%')` so the substr() expression always operates on a valid channel id. (`replace(youtube_channel_id, 'UC', 'UU')` was the original draft; replaced because `replace()` is global and would corrupt the playlist id if `UC` ever appeared mid-string.)

**Meetings table additions:**

- `youtube_id text not null unique` — promoted to NOT NULL and UNIQUE in the Slice 2 follow-up migration (`slice_2_followup`).

  > **Constraint intent note (triaged 2026-05-07):** The Slice 2 initial
  > migration applied `UNIQUE(youtube_id)` globally. This is correct for
  > single-board v1. When a second board targets the same YouTube channel
  > (e.g., Planning Board on `@townoflincolnville`), the global constraint
  > causes the cron's upsert to silently no-op on every video already owned
  > by board #1, preventing board #2 from ever discovering its meetings. The
  > intended long-term constraint is composite: `UNIQUE(board_id, youtube_id)`,
  > accepting that the same video produces two `meetings` rows when multiple
  > boards target the same channel. A follow-up migration changes the
  > constraint when board #2 is added. See `_known-non-issues.md` NI-007
  > and audit `2026-05-07-slice-2-ingestion.md` Q1.

- `transcript_url text` (Storage path)
- `audio_url text` (Storage path)
- `asr_transcript_id text unique` (nullable; populated when worker submits)
- `duration_seconds int` (set by cron from `videos.list` response)
- `title text` (set by cron)
- `failed_at timestamptz`

**Indexes:**

- `meetings_status_idx` on `(status)` — worker poll
- `meetings_board_id_idx` on `(board_id)` — FK side

**Trigger:**

- `set_updated_at()` BEFORE UPDATE on `meetings` only. Other tables receive the trigger when a slice touches them.

**RLS on `meetings`:**

- `service_role` full access (paired with `GRANT ALL`)
- `authenticated` SELECT where `status = 'published'` (paired with `GRANT SELECT`)

  > **Pass-2 note (triaged 2026-05-07):** This policy has no tenant filter.
  > Any authenticated user can read any published meeting regardless of
  > publication membership. This is the SPEC-mandated pass-1 shape;
  > membership-aware policies are deferred to pass 2. The tenant-boundary
  > hole becomes load-bearing the moment a second publication onboards or
  > authenticated reader UI ships — whichever comes first. See
  > `_known-non-issues.md` NI-008. **Slice 5 closes NI-008**: the
  > authenticated SELECT policy on `meetings` is replaced with a
  > membership-aware version. See ## Slice 5 schema deltas below.

**Storage bucket:**

- Create `meeting-artifacts` private bucket. Service-role unrestricted; no public read; signed URLs only for vendor handoff.

Pass 2 still deferred: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns, search columns.

Slice 2 follow-up extended `service_role` SELECT grants to `publications`, `towns`, `boards` (surfaced post-audit by cron path against cloud Supabase). Slice 5 landed `authenticated` SELECT grants on `publications`, `towns`, `boards`, `meetings`, `segments`, `memberships` paired with membership-aware RLS policies (see ## Slice 5 schema deltas below). No `anon` grants on any table beyond `_scaffold_health` — the v1 reader is private.

## Slice 3 schema deltas

Additive, single migration file `NNNN_slice_3_segmentation_schema.sql`, backwards-compatible with the previously deployed worker.

**New table `segments`:**

```sql
create table public.segments (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.meetings(id) on delete cascade,
  sequence_order      int  not null,
  marker_type         text not null check (marker_type in (
                        'AGENDA_ITEM', 'PUBLIC_COMMENT', 'DISCUSSION', 'VOTE', 'PROCEDURE'
                      )),
  title               text not null,
  description         text not null,
  start_time_seconds  int  not null check (start_time_seconds >= 0),
  end_time_seconds    int  not null check (end_time_seconds > start_time_seconds),
  transcript_excerpt  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (meeting_id, sequence_order)
);
```

**Indexes.**

- `segments_meeting_id_idx` on `(meeting_id)` — FK side, reader-UI lookup.
- The unique constraint `(meeting_id, sequence_order)` covers ordered iteration; no separate index needed.

**Trigger.** `set_updated_at()` BEFORE UPDATE on `segments`.

**RLS on `segments`** — enabled in the same migration that creates the table.

- `service_role` full access, paired with `GRANT ALL ON segments TO service_role`.
- `authenticated` SELECT where the parent meeting is `published`:

  ```sql
  create policy "authenticated read segments of published meetings"
    on public.segments for select
    to authenticated
    using (exists (
      select 1 from public.meetings m
      where m.id = segments.meeting_id and m.status = 'published'
    ));
  ```

  Paired with `GRANT SELECT ON segments TO authenticated`.

  > **Pass-2 note:** Same tenant-boundary deferral as `meetings` (NI-008). Any
  > authenticated user can read any published meeting's segments regardless of
  > publication membership. Membership-aware policy lands in pass 2 alongside
  > the meetings-table membership policy. **Slice 5 closes this**: the
  > policy is replaced with a membership-aware version that joins through
  > meetings → boards → towns → memberships. See ## Slice 5 schema deltas
  > below.

**Storage bucket.** No new bucket. Segments live entirely in Postgres; no Storage artifact for segments at v1. Search columns on `segments` ship in Slice 6 (see ## Slice 6 schema deltas below).

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns.

## Slice 4 schema deltas

Additive, single migration file `NNNN_slice_4_summarization_schema.sql`, backwards-compatible with the previously deployed worker.

**Enum addition:**

```sql
alter type public.meeting_status add value 'summarizing_inflight' before 'review';
```

Transient state for the worker's claim/complete pattern (see Stage 6 §State transition), paralleling Slice 3's `chaptering`. Not shown in the §"Background job architecture" state diagram — implementation detail. Postgres 14+ permits `ALTER TYPE ADD VALUE` inside a transaction, so this lands in the same migration file as the column additions.

**Meetings table additions:**

- `summary text` (nullable; populated when summarization succeeds and the row advances out of `summarizing_inflight`)
- `summary_generated_at timestamptz` (nullable; populated in the same `UPDATE` that writes `summary`)

Both columns are nullable indefinitely — historical rows that pre-date Slice 4 (none exist in production at the time of this slice, but the constraint matters for replay) carry NULL values until re-run, and rows that fail the summarization step never receive values. NOT NULL is deferred until and unless backfill completes; no Backlog entry needed because the nullable shape is correct as-is.

**Stored procedures (RPCs).** Mirror Slice 3's claim/complete pair:

- `claim_summarizing_meeting()` — opens a transaction, `SELECT ... FOR UPDATE SKIP LOCKED` on a row at `status = 'summarizing'` (LIMIT 1), atomic UPDATE to `status = 'summarizing_inflight'`, commit, return the row. Match Slice 3's `claim_segmenting_meeting()` shape and naming convention exactly.
- `complete_summarization(meeting_id uuid, summary text)` — atomically writes `summary`, `summary_generated_at = now()`, advances status from `summarizing_inflight` to `embedding`, with `WHERE status = 'summarizing_inflight'` for write-side idempotency. Match Slice 3's `complete_segmentation()` shape. The advance target is `embedding` (Slice 6's new state) rather than `published`; this is the Slice 6 amendment to Slice 4's RPC contract.
- Failure path follows whatever pattern Slice 3 uses for failed segmentation (separate `abandon_*` RPC or inline UPDATE) — match exactly; do not introduce a new failure-path style for this stage.

**Indexes.** None added. The summary column is reader-UI-rendered, not queried. No `WHERE summary IS NOT NULL` filter is needed at the database layer (the existing `WHERE status = 'published'` policy already filters to rows that successfully completed summarization, embedding, and any future post-summary stages).

**Trigger.** `set_updated_at()` already applies to `meetings` from Slice 2; the new columns are covered.

**RLS.** No new policy at Slice 4. The existing `authenticated` SELECT-where-status-published policy on `meetings` covers the new columns. Same pass-2 tenant-boundary deferral applies (NI-008). (Slice 5 replaces that policy with a membership-aware version; the new columns inherit the replacement.)

**Storage bucket.** No new bucket. Summary lives entirely in Postgres.

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns, search columns on `segments` (shipped in Slice 6; see ## Slice 6 schema deltas below).

## Slice 5 schema deltas

Single migration file `NNNN_slice_5_reader_ui_rls.sql`, backwards-compatible with the previously deployed worker (the worker uses `service_role`, which is unaffected by these `authenticated`-scoped changes).

**Policy replacement on `meetings`.**

The existing `authenticated` SELECT-where-status-published policy on `meetings` is replaced with a membership-aware version that adds a JOIN through `boards` → `towns` → `memberships` to constrain reads to the user's publications. Strictly tighter than the prior policy; no row visible under the old policy becomes hidden incorrectly under the new one within the single configured tenant. Closes the NI-008 tenant-boundary deferral.

**New `authenticated` SELECT policies + matching GRANTs on:**

- `publications` — `id IN (SELECT publication_id FROM memberships WHERE user_id = auth.uid())`
- `towns` — `publication_id IN (SELECT publication_id FROM memberships WHERE user_id = auth.uid())`
- `boards` — JOIN through `towns` and `memberships`
- `segments` — replaces the existing published-only policy with a JOIN through `meetings` (which after the meetings-policy replacement above already enforces both `status = 'published'` and the tenant boundary, so segments inherit both gates)
- `memberships` — `user_id = auth.uid()` (flat self-row policy, required for the bootstrap hop where the reader resolves which publication a user belongs to)

Each policy is paired with `GRANT SELECT ON public.{table} TO authenticated`.

**No table-shape changes.** No new columns, no new tables, no enum changes, no new indexes. The migration is RLS + GRANT only. The worker is unaffected: it uses `service_role`, which bypasses RLS.

**Performance note.** The nested-subquery policy shape relies on FK-side indexes on `memberships.publication_id`, `towns.publication_id`, `boards.town_id`, `meetings.board_id`. The first three remain in the pass-2 deferred list (FK-side indexes were always part of pass 2); `meetings.board_id` is already indexed (Slice 2 `meetings_board_id_idx`). At v1 corpus scale (~24 meetings/year, single tenant) the unindexed JOIN cost is irrelevant. The pass-2 FK index work picks the rest up before tenant scale stresses the policy plan.

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id` and other un-indexed FK-side columns, soft-delete columns. Search columns on `segments` are shipped in Slice 6 (see ## Slice 6 schema deltas below). Search columns on `meetings.summary` remain deferred; Slice 6 indexes segments only and the per-meeting summary is rendered at the top of the meeting page where any segment hit lands.

## Slice 6 schema deltas

Single migration file `NNNN_slice_6_search_schema.sql`, backwards-compatible with the previously deployed worker. Additive on `segments`; existing rows have `NULL` for the embedding column until backfilled. The lexical `search_tsv` column is generated stored, so existing rows populate automatically.

**Enum additions:**

```sql
alter type public.meeting_status add value 'embedding' before 'review';
alter type public.meeting_status add value 'embedding_inflight' before 'review';
```

`embedding` is the public-visible state advancing from `summarizing_inflight`; `embedding_inflight` is the transient claim/complete semaphore (paralleling `summarizing_inflight` and Slice 3's `chaptering`). Postgres 14+ permits `ALTER TYPE ADD VALUE` inside a transaction. The Slice 4 `complete_summarization` RPC's advance target updates from `published` to `embedding` as part of this slice (see Slice 4 schema deltas above for the amended RPC contract).

**Segments table additions:**

```sql
alter table public.segments
  add column embedding extensions.vector(1536),
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(transcript_excerpt, '')), 'C')
  ) stored;
```

Weights: A on `title`, B on `description`, C on `transcript_excerpt`. The semantic arm embeds the unweighted concatenation `title || ' ' || description || ' ' || transcript_excerpt`; weights are a lexical-arm-only concept.

**Indexes:**

- `segments_embedding_hnsw_idx` — `using hnsw (embedding vector_cosine_ops)` for the semantic arm. Cosine distance (`<=>`) is the query operator; OpenAI `text-embedding-3-small` returns L2-normalized vectors so inner product would produce identical ranking, but the cosine operator matches the broader pgvector convention.
- `segments_search_tsv_gin_idx` — `using gin (search_tsv)` for the lexical arm.

**Stored procedures (RPCs).** Mirror Slice 4's claim/complete pair plus a separate failure-path RPC matching whatever Slice 3 settled on:

- `claim_embedding_meeting()` — opens a transaction, `SELECT ... FOR UPDATE SKIP LOCKED` on a row at `status = 'embedding'` (LIMIT 1), atomic UPDATE to `status = 'embedding_inflight'`, commit, return the row plus its segments. Match Slice 4's `claim_summarizing_meeting()` shape; the segments JOIN is the only addition.
- `complete_embedding(meeting_id uuid, segment_embeddings jsonb)` — atomically writes per-segment embeddings, advances status from `embedding_inflight` to `published`, with `WHERE status = 'embedding_inflight'` for write-side idempotency. The `segment_embeddings` argument is shaped as `[{"segment_id": "...", "embedding": [...]}, ...]`; the RPC iterates and writes per segment in a single transaction so partial writes are impossible.
- `abandon_embedding_meeting(meeting_id uuid, error_text text)` — UPDATE from `embedding_inflight` to `failed` with `last_error` and `failed_at` set. Match Slice 3's failure-path style exactly.
- `search_segments(query_text text, query_embedding extensions.vector(1536), match_count int, full_text_weight float default 1.0, semantic_weight float default 1.0, rrf_k int default 50)` — returns the top `match_count` segments by Reciprocal Rank Fusion, joined to parent meetings/boards/towns/publications for display context. The RPC runs with the caller's role (no `SECURITY DEFINER`); membership-aware RLS policies on segments and joined parents gate the result set. Implementation follows the Supabase hybrid-search reference pattern with RRF formula `weight_i / (rrf_k + rank_i)` per arm, summed, ordered descending.

**Trigger.** `set_updated_at()` already applies to `segments` from Slice 3; the new columns are covered.

**RLS.** No new policy at Slice 6. The existing membership-aware `authenticated` SELECT policy on `segments` (Slice 5) covers the new columns. The `search_segments` RPC inherits the same boundary because it runs as the calling role.

**GRANTs.** Worker reads/writes `segments.embedding` via `service_role`, already covered by Slice 3's `GRANT ALL ON segments TO service_role`. The new RPCs require `GRANT EXECUTE` to `service_role` (for the claim/complete/abandon trio) and `authenticated` (for `search_segments`).

**Storage bucket.** No new bucket.

**Pass 2 status.** Remaining deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id` and other un-indexed FK-side columns, soft-delete columns, search column on `meetings.summary` (intentionally deferred — see Stage 9).

## Slice 7 schema deltas

Single migration file `NNNN_slice_7_invitations_schema.sql`, backwards-compatible with the previously deployed worker and web app. Additive: new `invitations` table, new trigger function and trigger on `auth.users`, new `resolve_pending_invitations()` RPC, and new `check_invite_conflicts(p_email text, p_publication_id uuid)` RPC (service-role only, called from the `invite-user` Edge Function). A test-only `exec_sql_unsafe(sql text)` helper lives in `supabase/seed.sql` (seed-only, never in a migration) to support the invitations test suite. No changes to `memberships`, `publications`, `towns`, `boards`, `meetings`, or `segments` shapes. No changes to existing RLS policies on those tables.

**New table `invitations`:**

```sql
create table public.invitations (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null check (email = lower(email)),
  publication_id       uuid not null references public.publications(id) on delete cascade,
  role                 text not null check (role in ('reader', 'editor', 'admin')),
  invited_by_user_id   uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '7 days'),
  accepted_at          timestamptz,
  revoked_at           timestamptz
);
```

Email is stored lowercase, enforced by CHECK. Supabase Auth has stored `auth.users.email` lowercased since gotrue PR #110 (2021), so `NEW.email` arriving in the trigger is already normalized; the CHECK is defense-in-depth.

`invited_by_user_id` is nullable to support the system-bootstrap case (Andy invites Aaron before Andy has a membership row of his own) and uses `ON DELETE SET NULL` so audit trail of past invitations survives the inviter's removal.

`expires_at` defaults to 7 days per Makerkit's reference pattern for invitation TTLs. `accepted_at` and `revoked_at` are null on open invitations; an invitation is "open" iff both are null and `expires_at > now()`.

**Indexes:**

- Partial unique index on open invitations:
  ```sql
  create unique index invitations_open_email_pub_unique_idx
    on public.invitations (email, publication_id)
    where accepted_at is null and revoked_at is null;
  ```
  Enforces "at most one open invitation per email-publication pair" without blocking re-issuance after acceptance or revocation. The `email` column is already lowercased by CHECK, so no `lower()` expression in the index.
- FK-side index on `publication_id`:
  ```sql
  create index invitations_publication_id_idx
    on public.invitations (publication_id);
  ```
  Supports the admin-aware RLS subquery and the pending-list view query keyed by publication.

**Trigger function `public.handle_new_auth_user()`:**

`SECURITY DEFINER`, owner `postgres`. The function body MUST be wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN NEW;` per the CLAUDE.md §6 defensive-trigger rule — any unhandled exception inside an `auth.users` trigger rolls back the auth subsystem's INSERT and blocks signup with a misleading "Database error saving new user" response. Failure to perform the downstream side effect (membership resolution) is recoverable; blocked signup is not.

Function body:

1. Selects all matching open invitations: `email = NEW.email AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. Email comparison is exact-equality (no `lower()`) because both sides are lowercased.
2. For each match: `INSERT INTO public.memberships (user_id, publication_id, role) VALUES (NEW.id, invitation.publication_id, invitation.role) ON CONFLICT (user_id, publication_id) DO NOTHING`. The ON CONFLICT clause is idempotent across re-runs and tolerates the case where a user already has a membership for that publication (e.g., previously invited via a different path).
3. Marks each consumed invitation: `UPDATE public.invitations SET accepted_at = now() WHERE id = ANY($matched_ids)`.
4. On any exception in steps 1–3: `RAISE WARNING 'handle_new_auth_user: failed for user_id=%, email=%, error=%', NEW.id, NEW.email, SQLERRM; RETURN NEW;`. Signup completes; the affected user lands at no-membership state; Andy can run `resolve_pending_invitations()` later to retry or correct manually.

**Trigger `on_auth_user_created`:**

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
```

The trigger fires on every `auth.users` INSERT regardless of `email_confirmed_at` state. Membership is created before the user confirms email ownership; this is structurally safe because the user cannot authenticate (and therefore cannot read RLS-gated rows) until they complete the magic-link click that sets `email_confirmed_at`. The membership exists in advance of authentication, not before authorization.

**Stored procedure `public.resolve_pending_invitations()`:**

```sql
create function public.resolve_pending_invitations() returns int
  language plpgsql
  security definer
  set search_path = public, auth
  as $$ ... $$;
```

Reads `auth.uid()` and resolves the caller's email from `auth.users` directly (`SELECT email FROM auth.users WHERE id = auth.uid()`), not from `auth.jwt() ->> 'email'`. JWT claims are a point-in-time snapshot (up to 1-hour TTL by default); reading from `auth.users` ensures the current authoritative email is used even if the JWT has not yet refreshed after an email change. Consistent with ADR 0023 §"Why Option B over Options C and D." Finds matching open invitations for the calling user's email; performs the same `INSERT INTO memberships ... ON CONFLICT DO NOTHING` plus `UPDATE invitations SET accepted_at` as the trigger. Returns the count of newly-resolved invitations.

Called from `apps/web/middleware.ts` on session establishment (idempotent; no-op for users with no matching open invitations). Closes the edge case where an admin invites an email whose `auth.users` row already exists (no INSERT event for the trigger to fire on) — for example, a user who signed up for an unrelated reason before being invited, or a developer's test account.

**Stored procedure `public.check_invite_conflicts(p_email text, p_publication_id uuid)`:**

```sql
create function public.check_invite_conflicts(p_email text, p_publication_id uuid)
  returns text
  language sql
  security definer
  set search_path = public, auth
  as $$ ... $$;
```

Pre-flight conflict check called from the `invite-user` Edge Function before `inviteUserByEmail`. Returns one of `'ok'`, `'already_member'`, or `'invitation_pending'`. The `already_member` branch joins `auth.users` to `memberships` on lowercased email — this is the reason for `SECURITY DEFINER`: `auth.users` is not exposed to PostgREST under `authenticated` or `service_role` via the REST API, so the conflict check cannot be expressed as two inline queries from the Edge Function. The `invitation_pending` branch reads `public.invitations` directly. Grant: `service_role` only — the function is never called from an authenticated user surface and never returns row data, only the enum-shaped status string.

**RLS on `invitations`:**

Enabled in the same migration that creates the table.

```sql
alter table public.invitations enable row level security;

create policy "service_role full access invitations"
  on public.invitations for all to service_role using (true) with check (true);

create policy "authenticated admin select invitations"
  on public.invitations for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.publication_id = invitations.publication_id
        and m.role = 'admin'
    )
  );
```

The `authenticated` SELECT policy lets admins see their own publication's invitations (for the pending-invitations list view in the admin UI). No `authenticated` policies for INSERT, UPDATE, or DELETE — all mutations flow through the `invite-user` Edge Function under service_role, which re-verifies the caller's admin role server-side before any write.

The `(select auth.uid())` wrapping is the documented Supabase performance optimization that hoists the function call into an initPlan, evaluated once per statement rather than once per row.

**GRANTs:**

```sql
grant all on public.invitations to service_role;
grant select on public.invitations to authenticated;
grant execute on function public.handle_new_auth_user() to supabase_auth_admin;
grant execute on function public.resolve_pending_invitations() to authenticated;
```

The grant of `handle_new_auth_user()` to `supabase_auth_admin` is required because the trigger fires under that role's identity. Without the grant, the trigger raises permission-denied and signup breaks (the failure mode the EXCEPTION wrapper specifically defends against, but the grant prevents the failure in the first place).

**`memberships.user_id` FK verification:**

Verify the existing FK `memberships.user_id → auth.users.id` has `ON DELETE CASCADE`. If not, the same migration alters it. Without cascade, deleting a user from `auth.users` (Supabase Dashboard, admin SDK) orphans the membership row and produces FK violations as "violates foreign key constraint memberships_user_id_fkey on table memberships." Widely-reported Supabase footgun.

**Storage bucket.** No new bucket.

**Pass 2 status.** No change. Remaining deferred from prior slices unchanged.

---

# Stage 7 — auth subset (as built)

Magic-link only. No passwords, no OAuth at v1.

**Supabase Auth → URL Configuration.**

- **Site URL.** `https://duly-noted.pages.dev` (production Cloudflare Pages domain). Will move to `https://dulynoted.report` once the apex domain is wired in. Until DNS resolves for the apex domain, the Site URL must remain on `pages.dev` — premature switching breaks magic-link delivery (the link emails out with an unresolvable hostname).
- **Redirect URLs (allowlist).**
  - `https://duly-noted.pages.dev/auth/callback` — production
  - `https://*.duly-noted.pages.dev/auth/callback` — Cloudflare Pages preview deploys
  - `http://localhost:3000/auth/callback` — local dev

**Email provider.** Supabase's built-in SMTP at v1 (rate-limited; sufficient for the small allowlist). Custom SMTP / Resend deferred to a later stage if rate limits become a problem.

**Web env vars (Cloudflare Pages).**

| Var                             | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL (publishable)                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon publishable key. RLS enforces access. |

The service-role key, the ASR vendor key, the embedding vendor key (`OPENAI_API_KEY`), and the webhook secret never reach Cloudflare. Webhook receivers run on Supabase Edge Functions (Stage 2); the search query-embedding surface runs on Supabase Edge Functions (Stage 9). Cloudflare Pages env is publishable-keys-only.

**Flow.** `apps/web/src/app/login/page.tsx` calls `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + '/auth/callback' } })`. Closed signup: only emails that already have an `auth.users` row (created by `inviteUserByEmail` at invitation time) can request a magic link. Random emails entered at the login form receive a generic auth error; the form copy directs unrecognized users to contact their administrator. The user clicks the email, lands at `/auth/callback?code=…`, the route handler exchanges the code for a session via `exchangeCodeForSession`, and the Supabase cookie is written by the SSR helpers. `apps/web/middleware.ts` refreshes the session cookie on every non-asset request and additionally calls `resolve_pending_invitations()` on session establishment to resolve any open invitations whose `auth.users` row pre-existed the invitation (rare; see Slice 7 schema deltas). `POST /auth/signout` clears the cookie.

**Invitations and admin onboarding (Slice 7).**

Membership provisioning is invitation-based, not self-serve. The invitation lifecycle:

1. An admin of a publication (or, for the initial bootstrap, Andy with service-role access) creates a pending invitation by calling the `invite-user` Edge Function. The Edge Function inserts a row into `public.invitations` (email + publication_id + role + invited_by_user_id) and calls `supabase.auth.admin.inviteUserByEmail(email)`. Supabase creates the `auth.users` row (with `email_confirmed_at = NULL`) and sends the default Supabase Invite email template.
2. The `on_auth_user_created` trigger on `auth.users` fires at INSERT time. Its function `handle_new_auth_user()` finds open invitations matching `NEW.email`, inserts the corresponding `memberships` rows (idempotent via `ON CONFLICT DO NOTHING`), and marks the invitations `accepted_at = now()`. Membership exists in the database before the user authenticates; authentication is gated by the email-click confirmation.
3. The invited user clicks the email link, lands at `/auth/callback`, exchanges the code for a session. RLS opens to them based on the membership row created in step 2. `resolve_pending_invitations()` runs in middleware as defense-in-depth; for the inviteUserByEmail path it is a no-op because the trigger already resolved the invitation.

Schema, trigger, RPC, RLS, and grants are detailed in §"Slice 7 schema deltas" above.

**Admin UI surface (Slice 7).**

A single admin route ships at `/{publication.slug}/admin/members`. Server component, authenticated, with an additional admin-role check on the requested publication (server-side `SELECT role FROM memberships WHERE user_id = auth.uid() AND publication_id = $? AND role = 'admin'`; on no match the page returns `notFound()` to hide the route from non-admins). Page content:

- Invite form: email input (validated lowercase), role selector (`reader` | `editor` | `admin`), submit. Posts via server action to the `invite-user` Edge Function with the caller's JWT.
- Pending invitations table: rows from `invitations WHERE publication_id = $? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, ordered by `created_at DESC`. Columns: email, role, created_at, expires_at. RLS-filtered to the current publication's admins per the `authenticated admin select invitations` policy.

The admin UI does NOT ship at v1: member list view (active memberships), role change UI, member removal UI, revoke pending invitation UI, resend invitation UI, audit log view. These residual surfaces stay in Backlog B4. The Slice 7 admin surface is narrowly scoped to "invite a new member and see what's pending," which is the minimum that gives the publication operator (Aaron) self-service ability without an admin chokepoint at Andy.

**Edge Function `invite-user`.**

Lives at `supabase/functions/invite-user/`. Receives `POST { email: string, role: 'reader' | 'editor' | 'admin', publication_id: uuid }`. JWT verification ENABLED at the gateway (user-facing function, not a vendor webhook). Body:

1. Verify JWT, extract `auth.uid()`.
2. Re-verify admin role server-side: `SELECT 1 FROM memberships WHERE user_id = auth.uid() AND publication_id = req.publication_id AND role = 'admin'`. Return 403 if no match. (The web layer's role check is the first gate; this is defense-in-depth — the Edge Function never trusts the web client's claim about the caller's role.)
3. Validate input: email regex + lowercase normalization, role in the allowed set, publication_id is a uuid.
4. Check for conflicts by calling `public.check_invite_conflicts(p_email, p_publication_id)` (RPC defined in §"Slice 7 schema deltas"). On `'already_member'` return 409 with "already a member" message; on `'invitation_pending'` return 409 with "invitation already pending" message; on `'ok'` proceed.
5. `INSERT INTO invitations (email, publication_id, role, invited_by_user_id) VALUES (lower(req.email), req.publication_id, req.role, auth.uid())`.
6. Call `supabase.auth.admin.inviteUserByEmail(email)` with service_role client. On vendor error, mark the just-inserted invitation `revoked_at = now()` for cleanup and return the vendor error.
7. Return 200 with the invitation id.

The Edge Function is the only surface that calls `auth.admin.inviteUserByEmail` in the system. `apps/web` does not hold the service-role key and cannot call admin APIs directly — per CLAUDE.md §6's service-role boundary preserved via Edge Function intermediation.

**Closed signup posture.**

`shouldCreateUser: false` on the login form means random emails cannot self-register. The only paths into `auth.users` at v1 are:

- `inviteUserByEmail` from the `invite-user` Edge Function (admin-triggered).
- Manual `inviteUserByEmail` or `createUser` from Andy's local script (initial bootstrap of Aaron's admin membership).

There is no public signup surface. The Stage 8 "Authenticated user with no membership row" edge case can still occur (e.g., an invitation expires before the user clicks, or an admin revokes an invitation after `auth.users` creation), but the surface area for unintended access is bounded to invited-then-revoked rather than open-to-anyone.

**Trigger timing note.** The `on_auth_user_created` trigger fires at `auth.users` INSERT, which for the `inviteUserByEmail` path is at invitation creation, not at the user's first click. Membership therefore exists in the database before `email_confirmed_at` is set. This is safe: the user cannot authenticate (no session, no JWT) until the magic-link click, so RLS gates remain effective. The "membership before email confirmation" ordering would only be a defect if a future audit conflated authentication (the click) with authorization (the membership row); it does not.

**External dependency note.** `auth.users` is a Supabase-managed schema. The trigger function depends on the stable shape of `auth.users.id` (uuid), `auth.users.email` (lowercase text), and the existence of an INSERT event on row creation. Revisit trigger: any Supabase changelog entry touching the schema of `auth.users.id`, `auth.users.email`, or modifying the auth subsystem's transactional INSERT semantics.

**Open items.** None as of Slice 7. Custom SMTP migration deferred until the small-allowlist rate cap becomes a problem.

---

# Stage 8 — Reader UI (as built)

**Method.** Authenticated reader for meetings at `status = 'published'`. Single Next.js App Router app on Cloudflare Pages, reading Supabase via the SSR client. Read-only surface; no write paths or pipeline triggers from the reader. Stage 7 auth scaffold is reused — middleware refreshes the session cookie on every non-asset request, the SSR helper reads it.

**URL structure.** Tenant-explicit from day one. The publication slug appears in every reader URL even though one publication is configured at v1, so existing URLs do not need to rewrite when a second tenant ships.

```
/login                                                              magic-link entry
/auth/callback                                                      magic-link exchange
/                                                                   redirects to the user's publication root
/{publication.slug}                                                 town list
/{publication.slug}/{town.slug}                                     board list
/{publication.slug}/{town.slug}/{board.slug}                        meeting list (published only)
/{publication.slug}/{town.slug}/{board.slug}/{meeting.id}           meeting page (hybrid layout)
/{publication.slug}/search?q=...                                    search (Stage 9, Slice 6)
/{publication.slug}/admin/members                                   admin: invite form + pending list (Slice 7, admin role only)
```

Meeting URLs use `meeting.id` (uuid) rather than a slug. `meetings` carries no human-readable unique slug today and `meeting_date` is not unique within a board across schedule edits or special meetings; uuid is the only stable key. A future slice can introduce a date-plus-discriminator slug without breaking the existing uuid URLs (additive route).

**Page composition.**

- Town list — reads `towns WHERE publication_id = ?` (RLS-enforced). Each town links to its boards page.
- Board list — reads `boards WHERE town_id = ?`.
- Meeting list — reads `meetings WHERE board_id = ? AND status = 'published'`, ordered `meeting_date DESC`. Each row shows date, title, segment count.
- Meeting page (hybrid layout):
  - Header: meeting title, `meeting_date`, board name, town name, link to the YouTube source video.
  - Summary block: `meetings.summary` rendered as prose at the top.
  - Segments list: rows ordered by `sequence_order` (with `id` as a stable secondary key for any duplicate-order anomaly). Each segment renders as a card containing: title, marker_type badge, description, an embedded YouTube iframe deep-linked to the segment start, and the segment's `transcript_excerpt` (collapsed by default).

The hybrid layout matches the locked product decision: summary at top, chaptered segments below, YouTube timestamp links as the V1 verification surface.

**YouTube embed pattern.** Per-segment iframe with `?start={start_time_seconds}` in the URL, not page-level embed with JS-driven `seekTo`. Per `kb_video-timestamp-linking-ux_2026-04-29_v1` (parts: `implementation-patterns`, `tos-findings`, `ux-reference`): the `?start=` parameter is documented and reliable, and the IFrame API ready handshake required for `seekTo` adds implementation surface that the V1 verification-surface intent does not need. `?start=` resolves within ~2 seconds of the requested timestamp due to keyframe alignment; segment boundaries are already approximate at the ~30-second granularity the segmenter produces, so the keyframe drift is within tolerance.

**B3 — YouTube unavailability handling.** The per-segment iframe is wrapped in a client component that listens for IFrame API `onError` events. On codes 100 (video removed), 101/150 (embedding disabled by owner), or 153 (live stream unavailable; rare for our corpus), the wrapper renders a fallback panel in place of the bare YouTube error UI: a status line ("Video unavailable"), the segment's `transcript_excerpt` un-collapsed (it becomes the only content surface), and a link to the YouTube watch page (which can still work when embedding is disabled — the user can verify directly). The wrapper does not mutate the database; only the player surface degrades. Per `kb_video-timestamp-linking-ux_2026-04-29_v1_youtube-unavailability`, the IFrame API does not distinguish "removed" from "made private," so the fallback copy stays generic.

**Auth integration.** Reuses Stage 7 wiring. `apps/web/middleware.ts` refreshes the Supabase session cookie on every non-asset request and redirects unauthenticated requests to `/login` from any route outside `/login`, `/auth/callback`, and Next.js asset paths. Server components read via `createServerClient` from `@supabase/ssr`; client components are used only where interactivity demands (the iframe-error wrapper, the optional collapsed-transcript toggle).

**RLS expansion (Stage 5 pass 2 partial).** Adds membership-aware `authenticated` SELECT policies + matching table-level GRANTs on `publications`, `towns`, `boards`, `meetings`, `segments`, `memberships`. Policy shapes are detailed in §"Slice 5 schema deltas" above. Membership-aware in shape, flat in effect at single-tenant config: every authenticated user has one membership row, so the JOIN resolves to the same publication for everyone. The shape is the load-bearing piece — when a second tenant ships, the boundary already does the right thing without policy rewrite.

**Bootstrap and edge cases.**

- Authenticated user with no membership row: reader pages render empty. No auto-grant on signup; the invitation-based path established in Slice 7 is the sole provisioning route. Andy bootstraps Aaron's admin membership via a one-shot SQL `INSERT INTO invitations` plus `inviteUserByEmail` script invocation; after that bootstrap, all further invitations flow through the `/{publication.slug}/admin/members` admin UI. Bulk CSV invite remains in Backlog B8.
- Direct URL access to a `meetings.id` at `status != 'published'`: 404. RLS hides the row from the SSR client; the page renders the standard not-found surface.
- Direct URL with a publication/town/board slug the user has no membership for: 404 on the same RLS path.
- Direct URL to `/{publication.slug}/admin/members` by a non-admin authenticated user: 404 via `notFound()` (per the admin-role check in the page's server component; the RLS policy on `invitations` is the defense-in-depth boundary, the explicit check is the contract-level boundary). The 404 is indistinguishable from a route that doesn't exist, which is the intended behavior for surfaces a non-admin should not know about.

**Failure modes.**

- Empty segments list on a published meeting: renders the summary alone with a note that no segments are available. Should not occur post-Slice-3 (the segmenter writes ≥1 segment or fails the row); guarded so a partial-write edge case does not break the page.
- Transient Supabase auth-refresh failure mid-page: middleware catches, redirects to `/login`. The user re-authenticates and lands back at the requested URL via the `redirectTo` param.
- YouTube iframe error: B3 fallback above.
- Segment ordering anomaly (duplicate `sequence_order`): rendered in `(sequence_order, id)` order to keep the page deterministic across loads.

**Email provider for magic-link delivery.** Slice 5 closes the Stage 7 deferral. Provider as-built: Supabase built-in SMTP. The built-in tier was sufficient through slice build (no real auth volume yet) and a future slice migrates to custom SMTP if production volume demands.

**Cost expectation at v1 scale.** Cloudflare Pages free tier covers the reader. Supabase reads are RLS-filtered SELECTs against indexed columns; no new vendor cost. Magic-link emails on the built-in tier are free within the rate cap; custom SMTP via Resend is ~$0/month at the small allowlist size (Resend's free tier is 100 emails/day, well above v1 need).

**Locked decisions.** ADR 0020 — "Reader UI v1 ships without search." Status moves to "Superseded by Slice 6" when Slice 6 ships (the search slice referenced by ADR 0020's revisit trigger). Until that transition, ADR 0020 governs the reader-without-search shape.

---

# Stage 9 — Search (as scoped)

**Method.** Hybrid keyword + semantic search across `segments` of published meetings, scoped to the user's publication via existing RLS. Lexical arm uses Postgres native FTS (`tsvector` GIN, `ts_rank_cd` cover-density ranking). Semantic arm uses pgvector with OpenAI `text-embedding-3-small` (1536 dims, native). Both arms are fused in SQL via Reciprocal Rank Fusion inside the `search_segments` RPC.

The pattern follows Supabase's published hybrid-search reference (`supabase.com/docs/guides/ai/hybrid-search`) with two material adjustments: native 1536 dimensions (rather than the Matryoshka-truncated 512 used in Supabase's example) and weighted `tsvector` segments (A/B/C across title/description/transcript_excerpt) rather than a single unweighted content field.

**URL structure.** Single new authenticated route, publication-scoped per Stage 8 convention:

```
/{publication.slug}/search                                          search input + results
/{publication.slug}/search?q=<query>                                rendered results
```

The page is a server component that reads `searchParams.q`, calls the Edge Function with the query string, renders results. No client-side data fetching at v1.

**Page composition.**

- Search input at the top. Submit via form action (GET) so the query lives in the URL and back-navigation works.
- Result cards, ranked by RRF score. Each card shows: town name / board name / `meeting_date` / meeting title / segment title / `marker_type` badge / a snippet from `transcript_excerpt` (no `ts_headline` highlighting at v1; the snippet is the leading characters truncated). Click target = existing meeting page with a segment-id anchor.
- "Show more" link appears when result count is at the configured `match_count` boundary. No deeper pagination at v1.
- Empty-state copy when the query returns no results.

**Edge Function `search`.** Lives at `supabase/functions/search/`. Receives `POST { query: string, match_count?: number }`. Verifies the caller's JWT (not disabled — distinct from `asr-webhook` which is a vendor callback). Embeds the query via OpenAI `text-embedding-3-small`, then calls the `search_segments` RPC server-side with the user's JWT passed through (so RLS gates results), supplying both the query string for the lexical arm and the embedding for the semantic arm. Returns the result set. Single round trip from the browser.

The Edge Function is the only surface that holds `OPENAI_API_KEY` at query time. The worker holds the same key at index time. The web app holds neither and depends on the Edge Function for query embedding.

**Embedding pipeline (worker side).** New `apps/worker/src/embedding/` handler picks up `embedding` rows via `claim_embedding_meeting()`, generates one embedding per segment via OpenAI (model `text-embedding-3-small`, dimensions 1536 native), writes via `complete_embedding`, advances the row to `published`. Failure path uses `abandon_embedding_meeting` to set `failed` with `last_error`. Failure modes mirror Stage 6:

- OpenAI API timeout, 429, or 5xx: worker retries up to 3× with exponential backoff (1s, 4s, 16s); honors `retry-after` headers when present. After exhaustion, the row fails.
- Length-bound coverage: `text-embedding-3-small` has an 8,192 token input cap. v1 inputs are structurally bounded by `TITLE_MAX_LEN + DESCRIPTION_MAX_LEN + TRANSCRIPT_EXCERPT_MAX_LEN` (set in `packages/shared/src/embedding/inputs.ts`), well under 8K tokens via the ~4-char-per-token proxy. The structural bound is the operative contract. Revisit if any of those constants is raised or the embedding model is changed.
- Empty `segments` array at pickup: handler fails the row before any API call. Should not occur post-Slice-3.
- Response-shape validation: each returned embedding is Zod-validated for length (must equal 1536) and element type (number) before persistence.

**Backfill.** One-shot script `apps/worker/scripts/backfill-embeddings.ts`. Reads cloud Supabase service-role credentials from local env. Queries `meetings WHERE status = 'published'` joined to `segments WHERE embedding IS NULL`. For each meeting, generates per-segment embeddings and writes them via direct UPDATE (not via the RPC, which assumes the state-machine path). No status transition — backfill is for rows that already published before the new pipeline existed. Idempotent: re-running against a fully-backfilled corpus is a no-op.

**Search query flow.**

1. User navigates to `/{publication.slug}/search?q=...`.
2. Server component constructs the Edge Function request with the user's JWT in the Authorization header (forwarded from the SSR session) and the query in the POST body.
3. Edge Function verifies JWT, calls OpenAI embeddings, calls `search_segments` RPC server-side (passing the caller's JWT), returns results.
4. Server component renders the results list.

The `search_segments` RPC runs as the caller's role, so the membership-aware RLS policies on `segments` and joined parent tables (`meetings`, `boards`, `towns`, `publications`) gate the result set. A user without a membership row sees an empty result set.

**Failure modes (UI surface).**

- Edge Function 500 or timeout: page renders an error state with retry affordance.
- Empty results: empty-state copy ("No segments matched. Try different keywords.").
- User has no membership: results are RLS-filtered to empty; UI renders the same empty-state copy.

**Out of scope at Slice 6.**

- Faceted filters by `marker_type` (no chips). Defer until query-log data motivates the surface.
- Autocomplete / typeahead.
- `ts_headline`-driven snippet highlighting beyond basic substring rendering.
- Embedded search bar in list pages — standalone route only.
- Pagination beyond a single "show more" affordance at result count > `match_count`.
- Indexing `meetings.summary` (segments only; summary lives at the top of the meeting page where any segment hit lands).
- Cross-publication search (single-tenant lock).

**Cost expectation at v1 scale.** Backfill: <$0.01 at current corpus (single-digit published meetings, low-hundreds of segments, ~500 tokens per segment input). Recurring: ~$0.01/week per board ongoing at steady-state ingest. Query-time embeddings: ~$0.000002 per query at typical query length (well below 100 tokens). At any realistic v1 query volume, OpenAI cost is dominated by indexing, and indexing is negligible.

**Locked decisions.** ADR 0021 — Hybrid search via Postgres FTS + pgvector + SQL RRF. ADR 0022 — OpenAI text-embedding-3-small via Edge Function for query embedding. ADR 0020 — Reader UI v1 ships without search → status updates to `Superseded by Slice 6` when Slice 6 ships.

---

# Backlog / Slice candidates

Operational discoveries and deferred follow-ups that don't fit any of: wont-fix, audit finding, or current-slice fix. Each entry has three lines: What, Why, Trigger. Items are cut from the Backlog when a slice picks them up; git history preserves the entry, the live SPEC.md tracks only unaddressed work.

## B1 — `meetings.duration_seconds` cross-check against AssemblyAI `audio_duration`

- **What:** Replace or cross-check `meetings.duration_seconds` (set by cron from YouTube `videos.list contentDetails.duration`) with AssemblyAI's `audio_duration` field from `transcript.json`. AssemblyAI's value is authoritative for any chronology work that derives from the actual audio submitted to ASR.
- **Why:** Discrepancies surfaced during Slice 3 verification on meeting `a669dadb-816f-44a2-8d6c-54a6e2197ca1` (segmented end-to-end at 2026-05-09T21:38:15Z). YouTube's `contentDetails.duration` reflects the published video; AssemblyAI's `audio_duration` reflects the audio actually transcribed. They can drift on edited or re-encoded uploads.
- **Trigger:** Next worker handler that opens `transcript.json` for any reason. Slice 4 (summarization) runs segments-only and does not open the file, so B1 does not bundle into Slice 4. Slice 6 (embedding) also operates segments-only and does not open the file. Likely natural triggers: B5 (transcript-aware summarization, if it ships) or any V2 grounding/verification work that needs raw transcript text.

## B2 — NOT NULL on `meetings.duration_seconds`

- **What:** Tighten `meetings.duration_seconds` to NOT NULL.
- **Why:** Cron always populates the field at row creation; nullable column is a vestige of the pre-Slice-2 schema. A NOT NULL constraint catches future code paths that bypass cron (manual inserts, alternative ingestion sources) which would otherwise silently propagate a null through downstream code that assumes a value.
- **Trigger:** B1 ships and any historical rows are backfilled. The constraint tightening is the contract step in an expand/contract cycle; B1 is the expand.

## B4 — Operator review gate at `review → published` + residual admin surfaces

- **What:** Two related deferred surfaces bundled under one backlog entry because they share the admin-UI route prefix `/{publication.slug}/admin/...` introduced by Slice 7.
  - **B4a — Operator review gate.** Operator review UI that reads meetings in `review` state, presents segments + summary with edit affordances, and advances `review → published` on operator approval. Until this lands, the worker auto-advances `summarizing → embedding → published` directly in Stages 6 and 9 with no human gate; no row sits in `review` at v1.
  - **B4b — Residual member-management surfaces.** Slice 7 shipped only the invite form and the pending-invitations list view under `/{publication.slug}/admin/members`. The remaining admin operations stay deferred: member list view (active memberships with role display), role change UI, member removal UI, revoke pending invitation UI, resend invitation UI, audit log view of past invitations. Each is a real operational capability but none blocks the demo or the manual QA sweep — Andy can SQL-correct edge cases (typo'd invitations, removals, role corrections) until the residual UI lands.
- **Why:**
  - B4a: Oberoi's documented practice is 10–30 min per meeting of human review (entity mistranscriptions, chapter boundaries, summary inaccuracies). V1 deviates because no operator UI exists and an operator gate without UI orphans every completed meeting at `review`. Whether the gate is load-bearing for newsroom-grade publication is unknown — depends on observed quality of summarization output and downstream-publication risk tolerance. The `review` slot in the `meeting_status` enum is preserved for this slice.
  - B4b: The Slice 7 admin surface was narrowly scoped to the operational chokepoint that demo-blocked (Aaron self-serving invites). The residual surfaces are quality-of-life rather than chokepoint-of-flow; deferring them keeps Slice 7 small and ships them when their absence becomes friction rather than as speculative scope.
- **Trigger:** Either (a) post-publication audit of v1 output reveals systematic errors that operator review would have caught (fires B4a), or (b) the residual admin surfaces become friction operationally — Aaron requests a role-change UI, a member-list view, or revoke-resend tooling (fires B4b), or (c) the slice that builds either surface picks the other up alongside given the shared route prefix. Whichever fires first.

## B5 — Transcript-aware meeting summarization

- **What:** Alternative summarization path where the handler reads `transcript.json` and passes raw transcript context to the LLM call alongside (or instead of) the segments-only input shipped in Slice 4. Bundles B1 (handler is opening `transcript.json` anyway).
- **Why:** Slice 4 ships segments-only summarization on the hypothesis that segment titles + descriptions + transcript_excerpts carry enough context for a faithful meeting summary. Whether richer context from the raw transcript yields meaningfully better quality is unproven. Bundling transcript-read into the production handler couples B1 and adds I/O + token cost without quality evidence.
- **Trigger:** Run an offline eval first. Add `apps/worker/scripts/eval-summary-prompts.ts` (one-off, not on the hot path; reads a `meeting_id`, runs both prompts — segments-only vs. transcript-aware — against the same Anthropic call, dumps both summaries side-by-side for human comparison). Run on 3–5 representative meetings spanning marker-type distribution. If transcript-aware wins consistently, ship B5 as a slice (which automatically ships B1). If the segments-only summary is qualitatively comparable, B5 stays deferred and the eval script is the durable record of "we tested both ways."

## B6 — Speaker-identification pre-pass + board member roster

- **What:** Add a separate LLM pass that runs between `transcribing` and `segmenting`, mapping AssemblyAI diarization speaker labels (Speaker A, Speaker B, ...) to actual names using a board-member roster stored on the `boards` table (e.g. `boards.member_names text[]`, plus optional position/role fields). Persist the resolved mapping per segment so downstream stages and the reader UI carry actual names rather than diarization labels.
- **Why:** Oberoi's full metadata-grounding pattern (KB `kb_hallucination-mitigation-summarization` C2/C3) requires this pre-pass to enable named-entity grounding in the summarization prompt. V1 deviates: Stage 6's grounding rule preserves diarization labels rather than resolving them to names, accepting that summaries may read as "Speaker A proposed..." instead of "Selectman Smith proposed..." Whether this hurts readability for newsroom-grade publication is unknown.
- **Trigger:** Post-publication audit of v1 summaries reveals that diarization-label preservation systematically obscures who said what, OR an operator audit catches name fabrication that the v1 prompt rule failed to prevent. Implementation requires schema (member roster column on `boards`), an admin path to populate it, and the new LLM stage in the worker — large enough to be a slice on its own, not a follow-up.

## B7 — Pre-launch test sweep

- **What:** Dedicated slice reviewing test coverage across the deployed system before v1 launch. Targets: end-to-end pipeline integration test (ingest → ASR → segment → summarize → embed → render), cross-publication RLS isolation (closes deferred coverage from Slice 5 Q1 — towns/boards/meetings/segments policies untested in `packages/db/src/rls.test.ts`), smoke-test pack against production after deploy, manual QA checklist for the reader surface (login flow, all four list pages, meeting page with segments, YouTube iframe error paths, search route happy/sad paths).
- **Why:** Per-slice audits enforce coverage ratio at the slice scope. Cross-cutting integration paths and deferred coverage decisions accumulate across slices and need a sweep before users see the product. The end-to-end integration test is the single artifact that catches "all the pieces line up" — no individual slice owns it.
- **Trigger:** Slice 6 (search) ships and pre-launch readiness becomes the next planning concern; or any cross-slice regression surfaces in operational verification.

## B8 — Config-seed script for tenant boards

- **What:** A one-shot script (`apps/worker/scripts/seed-tenant-config.ts` or equivalent) that reads a CSV (publication / town / board / YouTube channel ID / title pattern / min duration / ingest_since_days / membership emails with roles) and runs the corresponding INSERTs into `publications`, `towns`, `boards`, and (post-Slice-7) `invitations` plus a batched call to `inviteUserByEmail` for each invited member. Idempotent (`ON CONFLICT ... DO NOTHING` or matching upsert per row; the partial unique index on `invitations` handles the invite-side idempotency natively). The KB inventories at `kb_knox-county-municipal-video`, `kb_waldo-county-municipal-video`, and the `kb_meeting-cadence-*` files are the source data for the CSV's initial population.
- **Why:** v1 ships with one board (Lincolnville Select Board) configured via hand-written SQL — fine at single-board scale. As coverage expands toward full Midcoast Villager geography (Knox County 18 municipalities + Waldo County 26 municipalities + Hancock County + MDI = roughly 20–30 candidate boards with verified video presence per the KB inventories), hand-rolling INSERTs becomes the friction the build was meant to avoid. Per the local-govt-meeting-apis KB synthesis, no third-party API serves the target Maine geographies (GatherGov, Council Data Project, Legistar, and CivicBand all received FAILS-TO-SERVE verdicts) — the only feasible automation is a seed script reading the KB's already-completed research as a CSV. The membership-side of the script writes through `invitations` (the Slice 7 path) rather than direct `memberships` inserts, so seeded users go through the trigger-driven resolution flow like every other invited user.
- **Trigger:** A second board or a second publication is provisioned. At that point the CSV-to-SQL workflow is more efficient than additional hand-INSERTs. Until then, hand-rolling matches the actual volume.
