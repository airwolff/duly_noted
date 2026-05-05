# Duly Noted

AI-powered local government meeting transcription and summarization tool for a regional newsroom.

Architecture and data model live in [`SPEC.md`](./SPEC.md). Repo conventions, hard rules, and locked stack live in [`CLAUDE.md`](./CLAUDE.md). Architectural decisions are recorded under [`docs/adr/`](./docs/adr/).

## Local setup

Prerequisites: Node 24 (use `nvm use`), pnpm via corepack, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
corepack enable
pnpm install
```

### Supabase

The repo ships with a single scaffold migration. To run it against a real Supabase project:

1. Create the Supabase project at supabase.com (name: `duly-noted`).
2. From Project Settings → API, copy the project URL, anon key, and service role key.
3. Copy the project ref from the URL `https://app.supabase.com/project/<ref>`.
4. `supabase login` (opens browser for auth).
5. `supabase link --project-ref <ref>` from repo root.
6. `cp .env.example .env.local` in each app directory and paste values.
7. `supabase db push` to apply migrations.

For local Postgres development:

```sh
supabase start    # local Postgres + Studio
supabase db reset # rebuild from migrations + seed
```

## Workspace layout

```
apps/web          Next.js (App Router) → Cloudflare Pages
apps/worker       Node/TS Background Worker → Render
apps/worker-cron  Node/TS Cron Job → Render
packages/db       Supabase clients + generated types
packages/shared   Zod schemas, prompt templates, domain helpers
supabase/         Migrations, seed, config
docs/adr/         Architecture decision records
```

## Common commands

```sh
pnpm -r build       # build all workspaces
pnpm -r test        # run all tests
pnpm -r typecheck   # tsc --noEmit across workspaces
pnpm -r lint        # ESLint
pnpm format         # Prettier write
pnpm -F web dev     # local Next.js dev server
pnpm -F worker dev  # local worker (tsx watch)
```
