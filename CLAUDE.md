# CLAUDE.md

Duly Noted — AI-powered local government meeting transcription and summarization tool for a regional newsroom.

This file is conventions only. Architecture, data model, and pipeline design live in `SPEC.md`. If a question is "how does the system work," read `SPEC.md`. If it is "how do we write code in this repo," it is here.

---

## 1. Repo layout

Monorepo. pnpm workspaces. Three apps, two shared packages, plus Supabase Edge Functions.

```
duly-noted/
├── apps/
│   ├── web/           Next.js (App Router). Deploys to Cloudflare Pages.
│   ├── worker/        Node/TS background worker. Deploys to Render
│   │                  Background Worker. Long-running poll loop.
│   └── worker-cron/   Node/TS scheduled job. Deploys to Render Cron Job.
│                      Triggered on a schedule, exits when done.
├── packages/
│   ├── db/            Supabase client factory, generated types,
│   │                  migration helpers, RLS-aware query helpers.
│   └── shared/        Zod schemas, prompt templates, segmentation logic,
│                      domain types, LLM-side helpers.
├── supabase/
│   ├── migrations/    SQL migrations. Append-only.
│   ├── functions/     Edge Functions (Deno runtime). Vendor webhook
│   │                  receivers and other DB-adjacent serverless logic.
│   ├── seed.sql       Local-dev seed data.
│   └── config.toml    Supabase CLI config.
├── docs/
│   ├── adr/           Architecture decision records, one file per decision.
│   ├── audits/        Post-session audit reports + _known-non-issues.md.
│   └── workflows/     Process docs (build-cycle.md and equivalents).
├── SPEC.md            Product + architecture spec. Source of truth.
└── CLAUDE.md          This file.
```

Shared code rule: if a type or helper is touched by more than one app, it lives in `packages/db` (if it touches the database) or `packages/shared` (otherwise). Do not import across apps. Do not import from one app into another's tests.

Edge Functions in `supabase/functions/` run on Deno and have their own dependency surface. They may import from `packages/shared` only if the import is Deno-compatible (no Node-only built-ins). Generated DB types from `packages/db` are safe to consume.

---

## 2. Stack

- Runtime: Node 24 LTS for `apps/*`. Pin via `.nvmrc` and `engines.node` in `package.json`.
- Edge Functions: Deno (managed by Supabase). No version pin needed; track Supabase's supported runtime.
- Language: TypeScript, strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- Web: Next.js (App Router) on Cloudflare Pages via `@cloudflare/next-on-pages`.
- Worker: plain Node/TS service on Render Background Worker (Starter, $7/mo). Custom Dockerfile because yt-dlp + ffmpeg are required.
- Cron: plain Node/TS service on Render Cron Job. Same package layout as `apps/worker`, separate entrypoint, separate deploy.
- DB / Auth / Storage: Supabase Pro. Postgres with RLS on every exposed table.
- Auth: Supabase magic link. No passwords, no OAuth at v1. Session middleware in `apps/web` validates the Supabase session cookie on every request.
- ASR vendor: AssemblyAI. Async + webhook callback to a Supabase Edge Function.
- Validation: Zod at every API boundary and every external input (YouTube responses, ASR webhook payloads, LLM outputs). `.env` is also validated via Zod at boot.
- HTTP client: native `fetch`. No axios.
- Testing: Vitest. Use `vitest run` for CI, `vitest` for watch. Playwright deferred to post-MVP.
- Lint: ESLint + `@typescript-eslint`. Format: Prettier. Both run via pnpm scripts at the repo root.
- Queue: Postgres. The worker polls `meetings.status` for state transitions. No Redis, no SQS.
- Migrations: Supabase CLI. Migrations checked into `supabase/migrations/` and run from a GitHub Action on merge to `main`, never from worker boot.
- Secrets store of record: Dashlane. Manual sync to Cloudflare Pages, Render, and Supabase dashboards. Do not propose Doppler, 1Password, Infisical, etc. — the workflow is locked.

Prefer the listed tools. If a task seems to need something else, raise it before installing.

---

## 3. Commands

Run from the repo root unless noted.

```
pnpm install                       # bootstrap workspace
pnpm -r build                      # build all workspaces
pnpm -r test                       # run all tests
pnpm -r typecheck                  # tsc --noEmit across workspaces
pnpm -r lint                       # ESLint
pnpm format                        # Prettier write
pnpm -F web dev                    # local Next.js dev server
pnpm -F worker dev                 # local worker (tsx watch)
pnpm -F worker start               # production worker entrypoint
pnpm -F worker-cron start          # one-shot cron entrypoint (also runs locally)
supabase start                     # local Postgres + Studio + Edge Functions runtime
supabase migration new <n>         # create a migration
supabase db reset                  # rebuild local DB from migrations + seed
supabase functions serve           # run Edge Functions locally
supabase functions deploy <name>   # deploy a single Edge Function
supabase secrets set KEY=value     # set a secret on the Supabase project for Edge Functions
docker build -f apps/worker/Dockerfile -t duly-noted-worker .  # build the worker container locally (run from repo root)
```

Always run `pnpm -r typecheck` and `pnpm -r test` before declaring a task done.

---

## 4. Code style

- 2-space indentation. No tabs.
- File and directory names: `kebab-case.ts` for files, `kebab-case/` for directories. React components: `PascalCase.tsx`.
- Type names: `PascalCase`. Variables and functions: `camelCase`. Constants: `SCREAMING_SNAKE_CASE` only for true module-level constants.
- One default export max per file. Prefer named exports.
- Imports: absolute via `@/` alias inside an app or package; relative across nothing. No deep cross-app imports — go through `packages/db` or `packages/shared`.
- No `any`. Use `unknown` plus narrowing or define the type. If `any` is genuinely needed, add a one-line comment explaining why.
- No `enum`. Use string literal unions or `as const` objects.
- React: server components by default in `apps/web`. Client components require an explicit reason and a `// client:` comment naming it (interactivity, browser API, etc.).
- DB access: only through the Supabase client factory in `packages/db`. No raw `pg` connections. No new Supabase clients created ad hoc inside an app.
- All times in the database are `timestamptz` (UTC). Display-time conversion happens at the UI layer.

---

## 5. Workflow rules

- Plan mode first for any task that touches more than one file or adds a dependency. Show the plan, wait for approval, then code.
- One vertical slice per session. Slice boundaries are listed in `SPEC.md`. Use `/clear` between slices.
- Conventional Commits. `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. Scope optional.
- Branch from `main`. PR previews on Cloudflare. Merge squashes to `main`.
- Before opening a PR: `pnpm -r typecheck && pnpm -r test && pnpm -r lint && pnpm format:check` must pass locally.
- Migrations are append-only. Never edit a migration that has been merged. Add a new one.
- When adding an external dependency, justify it in the PR description. Default to standard library or existing deps.
- When you are about to add a new vendor key or API surface, check `SPEC.md` first — the architecture may already specify a different path.

---

## 6. Hard rules — do not violate

- `SUPABASE_SERVICE_ROLE_KEY` lives only on `apps/worker`, `apps/worker-cron`, and Supabase Edge Functions in `supabase/functions/`. Never import it from `apps/web`. Never embed it in a client bundle. The web app uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` and relies on RLS.
- `ASR_VENDOR_API_KEY` lives only on `apps/worker` and the `supabase/functions/asr-webhook` Edge Function. The Edge Function fetches the completed transcript from AssemblyAI; no other surface holds the vendor key.
- Vendor webhook receivers run as Supabase Edge Functions in `supabase/functions/`. `apps/web` does not host webhook receivers. Receivers verify the auth header against `ASR_WEBHOOK_SECRET` before any side effect (DB write, vendor fetch, Storage upload).
- Webhook-receiving Edge Functions must disable JWT verification at the gateway. Any function under `supabase/functions/` that accepts third-party webhook callbacks must declare `verify_jwt = false` in a `[functions.<name>]` block in `supabase/config.toml`. Authentication is performed inside the function body using the configured webhook auth header (e.g. `X-DulyNoted-Webhook` for AssemblyAI). Without this declaration, Supabase's gateway rejects every callback with 401 before the function code runs — including the in-body auth check.
- Every new table must have RLS enabled in the same migration that creates it. A table without an RLS policy is a bug.
- Every RLS policy must be paired with the corresponding table-level GRANT (`SELECT`/`INSERT`/`UPDATE`/`DELETE` for `anon`, `authenticated`, or `service_role` as appropriate) in the same migration. RLS without GRANT silently fails to expose the API path; both are required for Supabase.
- Every direct table query from a service-role surface needs a `GRANT` on that table, regardless of whether the table also has RLS or RPC access paths. The rule above handles one direction (RLS → GRANT). The converse also holds: if `apps/worker*/src/**` or `supabase/functions/**/*.ts` contains `from('<table>')` against a table queried as `service_role`, that table needs `GRANT SELECT` (or the appropriate verb) to `service_role` in the migration history. RPC `SECURITY DEFINER` paths bypass role grants and can mask missing direct-table grants in local dev — only cloud `service_role` enforcement surfaces the gap.
- **DROP-side DDL uses `IF EXISTS`.** `drop policy`, `drop table`, and `drop index` statements include `if exists` to tolerate cloud drift from manual SQL Editor edits in the Supabase web UI. CREATE-side DDL remains bare per NI-003 (Supabase CLI applies migrations transactionally, so partial-apply recovery isn't a CREATE-side concern). The asymmetry is intentional: DROP-side `IF EXISTS` is one-way-ratchet defensive and never causes harm; CREATE-side `IF NOT EXISTS` would mask schema-state drift the CLI is supposed to surface.
- Migrations must be backwards-compatible with the previously deployed worker. Additive changes (new column, new table, new index) deploy ahead of the code that uses them. Destructive changes (drop column, drop table, narrow constraint) follow expand/contract across multiple deploys: first deploy code that stops using the old structure, then deploy the migration that removes it. A migration that breaks the running worker on apply is a bug. The migrate workflow runs in parallel with Render's auto-deploy; backwards-compatibility is what makes that race safe.
- `auth.uid()` and `auth.jwt()` claims are the only sources of authorization identity. Do not read user identity from `raw_user_meta_data` — it is user-editable.
- ASR vendor calls and LLM calls run only from `apps/worker`, `apps/worker-cron`, or `supabase/functions/`. The web app does not hold vendor API keys. If a request from the web needs ASR or LLM work, it inserts a row that the worker picks up.
- No background work in `apps/web`. Cloudflare Pages cannot run long-lived processes. Anything that takes more than the request lifecycle goes to the worker.
- `apps/worker-cron` must use the `playlistItems.list` + `videos.list` pattern for video discovery; `search.list` (100 quota units/call) is forbidden. The uploads playlist ID is `UU` + the rest of the channel ID, computed at the column level — no `channels.list` call needed at scan time.
- yt-dlp version is pinned in `apps/worker/Dockerfile` via build arg. ffmpeg version comes from the pinned base image. Bumps are intentional commits, not lockfile drift.
- All worker queue reads use `SELECT ... FOR UPDATE SKIP LOCKED` followed by an atomic `UPDATE meetings SET status = ...` on the locked row. Read-then-write without the lock is a bug.
- Do not commit `.env*` files except `.env.example`. Real secrets live in Cloudflare, Render, and Supabase dashboards.
- LLM outputs are untrusted input. Validate with Zod before writing to the database. Never `JSON.parse` an LLM response into a typed value without validation. Anthropic structured outputs guarantee schema conformance via constrained decoding but do not guarantee factual accuracy or enforce length/range bounds — Zod still runs on every parsed object and is the only place schema-extra constraints (`minLength`, `maxLength`, `minimum`, `maximum`) are enforced.
- Cost discipline: this project runs on a tight budget. Before adding a service, dependency, or paid tier, confirm the cost impact against the figures in `SPEC.md`. If it changes the cost model, update `SPEC.md` in the same PR.

---

## 7. Out of scope for v1 — refuse to build

If a request asks for any of the following, stop and confirm before proceeding. These are deferred to v2 by explicit decision:

- Multi-LLM consensus verification or claim grounding beyond inline transcript excerpts with YouTube timestamp links.
- Email digest, alerting, or any push-notification surface.
- Public API or third-party integrations beyond YouTube ingest.
- Video sources other than YouTube (Vimeo, Granicus, CivicPlus, direct MP4).
- Additional publications beyond the single tenant configured at launch. The schema is multi-tenant; the deployment is not.
- Full-text or semantic search backends other than what `SPEC.md` specifies for v1.
- AssemblyAI premium add-ons: `auto_chapters`, `sentiment_analysis`, `content_safety`, `iab_categories`, `entity_detection`, vendor-side `summarization`. Segmentation and summarization run on our own LLM pipeline.
- Webhook receivers in `apps/web`. All vendor webhooks land at Supabase Edge Functions.
- Automatic retry of `failed` meetings. Manual reset only.

Tenant-readiness in the schema does not mean tenant onboarding flows. Build the schema correctly; do not build admin tooling for a second tenant.

---

## 8. When in doubt

- If `SPEC.md` and this file conflict, `SPEC.md` wins for architecture, this file wins for conventions. Flag the conflict in the PR.
- If the KB-derived research in the Claude Project conflicts with `SPEC.md`, `SPEC.md` wins. The KB informed the spec; the spec is the lock.
- If you would need to write more than ~10 lines of "and then…" prose to explain a decision, it belongs in an ADR under `docs/adr/`, not inline.

## Pulling architectural context

For architecture, schema, or stage methodology, read `SPEC.md`. For locked
decisions and their alternatives, read the relevant ADR in `docs/adr/`.
Read these only when the current task requires them — do not pre-load.
