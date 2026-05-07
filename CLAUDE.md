# CLAUDE.md

Duly Noted — AI-powered local government meeting transcription and summarization tool for a regional newsroom.

This file is conventions only. Architecture, data model, and pipeline design live in `SPEC.md`. If a question is "how does the system work," read `SPEC.md`. If it is "how do we write code in this repo," it is here.

---

## 1. Repo layout

Monorepo. pnpm workspaces. Three apps, two shared packages.

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
├── supabase/          Migrations and seed data. Run via Supabase CLI.
├── docs/
│   └── adr/           Architecture decision records, one file per decision.
├── SPEC.md            Product + architecture spec. Source of truth.
└── CLAUDE.md          This file.
```

Shared code rule: if a type or helper is touched by more than one app, it lives in `packages/db` (if it touches the database) or `packages/shared` (otherwise). Do not import across apps. Do not import from one app into another's tests.

---

## 2. Stack

- Runtime: Node 24 LTS. Pin via `.nvmrc` and `engines.node` in `package.json`.
- Language: TypeScript, strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- Web: Next.js (App Router) on Cloudflare Pages via `@cloudflare/next-on-pages`.
- Worker: plain Node/TS service on Render Background Worker (Starter, $7/mo).
- Cron: plain Node/TS service on Render Cron Job. Same package layout as `apps/worker`, separate entrypoint, separate deploy.
- DB / Auth / Storage: Supabase Pro. Postgres with RLS on every exposed table.
- Auth: Supabase magic link. No passwords, no OAuth at v1. Session middleware in `apps/web` validates the Supabase session cookie on every request.
- Validation: Zod at every API boundary and every external input (YouTube responses, ASR webhook payloads, LLM outputs). `.env` is also validated via Zod at boot.
- HTTP client: native `fetch`. No axios.
- Testing: Vitest. Use `vitest run` for CI, `vitest` for watch. Playwright deferred to post-MVP.
- Lint: ESLint + `@typescript-eslint`. Format: Prettier. Both run via pnpm scripts at the repo root.
- Queue: Postgres. The worker polls `meetings.status` for state transitions. No Redis, no SQS.
- Migrations: Supabase CLI. Migrations checked into `supabase/migrations/` and run from a GitHub Action on merge to main, never from worker boot.
- Secrets store of record: Dashlane. Manual sync to Cloudflare Pages and Render dashboards. Do not propose Doppler, 1Password, Infisical, etc. — the workflow is locked.

Prefer the listed tools. If a task seems to need something else, raise it before installing.

---

## 3. Commands

Run from the repo root unless noted.

```
pnpm install                # bootstrap workspace
pnpm -r build               # build all workspaces
pnpm -r test                # run all tests
pnpm -r typecheck           # tsc --noEmit across workspaces
pnpm -r lint                # ESLint
pnpm format                 # Prettier write
pnpm -F web dev             # local Next.js dev server
pnpm -F worker dev          # local worker (tsx watch)
pnpm -F worker start        # production worker entrypoint
pnpm -F worker-cron start   # one-shot cron entrypoint (also runs locally)
supabase start              # local Postgres + Studio
supabase migration new <n>  # create a migration
supabase db reset           # rebuild local DB from migrations + seed
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
- Before opening a PR: `pnpm -r typecheck && pnpm -r test && pnpm -r lint` must pass locally.
- Migrations are append-only. Never edit a migration that has been merged. Add a new one.
- When adding an external dependency, justify it in the PR description. Default to standard library or existing deps.
- When you are about to add a new vendor key or API surface, check `SPEC.md` first — the architecture may already specify a different path.

---

## 6. Hard rules — do not violate

- `SUPABASE_SERVICE_ROLE_KEY` lives only on `apps/worker` and `apps/worker-cron`. Never import it from `apps/web`. Never embed it in a client bundle. The web app uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` and relies on RLS.
- Every new table must have RLS enabled in the same migration that creates it. A table without an RLS policy is a bug.
- Every RLS policy must be paired with the corresponding table-level GRANT (`SELECT`/`INSERT`/`UPDATE`/`DELETE` for `anon`, `authenticated`, or `service_role` as appropriate) in the same migration. RLS without GRANT silently fails to expose the API path; both are required for Supabase.
- Migrations must be backwards-compatible with the previously deployed worker. Additive changes (new column, new table, new index) deploy ahead of the code that uses them. Destructive changes (drop column, drop table, narrow constraint) follow expand/contract across multiple deploys: first deploy code that stops using the old structure, then deploy the migration that removes it. A migration that breaks the running worker on apply is a bug. The migrate workflow runs in parallel with Render's auto-deploy; backwards-compatibility is what makes that race safe.
- `auth.uid()` and `auth.jwt()` claims are the only sources of authorization identity. Do not read user identity from `raw_user_meta_data` — it is user-editable.
- ASR vendor calls and LLM calls run only from `apps/worker` or `apps/worker-cron`. The web app does not hold vendor API keys. If a request from the web needs ASR or LLM work, it inserts a row that the worker picks up.
- No background work in `apps/web`. Cloudflare Pages cannot run long-lived processes. Anything that takes more than the request lifecycle goes to the worker.
- Webhook callbacks (ASR vendor → web app) must verify the shared secret from `ASR_WEBHOOK_SECRET` before doing any work.
- Do not commit `.env*` files except `.env.example`. Real secrets live in Cloudflare and Render dashboards.
- LLM outputs are untrusted input. Validate with Zod before writing to the database. Never `JSON.parse` an LLM response into a typed value without validation.
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

Tenant-readiness in the schema does not mean tenant onboarding flows. Build the schema correctly; do not build admin tooling for a second tenant.

---

## 8. When in doubt

- If `SPEC.md` and this file conflict, `SPEC.md` wins for architecture, this file wins for conventions. Flag the conflict in the PR.
- If the KB-derived research in the Claude Project conflicts with `SPEC.md`, `SPEC.md` wins. The KB informed the spec; the spec is the lock.
- If you would need to write more than ~10 lines of "and then…" prose to explain a decision, it belongs in an ADR under `docs/adr/`, not inline.

@SPEC.md
