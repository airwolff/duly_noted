# Pre-slice Scaffold Spec — Duly Noted

Concrete scaffold targets for the first Claude Code session. Derived from `SPEC.md` and `CLAUDE.md` already at the repo root. Build only what is described here.

---

## Goal

Build the smallest deployable end-to-end system. Three apps deploy successfully; all read a single Supabase row on startup; magic link auth works in the web app; CI is green. No business logic.

---

## Top-level file tree

```
duly_noted/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .nvmrc                          # "24"
├── .gitignore
├── .editorconfig
├── .prettierrc
├── .prettierignore
├── eslint.config.mjs               # flat config
├── tsconfig.base.json              # shared TS config
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── README.md                       # one paragraph: links to SPEC.md and CLAUDE.md
├── CLAUDE.md                       # already present — do not modify
├── SPEC.md                         # already present — do not modify
├── apps/
│   ├── web/
│   ├── worker/
│   └── worker-cron/
├── packages/
│   ├── db/
│   └── shared/
├── supabase/
│   ├── config.toml                 # from `supabase init`
│   ├── migrations/
│   │   └── <timestamp>_scaffold.sql
│   └── seed.sql                    # empty for now
└── docs/
    └── adr/
        └── 0001-record-architecture-decisions.md
```

---

## Workspace config

**`pnpm-workspace.yaml`:**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Root `package.json`:**

- `engines.node`: `">=24"`
- `packageManager`: pinned to current pnpm version
- Scripts (root-level, recursing into workspaces):
  - `build`: `pnpm -r build`
  - `test`: `pnpm -r test`
  - `typecheck`: `pnpm -r typecheck`
  - `lint`: `pnpm -r lint`
  - `format`: `prettier --write .`
  - `format:check`: `prettier --check .`
- Dev deps (root only): `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`, `eslint-config-prettier`, `zod`

**`.nvmrc`:** `24`

**`tsconfig.base.json`:** strict TypeScript, `"noUncheckedIndexedAccess": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"verbatimModuleSyntax": true`. Per-package `tsconfig.json` extends this.

**`eslint.config.mjs`:** flat config, `@typescript-eslint` recommended, plus rules forbidding `any`, `enum`, and cross-app relative imports. Prettier-compatible (`eslint-config-prettier` last in the chain).

**`.prettierrc`:** 2-space, single quotes, trailing commas all, semicolons enabled (Next.js norm).

**`.gitignore`:** Node + Next.js + macOS + `.env*` (except `.env.example`) + `dist/` + `.next/` + `node_modules/` + `*.log`.

**`.editorconfig`:** standard 2-space, LF, trim trailing whitespace, final newline.

---

## `apps/web/` — Next.js 14+ App Router → Cloudflare Pages

```
apps/web/
├── package.json                    # name: web, depends on @duly-noted/db, @duly-noted/shared
├── tsconfig.json                   # extends ../../tsconfig.base.json
├── next.config.mjs                 # configured for @cloudflare/next-on-pages
├── .env.example                    # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ASR_WEBHOOK_SECRET
├── env.ts                          # zod-validated env, imported at top of layout/middleware
├── middleware.ts                   # Supabase session cookie refresh on every request
├── public/                         # empty
└── src/
    └── app/
        ├── layout.tsx              # minimal HTML shell, no styling library
        ├── page.tsx                # server component: reads _scaffold_health, renders status text
        ├── login/
        │   └── page.tsx            # client component: email input, calls signInWithOtp
        ├── auth/
        │   ├── callback/
        │   │   └── route.ts        # GET handler exchanges code for session, sets cookie, redirects to /
        │   └── signout/
        │       └── route.ts        # POST handler clears session, redirects to /login
        └── api/
            └── webhooks/
                └── asr/
                    └── route.ts    # POST stub: verifies ASR_WEBHOOK_SECRET header, returns 501
```

**Hello-world entrypoint:** `app/page.tsx` is a server component that uses the `@duly-noted/db` server client (anon) to `select message from _scaffold_health limit 1`, and renders `<h1>Duly Noted</h1><p>{message}</p>`. No styling library; plain HTML.

**No Tailwind, no UI library, no CSS modules at this stage.** Defer all styling decisions until after Slice 4 when the meeting page is being designed.

---

## `apps/worker/` — Node/TS Background Worker → Render

```
apps/worker/
├── package.json                    # name: worker, depends on @duly-noted/db, @duly-noted/shared
├── tsconfig.json                   # extends ../../tsconfig.base.json
├── .env.example                    # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASR_VENDOR_API_KEY (optional), ANTHROPIC_API_KEY (optional), ASR_WEBHOOK_SECRET
├── env.ts                          # zod-validated env; vendor keys marked .optional() for now
└── src/
    ├── index.ts                    # entrypoint: validates env, reads _scaffold_health on boot, starts heartbeat
    └── heartbeat.ts                # 60s setInterval loop, logs `worker heartbeat <timestamp>`
```

Scripts in `apps/worker/package.json`:

- `dev`: `tsx watch src/index.ts`
- `build`: `tsc`
- `start`: `node dist/index.js`
- `typecheck`: `tsc --noEmit`
- `lint`: `eslint src`
- `test`: `vitest run`

**Hello-world entrypoint:** on boot, log `worker starting`, validate env, call service client, `select count(*) from _scaffold_health`, log `db reachable`, then start heartbeat. Loop logs every 60 seconds and exits cleanly on SIGTERM.

---

## `apps/worker-cron/` — Node/TS Cron Job → Render

```
apps/worker-cron/
├── package.json                    # name: worker-cron, depends on @duly-noted/db, @duly-noted/shared
├── tsconfig.json
├── .env.example                    # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY (optional)
├── env.ts                          # zod-validated env; YOUTUBE_API_KEY .optional()
└── src/
    └── index.ts                    # entrypoint: validates env, reads _scaffold_health, logs tick, exits
```

Scripts: same shape as `apps/worker`, but `start` exits after a single run.

**Hello-world entrypoint:** validate env, read scaffold health, log `cron tick <timestamp>`, exit 0. Render Cron Job invokes this on schedule; it must not loop.

---

## `packages/db/` — Supabase clients

```
packages/db/
├── package.json                    # name: @duly-noted/db, type: module
├── tsconfig.json
└── src/
    ├── index.ts                    # re-exports the three client factories and types
    ├── browser-client.ts           # createBrowserClient() — anon key
    ├── server-client.ts            # createServerClient() — anon key with Next.js cookies passthrough
    ├── service-client.ts           # createServiceClient() — service_role; throws if SUPABASE_SERVICE_ROLE_KEY absent
    └── types.ts                    # placeholder: `export type Database = { public: { Tables: {} } };` with a TODO comment to regenerate via `supabase gen types typescript --linked > types.ts`
```

`service-client.ts` should include a runtime guard: if imported in a process where `SUPABASE_SERVICE_ROLE_KEY` is not set, throw immediately with a clear error. Web app never imports it.

---

## `packages/shared/` — common helpers

```
packages/shared/
├── package.json                    # name: @duly-noted/shared, type: module
├── tsconfig.json
└── src/
    ├── index.ts                    # re-exports
    └── env.ts                      # createEnvValidator(schema): wraps z.parse(process.env) with a clear error message listing which keys are missing/invalid
```

Mostly empty at this stage. Later slices fill it with prompt templates, segment schemas, etc.

---

## Supabase migration

Single migration file: `supabase/migrations/<timestamp>_scaffold.sql`.

```sql
-- Connectivity check (anon-readable)
create table public._scaffold_health (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);
alter table public._scaffold_health enable row level security;
create policy "anon can read scaffold health"
  on public._scaffold_health for select
  to anon, authenticated
  using (true);
insert into public._scaffold_health (message) values ('scaffold ok');

-- Stage 5 pass-1 minimum-viable schema. RLS enabled, no business policies yet.
-- Pass 2 (after Slice 2) adds full DDL: indexes, soft-delete, search columns, real RLS.

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.publications enable row level security;

create table public.towns (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (publication_id, slug)
);
alter table public.towns enable row level security;

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null references public.towns(id) on delete restrict,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (town_id, slug)
);
alter table public.boards enable row level security;

create type public.meeting_status as enum (
  'discovered',
  'pending',
  'extracting',
  'transcribing',
  'segmenting',
  'summarizing',
  'review',
  'published',
  'failed'
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete restrict,
  status public.meeting_status not null default 'discovered',
  youtube_id text,
  meeting_date date,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meetings enable row level security;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  role text not null check (role in ('reader', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  unique (user_id, publication_id)
);
alter table public.memberships enable row level security;
```

**Note on users.** Supabase's `auth.users` is the canonical identity store. Do not create a `public.users` table at v1. Memberships join `auth.users` to publications. Pass 2 may add a `public.profiles` table if profile fields are needed.

`supabase/seed.sql` is empty for now.

---

## `.github/workflows/ci.yml`

Triggers on PRs and pushes to `main`. Steps:

1. Checkout
2. Setup Node from `.nvmrc`
3. Setup pnpm
4. `pnpm install --frozen-lockfile`
5. `pnpm -r typecheck`
6. `pnpm -r lint`
7. `pnpm -r test --if-present`

No deploy step. Cloudflare Pages and Render handle their own deploys via git integrations. Migration deploy is wired in a later slice when the next migration is added.

---

## ADR seed

`docs/adr/0001-record-architecture-decisions.md`: ~10-line ADR explaining the ADR format itself (we use ADRs, here's the template). Standard MADR-style. Anchors the convention for later slices.

---

## Env validation pattern

Each app has its own `env.ts` using zod via the `createEnvValidator` helper from `@duly-noted/shared`. Imported at the top of each entrypoint. Throws at boot if any required key is missing.

Per-app required keys:

- **web**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ASR_WEBHOOK_SECRET`
- **worker**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASR_WEBHOOK_SECRET` — vendor keys (`ASR_VENDOR_API_KEY`, `ANTHROPIC_API_KEY`) marked `.optional()` until Slice 2/3
- **worker-cron**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — `YOUTUBE_API_KEY` marked `.optional()` until Slice 2

---

## Verification end-state

The session is done when all of these pass:

1. `pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test` succeeds locally.
2. Push to GitHub triggers CI; CI passes.
3. Cloudflare Pages auto-builds `apps/web` and serves a page at the production URL showing `scaffold ok` from `_scaffold_health`.
4. Render Background Worker auto-builds `apps/worker` and the Render logs show `worker starting`, `db reachable`, then `worker heartbeat` every 60s.
5. Render Cron Job auto-builds `apps/worker-cron`; manual invocation logs `cron tick`.
6. `/login` accepts an email, sends a magic link, the click completes auth, sets a session cookie, redirects to `/`.
7. `POST /auth/signout` clears the session.

---

## Out of scope for this session

- No business logic in any app.
- No actual ASR vendor integration. Webhook route returns 501.
- No actual YouTube Data API call. Cron just logs.
- No RLS policies on Stage 5 pass-1 tables beyond the default-deny (real policies come in Stage 5 pass 2 after Slice 2).
- No admin UI.
- No styling library.
- No tests beyond a single placeholder smoke test per app to keep CI happy.
- No alternatives to the locked stack in CLAUDE.md §2 — do not propose Vercel, Doppler, Turborepo, axios, or anything else CLAUDE.md rules out.

---

## Order of operations the plan should follow

1. Workspace bootstrap: root configs, `pnpm-workspace.yaml`, base tsconfig, eslint, prettier, gitignore, editorconfig, nvmrc, README, CI workflow.
2. Packages: `packages/shared` first (env helper), then `packages/db` (depends on env helper).
3. Supabase migration file authored; project linked locally via `supabase init` + `supabase link`.
4. Apps in this order: `apps/worker-cron` (simplest), `apps/worker`, `apps/web` (most setup).
5. Local verification: `pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test` all green.
6. Push to GitHub, confirm CI green.
7. Manual dashboard work: Cloudflare Pages project + GitHub connection; Render Background Worker + Cron Job + GitHub connection; Supabase magic link config (redirect URLs); paste secrets from Dashlane.
8. Verify deployed end-state per the checklist above.

Plan mode first. Show the plan covering all of the above before writing code. Wait for approval.
