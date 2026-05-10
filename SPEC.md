# SPEC.md — Stage 1: Foundation and Stack

## Deployment topology

Four surfaces:

- **Cloudflare Pages** — Next.js (App Router) web app at `dulynoted.report`. Stateless. Reader UI and admin UI. No webhook receivers, no long-running compute.
- **Supabase Pro** — Postgres (data, RLS), Auth (magic link), Storage (audio + transcript artifacts), and Edge Functions (Deno runtime) for vendor webhook receivers.
- **Render** — `apps/worker` Background Worker (Starter, $7/mo) running the ingestion and pipeline state machine; `apps/worker-cron` Cron Job ($1/mo) discovering new YouTube uploads hourly.
- **AssemblyAI** — managed ASR vendor, Universal-3 Pro tier. Receives signed Supabase Storage URLs; calls back to a Supabase Edge Function on completion.

Postgres is the queue. The Render worker advances meeting state by polling rows on `meetings.status`; no Redis, SQS, or external queue at v1.

## Background job architecture

State machine on `meetings.status`:

```
discovered → pending → extracting → transcribing → segmenting → summarizing → review → published
                                                                              ↘  failed
```

- **Cron Job** writes new `discovered` rows from YouTube Data API responses, then auto-promotes to `pending` based on per-board title pattern + minimum duration.
- **Worker** picks up `pending` rows with `SELECT ... FOR UPDATE SKIP LOCKED`, runs `yt-dlp` to extract audio, uploads to Supabase Storage, submits a signed Storage URL to AssemblyAI, and parks the row at `transcribing`.
- **Supabase Edge Function** (`asr-webhook`) receives the AssemblyAI callback, verifies the `X-DulyNoted-Webhook` auth header, fetches the full transcript JSON from AssemblyAI, writes the artifact to Storage, advances state to `segmenting`. The Edge Function is the only surface that holds both `ASR_VENDOR_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` simultaneously; this is the architecturally chosen surface for the receiver.
- **Worker** picks up `segmenting` rows, runs the LLM segmentation pass, advances to `summarizing`. Picks up `summarizing` rows, runs the meeting-summary pass, auto-advances `summarizing → published` directly. The `review` enum slot is reserved for the future operator review UI slice (see Backlog B4); no row sits in `review` at v1.

Failure semantics: any step that errors writes `status = 'failed'`, a `last_error` field, and `failed_at`; the worker re-polls `failed` rows only on manual reset (no automatic retry storms). Worker invocations are idempotent — picking up the same row twice never double-charges the ASR vendor or double-writes a segment.

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
│   ├── functions/      # Edge Functions (Deno) — vendor webhook receivers
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

Per-surface secret list:

| Secret                          | Cloudflare Pages | Render Worker | Render Cron | Supabase Edge Function |
| ------------------------------- | ---------------- | ------------- | ----------- | ---------------------- |
| `SUPABASE_URL`                  | —                | yes           | yes         | yes (built-in)         |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes              | —             | —           | —                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes              | —             | —           | —                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | —                | yes           | yes         | yes (built-in)         |
| `YOUTUBE_API_KEY`               | —                | —             | yes         | —                      |
| `ASR_VENDOR_API_KEY`            | —                | yes           | —           | yes                    |
| `ANTHROPIC_API_KEY`             | —                | yes (Slice 3) | —           | —                      |
| `ASR_WEBHOOK_SECRET`            | —                | yes           | —           | yes                    |

`ASR_WEBHOOK_SECRET` is set on the Render worker (which injects it as the `webhook_auth_header_value` in AssemblyAI submit calls) and on the Supabase Edge Function (which verifies the inbound `X-DulyNoted-Webhook` header against it). Cloudflare Pages does not touch the webhook flow.

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

Variable cost (ASR, LLM, embeddings, egress) is set in Stages 2, 4, 6.

## Changelog note for KB

`kb_civic-sunlight-mvp-cost-model_2026-04-29_v1.xml` is built on a Vercel + Supabase Pro assumption. The Stage 1 decision moves hosting to Cloudflare Pages and adds a Render line. Net annual fixed cost moves from ~$540/yr to ~$408/yr. The model's CONFLICT-06 (Vercel ToS) and SS-03 are no longer load-bearing. CONFLICT-07 (Supabase Pro inactivity pause) still binds. The cost model file remains the authoritative reference for ASR and LLM lines, with the additional ASR-vendor binding established in Stage 2.

**Locked decisions:** see ADR 0001 (Render Background Worker for the pipeline) and ADRs 0002–0007 for the remaining Stage 1 decisions.

**Open items inherited by later stages:**

- ~~Stage 2: ASR vendor selection~~ — closed in Stage 2 below.
- ~~Stage 3: audio extraction path~~ — closed in Stage 3 below.
- ~~Stage 4: segmentation methodology~~ — closed in Stage 4 below.
- ~~Operator review step inclusion sets the `review` state semantics.~~ — closed in Stage 6 below: v1 auto-advances `summarizing → published` directly. Operator review gate deferred (Backlog B4).
- Stage 5: full DDL for `meetings.status` enum, including index and constraint design (pass 2). Slice 2/3/4 deltas in Stage 5 below cover the ingest+segmentation+summarization-load-bearing subset; pass 2 still pending.

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
- `videos.list?id={comma-separated-new-ids}&part=contentDetails,snippet` — 1 unit, batched up to 50 IDs
- Total: 2 quota units per board scan, regardless of how many videos are returned (within batch limits)
- `search.list` is **forbidden** (100 units/call)

Cron schedule: hourly (`0 * * * *`). Lincolnville Select Board meets monthly; hourly is overkill but predictable and cheap.

**Auto-promotion `discovered → pending`.** Per-board rule: cron INSERTs new rows at `status = 'discovered'` with title and `duration_seconds`, then updates to `pending` where:

```sql
status = 'discovered'
AND duration_seconds >= boards.min_duration_seconds
AND title ~* boards.title_pattern
```

For Lincolnville Select Board:

- `title_pattern = 'select board'`
- `min_duration_seconds = 600`

Town Meeting and Planning Board content on the same channel are separate board entities with their own patterns when added.

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
- `complete_summarization(meeting_id uuid, summary text)` — atomically writes the summary, sets `summary_generated_at = now()`, advances status from `summarizing_inflight` to `published`, with `WHERE status = 'summarizing_inflight'` providing write-side idempotency under any duplicate-call edge case.

Failure path mirrors Slice 3's: a separate UPDATE (or an `abandon_summarizing_meeting` RPC if Slice 3 has the parallel) sets `summarizing_inflight → failed` with `last_error` and `failed_at` populated.

The single user-facing transition is `summarizing → published`. The `review` enum slot is reserved for the future operator review UI slice (Backlog B4); no row sits in `review` at v1. The `summarizing_inflight` state is a transient implementation detail not shown in the §"Background job architecture" diagram, paralleling Slice 3's transient `chaptering` state.

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

**Enum.** `public.meeting_status` matches the state machine in §"Background job architecture": `discovered, pending, extracting, transcribing, segmenting, summarizing, review, published, failed`.

**Identity.** No `public.users` table. `auth.users` is canonical; `memberships.user_id` joins against it directly. A `public.profiles` table can be added in pass 2 if profile fields land on the roadmap.

**Indexes.** Only the primary keys and the `unique` constraints listed above. Postgres does not create indexes on FK referencing columns — only on the referenced (PK) side. The composite UNIQUEs on `towns` and `boards` happen to cover their FK columns as the leading column, which is incidental. FK-side indexes for `meetings.board_id`, `memberships.publication_id`, and any other referencing columns are deferred to pass 2 alongside performance-tuning indexes (status filtering, date ordering, search).

**Grants.** Supabase API access requires both RLS policies and table-level `GRANT`s for the `anon`, `authenticated`, and `service_role` roles. The scaffold migration grants SELECT on `_scaffold_health`; pass 2 grants the rest as policies are written. (Codified in the `*_grant_scaffold_health_select.sql` follow-up migration.)

## Slice 2 schema deltas

Additive, single migration file `NNNN_slice_2_ingestion_schema.sql`, backwards-compatible with the previously deployed worker.

**Boards table additions:**

- `youtube_channel_id text` (nullable; cron skips boards without one)
- `title_pattern text` (nullable; Postgres `~*` regex; cron auto-promote rule)
- `min_duration_seconds int default 0` (cron auto-promote rule)
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

**Storage bucket.** No new bucket. Segments live entirely in Postgres; no Storage artifact for segments at v1. (Search slice will add pgvector + tsvector columns in pass 2.)

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns, search columns on both `meetings` and `segments`.

## Slice 4 schema deltas

Additive, single migration file `NNNN_slice_4_summarization_schema.sql`, backwards-compatible with the previously deployed worker.

**Enum addition:**

```sql
alter type public.meeting_status add value 'summarizing_inflight' before 'review';
```

Transient state for the worker's claim/complete pattern (see Stage 6 §State transition), paralleling Slice 3's `chaptering`. Not shown in the §"Background job architecture" state diagram — implementation detail. Postgres 14+ permits `ALTER TYPE ADD VALUE` inside a transaction, so this lands in the same migration file as the column additions.

**Meetings table additions:**

- `summary text` (nullable; populated when summarization succeeds and the row advances to `published`)
- `summary_generated_at timestamptz` (nullable; populated in the same `UPDATE` that writes `summary`)

Both columns are nullable indefinitely — historical rows that pre-date Slice 4 (none exist in production at the time of this slice, but the constraint matters for replay) carry NULL values until re-run, and rows that fail the summarization step never receive values. NOT NULL is deferred until and unless backfill completes; no Backlog entry needed because the nullable shape is correct as-is.

**Stored procedures (RPCs).** Mirror Slice 3's claim/complete pair:

- `claim_summarizing_meeting()` — opens a transaction, `SELECT ... FOR UPDATE SKIP LOCKED` on a row at `status = 'summarizing'` (LIMIT 1), atomic UPDATE to `status = 'summarizing_inflight'`, commit, return the row. Match Slice 3's `claim_segmenting_meeting()` shape and naming convention exactly.
- `complete_summarization(meeting_id uuid, summary text)` — atomically writes `summary`, `summary_generated_at = now()`, advances status from `summarizing_inflight` to `published`, with `WHERE status = 'summarizing_inflight'` for write-side idempotency. Match Slice 3's `complete_segmentation()` shape.
- Failure path follows whatever pattern Slice 3 uses for failed segmentation (separate `abandon_*` RPC or inline UPDATE) — match exactly; do not introduce a new failure-path style for this stage.

**Indexes.** None added. The summary column is reader-UI-rendered, not queried. No `WHERE summary IS NOT NULL` filter is needed at the database layer (the existing `WHERE status = 'published'` policy already filters to rows that successfully completed summarization).

**Trigger.** `set_updated_at()` already applies to `meetings` from Slice 2; the new columns are covered.

**RLS.** No new policy at Slice 4. The existing `authenticated` SELECT-where-status-published policy on `meetings` covers the new columns. Same pass-2 tenant-boundary deferral applies (NI-008). (Slice 5 replaces that policy with a membership-aware version; the new columns inherit the replacement.)

**Storage bucket.** No new bucket. Summary lives entirely in Postgres.

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns, search columns on both `meetings` and `segments` (search-on-summary lands when the search slice ships).

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

Pass 2 still deferred from prior slices: trigger on remaining tables, FK indexes on `memberships.publication_id` and other un-indexed FK-side columns, soft-delete columns, search columns on both `meetings` and `segments` (search-on-summary lands when the search slice ships).

---

# Stage 7 — auth subset (as built)

Magic-link only. No passwords, no OAuth at v1.

**Supabase Auth → URL Configuration.**

- **Site URL.** `https://duly-noted.pages.dev` (production Cloudflare Pages domain). Will move to `https://dulynoted.report` once the apex domain is wired in.
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

The service-role key, the ASR vendor key, and the webhook secret never reach Cloudflare. Webhook receivers run on Supabase Edge Functions (Stage 2), not on the web app.

**Flow.** `apps/web/src/app/login/page.tsx` calls `signInWithOtp({ email, options.emailRedirectTo: window.location.origin + '/auth/callback' })`. The user clicks the email, lands at `/auth/callback?code=…`, the route handler exchanges the code for a session via `exchangeCodeForSession`, and the Supabase cookie is written by the SSR helpers. `apps/web/middleware.ts` refreshes the session cookie on every non-asset request. `POST /auth/signout` clears it.

**Open items.** None. Slice 5 closed the magic-link round-trip deferral; the reader UI ships behind authenticated routes, exercising the full sign-in flow end-to-end. SMTP provider as-built: Supabase built-in SMTP. The decision is recorded inline in §Stage 8 and does not warrant a separate ADR.

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

**Auth integration.** Reuses Stage 7 wiring. `apps/web/middleware.ts` refreshes the Supabase session cookie on every non-asset request and redirects unauthenticated requests to `/login` from any route outside `/login`, `/auth/callback`, and Next.js asset paths. Server components read via `createServerComponentClient` from `@supabase/ssr`; client components are used only where interactivity demands (the iframe-error wrapper, the optional collapsed-transcript toggle).

**RLS expansion (Stage 5 pass 2 partial).** Adds membership-aware `authenticated` SELECT policies + matching table-level GRANTs on `publications`, `towns`, `boards`, `meetings`, `segments`, `memberships`. Policy shapes are detailed in §"Slice 5 schema deltas" above. Membership-aware in shape, flat in effect at single-tenant config: every authenticated user has one membership row, so the JOIN resolves to the same publication for everyone. The shape is the load-bearing piece — when a second tenant ships, the boundary already does the right thing without policy rewrite.

**Bootstrap and edge cases.**

- Authenticated user with no membership row: reader pages render empty. No auto-grant on signup; admin-side seeding (manual SQL at v1, future admin UI as part of B4) is the sole bootstrap path.
- Direct URL access to a `meetings.id` at `status != 'published'`: 404. RLS hides the row from the SSR client; the page renders the standard not-found surface.
- Direct URL with a publication/town/board slug the user has no membership for: 404 on the same RLS path.

**Failure modes.**

- Empty segments list on a published meeting: renders the summary alone with a note that no segments are available. Should not occur post-Slice-3 (the segmenter writes ≥1 segment or fails the row); guarded so a partial-write edge case does not break the page.
- Transient Supabase auth-refresh failure mid-page: middleware catches, redirects to `/login`. The user re-authenticates and lands back at the requested URL via the `redirectTo` param.
- YouTube iframe error: B3 fallback above.
- Segment ordering anomaly (duplicate `sequence_order`): rendered in `(sequence_order, id)` order to keep the page deterministic across loads.

**Email provider for magic-link delivery.** Slice 5 closes the Stage 7 deferral. Provider as-built: Supabase built-in SMTP. The built-in tier was sufficient through slice build (no real auth volume yet) and a future slice migrates to custom SMTP if production volume demands.

**Cost expectation at v1 scale.** Cloudflare Pages free tier covers the reader. Supabase reads are RLS-filtered SELECTs against indexed columns; no new vendor cost. Magic-link emails on the built-in tier are free within the rate cap; custom SMTP via Resend is ~$0/month at the small allowlist size (Resend's free tier is 100 emails/day, well above v1 need).

**Locked decisions.** ADR 0020 — "Reader UI v1 ships without search."

---

# Backlog / Slice candidates

Operational discoveries and deferred follow-ups that don't fit any of: wont-fix, audit finding, or current-slice fix. Each entry has three lines: What, Why, Trigger. Items are cut from the Backlog when a slice picks them up; git history preserves the entry, the live SPEC.md tracks only unaddressed work.

## B1 — `meetings.duration_seconds` cross-check against AssemblyAI `audio_duration`

- **What:** Replace or cross-check `meetings.duration_seconds` (set by cron from YouTube `videos.list contentDetails.duration`) with AssemblyAI's `audio_duration` field from `transcript.json`. AssemblyAI's value is authoritative for any chronology work that derives from the actual audio submitted to ASR.
- **Why:** Discrepancies surfaced during Slice 3 verification on meeting `a669dadb-816f-44a2-8d6c-54a6e2197ca1` (segmented end-to-end at 2026-05-09T21:38:15Z). YouTube's `contentDetails.duration` reflects the published video; AssemblyAI's `audio_duration` reflects the audio actually transcribed. They can drift on edited or re-encoded uploads.
- **Trigger:** Next worker handler that opens `transcript.json` for any reason. Slice 4 (summarization) runs segments-only and does not open the file, so B1 does not bundle into Slice 4. Likely natural triggers: B5 (transcript-aware summarization, if it ships) or any V2 grounding/verification work that needs raw transcript text.

## B2 — NOT NULL on `meetings.duration_seconds`

- **What:** Tighten `meetings.duration_seconds` to NOT NULL.
- **Why:** Cron always populates the field at row creation; nullable column is a vestige of the pre-Slice-2 schema. A NOT NULL constraint catches future code paths that bypass cron (manual inserts, alternative ingestion sources) which would otherwise silently propagate a null through downstream code that assumes a value.
- **Trigger:** B1 ships and any historical rows are backfilled. The constraint tightening is the contract step in an expand/contract cycle; B1 is the expand.

## B4 — Operator review gate at `review → published`

- **What:** Operator review UI surface that reads meetings in `review` state, presents segments + summary with edit affordances, and advances `review → published` on operator approval. Until this lands, the worker auto-advances `summarizing → published` directly in Stage 6 with no human gate; no row sits in `review` at v1.
- **Why:** Oberoi's documented practice is 10–30 min per meeting of human review (entity mistranscriptions, chapter boundaries, summary inaccuracies). V1 deviates because no operator UI exists and an operator gate without UI orphans every completed meeting at `review`. Whether the gate is load-bearing for newsroom-grade publication is unknown — depends on observed quality of summarization output and downstream-publication risk tolerance. The `review` slot in the `meeting_status` enum is preserved for this slice.
- **Trigger:** Either (a) post-publication audit of v1 output reveals systematic errors that operator review would have caught, or (b) the slice that builds an admin/operator UI for any reason picks up the review surface alongside. Whichever fires first.

## B5 — Transcript-aware meeting summarization

- **What:** Alternative summarization path where the handler reads `transcript.json` and passes raw transcript context to the LLM call alongside (or instead of) the segments-only input shipped in Slice 4. Bundles B1 (handler is opening `transcript.json` anyway).
- **Why:** Slice 4 ships segments-only summarization on the hypothesis that segment titles + descriptions + transcript_excerpts carry enough context for a faithful meeting summary. Whether richer context from the raw transcript yields meaningfully better quality is unproven. Bundling transcript-read into the production handler couples B1 and adds I/O + token cost without quality evidence.
- **Trigger:** Run an offline eval first. Add `apps/worker/scripts/eval-summary-prompts.ts` (one-off, not on the hot path; reads a `meeting_id`, runs both prompts — segments-only vs. transcript-aware — against the same Anthropic call, dumps both summaries side-by-side for human comparison). Run on 3–5 representative meetings spanning marker-type distribution. If transcript-aware wins consistently, ship B5 as a slice (which automatically ships B1). If the segments-only summary is qualitatively comparable, B5 stays deferred and the eval script is the durable record of "we tested both ways."

## B6 — Speaker-identification pre-pass + board member roster

- **What:** Add a separate LLM pass that runs between `transcribing` and `segmenting`, mapping AssemblyAI diarization speaker labels (Speaker A, Speaker B, ...) to actual names using a board-member roster stored on the `boards` table (e.g. `boards.member_names text[]`, plus optional position/role fields). Persist the resolved mapping per segment so downstream stages and the reader UI carry actual names rather than diarization labels.
- **Why:** Oberoi's full metadata-grounding pattern (KB `kb_hallucination-mitigation-summarization` C2/C3) requires this pre-pass to enable named-entity grounding in the summarization prompt. V1 deviates: Stage 6's grounding rule preserves diarization labels rather than resolving them to names, accepting that summaries may read as "Speaker A proposed..." instead of "Selectman Smith proposed..." Whether this hurts readability for newsroom-grade publication is unknown.
- **Trigger:** Post-publication audit of v1 summaries reveals that diarization-label preservation systematically obscures who said what, OR an operator audit catches name fabrication that the v1 prompt rule failed to prevent. Implementation requires schema (member roster column on `boards`), an admin path to populate it, and the new LLM stage in the worker — large enough to be a slice on its own, not a follow-up.
