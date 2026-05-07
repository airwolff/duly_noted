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
- **Worker** picks up `segmenting` rows, runs the LLM segmentation pass, advances to `summarizing`, runs summary pass, advances to `review`. Operator review (deferred or included is a Stage 4 decision) gates `review → published`.

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
> consuming code. `ANTHROPIC_API_KEY` is listed as required on the worker
> (Stage 4: segmentation and summarization); it is intentionally absent from
> the worker's Slice 2 env schema and must not be added until Stage 4 lands.

Per-surface secret list:

| Secret                          | Cloudflare Pages | Render Worker | Render Cron | Supabase Edge Function |
| ------------------------------- | ---------------- | ------------- | ----------- | ---------------------- |
| `SUPABASE_URL`                  | —                | yes           | yes         | yes (built-in)         |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes              | —             | —           | —                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes              | —             | —           | —                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | —                | yes           | yes         | yes (built-in)         |
| `YOUTUBE_API_KEY`               | —                | —             | yes         | —                      |
| `ASR_VENDOR_API_KEY`            | —                | yes           | —           | yes                    |
| `ANTHROPIC_API_KEY`             | —                | yes (Stage 4) | —           | —                      |
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

---

# Decision Record — Stage 1

| #   | Decision                                                         | Alternatives weighed                                                            | Reason                                                                                                                                                                                                                | Revisit when                                                                                                                 |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Cloudflare Pages for web                                         | Vercel                                                                          | Vercel Hobby ToS forbids commercial use; Pro $20/mo. Cloudflare free tier permits commercial. ~$240/yr saved.                                                                                                         | Never expected to revisit at v1 scale.                                                                                       |
| 1.2 | Render Background Worker for pipeline                            | Cloudflare Workers + Queues; Supabase Edge Functions + pg_cron; Fly.io; Railway | yt-dlp/ffmpeg require a real Linux shell. Workers and Edge Functions cannot shell out. Render's Background Worker + Cron primitives map directly to ingestion and pipeline; predictable pricing; solo-dev ergonomics. | If Render pricing shifts materially or if v2 introduces tasks (e.g., local Whisper) that exceed Starter container resources. |
| 1.3 | Postgres-as-queue (no Redis/SQS)                                 | Cloudflare Queues; Upstash Redis; SQS                                           | Volume is ~6 meetings/day at Scale-1 ceiling. Polling on `meetings.status` is sufficient. Adding a queue service is premature complexity.                                                                             | If concurrent meeting throughput exceeds ~10/hr or if multi-publication tenancy requires fairness across tenants.            |
| 1.4 | Monorepo with pnpm workspaces                                    | Two separate repos; pnpm + Turborepo                                            | Two-app deployment forces shared types and a shared DB client. pnpm workspaces is the minimum viable monorepo. Turborepo migration is cheap when needed.                                                              | When CI runtime exceeds ~3 minutes consistently.                                                                             |
| 1.5 | Dashlane as secrets source of truth                              | GitHub Secrets only; SOPS/age in repo; Doppler/Infisical                        | Manual but auditable. No additional vendor. Encrypted-in-repo overkill for a solo dev with ~10 keys.                                                                                                                  | When team grows beyond one or rotation cadence exceeds quarterly.                                                            |
| 1.6 | Cloudflare/Render git auto-deploy + GitHub Actions for PR checks | Manual deploy; full GitHub-Actions-driven deploy                                | Native git integrations cover the common path. GitHub Actions handles only typecheck/lint/test/migrations.                                                                                                            | When per-environment promotion (staging → prod) becomes necessary.                                                           |
| 1.7 | Migrations via GitHub Action, not worker boot                    | Run migrations on worker startup; manual migration                              | Keeps schema concerns off the runtime path. Forward-only migrations match Supabase's recommended pattern.                                                                                                             | When zero-downtime requirements force pre/post-deploy migration phasing.                                                     |

**Open items inherited by later stages:**

- ~~Stage 2: ASR vendor selection~~ — closed in Stage 2 below.
- ~~Stage 3: audio extraction path~~ — closed in Stage 3 below.
- Stage 4: operator review step inclusion sets the `review` state semantics. Pending; Slice 2 keeps `review` in the enum but does not gate `review → published`.
- Stage 5: full DDL for `meetings.status` enum, including index and constraint design (pass 2). Slice 2 deltas in Stage 5 below cover the ingest-load-bearing subset; pass 2 still pending.

---

# Stage 2 — ASR vendor

**Vendor: AssemblyAI Universal-3 Pro.** $0.21/hr at 2026-05 list pricing, diarization included in base rate. English-primary; six-language support sufficient for Maine municipal meetings. Universal-3 Pro selected over Universal-2 ($0.15/hr) for accent, rare-word, and alphanumeric accuracy. The $0.06/hr premium is acceptable cost for the quality delta.

**ToS posture.** AssemblyAI ToS §4.3 grants AssemblyAI a license to train on customer audio with plan-conditional opt-out. Opt-out is by email request to `data-opt-out@assemblyai.com` from the account-tied address; written confirmation establishes the forward-looking effective timestamp. Confirmation must land before the first ASR submission of any kind, including dev/testing.

- Opt-out request sent: 2026-05-07
- Opt-out confirmation received: pending — update this line with the confirmation date when received

**Submit pattern.** Async with webhook callback, called from `apps/worker`:

- `POST https://api.assemblyai.com/v2/transcript`
- Body: `{ audio_url, speaker_labels: true, webhook_url, webhook_auth_header_name: "X-DulyNoted-Webhook", webhook_auth_header_value: ASR_WEBHOOK_SECRET }`
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

---

# Decision Record — Stage 2

| #   | Decision                                                               | Alternatives weighed                                                                                           | Reason                                                                                                                                                                                 | Revisit when                                                                             |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 2.1 | AssemblyAI Universal-3 Pro for ASR                                     | Deepgram Nova-3 ($0.46/hr base + diarization upcharge); AssemblyAI Universal-2 ($0.15/hr); self-hosted Whisper | Universal-3 Pro highest accuracy on accented English, rare words, alphanumerics. Diarization-included pricing simplest to model. Webhook + auth-header pattern well documented.        | When ingest volume passes ~500 hrs/month and price delta vs Universal-2 becomes material |
| 2.2 | Webhook receiver as Supabase Edge Function, not Cloudflare Pages route | Cloudflare Route Handler with anon key + permissive RLS on inbox table; Cloudflare → Edge Function chain       | Edge Function holds service-role and vendor key safely; Cloudflare doesn't need either; eliminates inbox table; pipeline plumbing lives near the database, not on the static-site host | When Edge Function execution time becomes a constraint or Supabase pricing shifts        |

---

# Stage 3 — Audio extraction

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

---

# Decision Record — Stage 3

| #   | Decision                                                     | Alternatives weighed                                             | Reason                                                                                                                                   | Revisit when                                                                |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 3.1 | yt-dlp via custom Dockerfile in `apps/worker`, static binary | pip install at runtime; Node wrapper library                     | Reproducible image, no Python runtime in the container, version pinning explicit                                                         | When Render base-image build time becomes a constraint                      |
| 3.2 | Per-board promotion rules as columns on `boards`             | Hardcoded rule for the first board, refactor when board #2 lands | Schema is tenant-ready by mandate; per-board rules match that posture; avoids a refactor when adding boards                              | Never expected to revisit                                                   |
| 3.3 | Hourly cron schedule                                         | Every 5 min; daily; per-meeting-window                           | Hourly is predictable, cheap, and well within YouTube quota. No-missed-uploads-of-consequence at Lincolnville cadence (monthly meetings) | When ingest volume across all tenants makes hourly polling visibly wasteful |

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
  > `_known-non-issues.md` NI-008.

**Storage bucket:**

- Create `meeting-artifacts` private bucket. Service-role unrestricted; no public read; signed URLs only for vendor handoff.

Pass 2 still deferred: trigger on remaining tables, FK indexes on `memberships.publication_id`, soft-delete columns, search columns, membership-aware RLS.

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

**Open items.** End-to-end magic-link round trip was deferred at scaffold close because the Supabase built-in SMTP rate limit was hit during dashboard wiring. Slice 2 does not require an authenticated UI surface, so this verification step remains deferred. First slice that ships an admin UI (operator review, manual ingest trigger) closes the deferral.
