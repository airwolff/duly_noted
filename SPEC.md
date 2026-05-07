# SPEC.md — Stage 1: Foundation and Stack

## Deployment topology

Three surfaces:

- **Cloudflare Pages** — Next.js (App Router) web app at `dulynoted.report`. Stateless. Serves the reader UI, the admin UI, and the ASR webhook receiver endpoint. No long-running compute.
- **Supabase Pro** — Postgres (data, RLS), Auth (magic link), Storage (extracted audio + transcript artifacts).
- **Render** — `apps/worker` Background Worker (Starter, $7/mo) running the ingestion and pipeline state machine; `apps/worker-cron` Cron Job ($1/mo) polling YouTube Data API on a schedule.

Postgres is the queue. The Render worker advances meeting state by polling rows on `meetings.status`; no Redis, SQS, or external queue at v1.

## Background job architecture

State machine on `meetings.status`:

```
discovered → pending → extracting → transcribing → segmenting → summarizing → review → published
                                                                              ↘  failed
```

- **Cron Job** writes new `discovered` rows from YouTube Data API responses.
- **Worker** picks up `pending` rows, runs `yt-dlp` to extract audio, uploads to Supabase Storage, submits the storage URL to the ASR vendor, and parks the row at `transcribing`.
- **Cloudflare Pages webhook receiver** receives the ASR vendor callback, verifies `ASR_WEBHOOK_SECRET`, writes the transcript, advances state to `segmenting`.
- **Worker** picks up `segmenting` rows, runs the LLM segmentation pass, advances to `summarizing`, runs summary pass, advances to `review`. Operator review (deferred or included is a Stage 4 decision) gates `review → published`.

Failure semantics: any step that errors writes `status = 'failed'` and a `last_error` field; the worker re-polls `failed` rows only on manual reset (no automatic retry storms). Worker invocations are idempotent — picking up the same row twice never double-charges the ASR vendor or double-writes a segment.

## Repo structure

Monorepo, pnpm workspaces.

```
duly-noted/
├── apps/
│   ├── web/            # Next.js 14+ App Router → Cloudflare Pages
│   ├── worker/         # Node/TS Background Worker → Render
│   └── worker-cron/    # Node/TS Cron Job → Render
├── packages/
│   ├── db/             # Supabase types, client factories, migrations
│   └── shared/         # Domain types, prompt templates, segmentation schemas
├── .github/workflows/  # CI
├── pnpm-workspace.yaml
├── package.json
└── CLAUDE.md
```

Turborepo is **not** added at v1. Migration path is documented and ~30 minutes when CI runtime warrants it.

## Environment and secrets

Source of truth: Dashlane vault. No secrets in any repo.

Per-surface secret list:

| Secret                          | Cloudflare Pages | Render Worker | Render Cron |
| ------------------------------- | ---------------- | ------------- | ----------- |
| `SUPABASE_URL`                  | —                | yes           | yes         |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes              | —             | —           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes              | —             | —           |
| `SUPABASE_SERVICE_ROLE_KEY`     | —                | yes           | yes         |
| `YOUTUBE_API_KEY`               | —                | —             | yes         |
| `ASR_VENDOR_API_KEY`            | —                | yes           | —           |
| `ANTHROPIC_API_KEY`             | —                | yes           | —           |
| `ASR_WEBHOOK_SECRET`            | yes              | yes           | —           |

Every app validates its env at startup with zod and fails loudly. `.env.example` is checked in with placeholders and kept in sync as new keys are added. `.env.local` is gitignored.

## CI/CD

- **Cloudflare Pages**: git integration on `main`. Preview deploys on PRs serve as the only non-prod environment.
- **Render Worker + Cron**: git integration on `main`. Both services redeploy on any push to `main`; path-based deploy filtering is not configured. Acceptable at v1 — Render Starter bills monthly, not per-deploy, and worker-cron's scheduled invocation absorbs mid-deploy restarts.
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

Variable cost (ASR, LLM, embeddings, egress) is set in Stages 3, 4, 6.

## Changelog note for KB

`kb_civic-sunlight-mvp-cost-model_2026-04-29_v1.xml` is built on a Vercel + Supabase Pro assumption. The Stage 1 decision moves hosting to Cloudflare Pages and adds a Render line. Net annual fixed cost moves from ~$540/yr to ~$408/yr. The model's CONFLICT-06 (Vercel ToS) and SS-03 are no longer load-bearing. CONFLICT-07 (Supabase Pro inactivity pause) still binds. The cost model file remains the authoritative reference for ASR and LLM lines, which Stage 1 does not touch.

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

- Stage 2: ASR vendor selection determines `ASR_VENDOR_API_KEY` value and webhook payload schema.
- Stage 3: confirms yt-dlp is the audio extraction path (assumed here; revisit if YouTube auto-captions become the v1 ASR strategy, in which case Render scope shrinks).
- Stage 4: operator review step inclusion sets the `review` state semantics.
- Stage 5: full DDL for `meetings.status` enum, including index and constraint design.

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

| Var                             | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL (publishable)                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon publishable key. RLS enforces access.    |
| `ASR_WEBHOOK_SECRET`            | Shared secret verified at `/api/webhooks/asr` |

The service-role key never reaches Cloudflare — only `apps/worker` and `apps/worker-cron` (Render) hold it.

**Flow.** `apps/web/src/app/login/page.tsx` calls `signInWithOtp({ email, options.emailRedirectTo: window.location.origin + '/auth/callback' })`. The user clicks the email, lands at `/auth/callback?code=…`, the route handler exchanges the code for a session via `exchangeCodeForSession`, and the Supabase cookie is written by the SSR helpers. `apps/web/middleware.ts` refreshes the session cookie on every non-asset request. `POST /auth/signout` clears it.

**Open items.** End-to-end magic-link round trip was deferred at scaffold close because the Supabase built-in SMTP rate limit was hit during dashboard wiring; first authenticated request is a Slice 2 verification step.
