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
│   └── worker/         # Node/TS Background Worker → Render
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
- **Render Worker + Cron**: git integration on `main`, `rootDir: apps/worker` filter prevents unrelated changes from redeploying.
- **GitHub Actions** runs on every PR: install (frozen lockfile), typecheck across workspaces, lint, test.
- **Migrations**: Supabase CLI run from a GitHub Action on merge to `main`, before the Render auto-deploy completes. Migrations are forward-only; rollback is by writing a forward migration that undoes.
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
