# 0004. Monorepo with pnpm workspaces

Date: 2026-05-05
Status: Accepted

## Context

Duly Noted ships three apps (`apps/web`, `apps/worker`, `apps/worker-cron`)
that need to share a Supabase client factory, generated DB types, Zod
schemas, prompt templates, and segmentation logic. Two surfaces deploy
independently — Cloudflare Pages for web, Render for worker and cron —
but every surface depends on the same domain types and the same DB
contract.

Splitting these into separate repos would force version-pin coordination
on shared types every time the schema moves; bundling them into a single
deploy unit would couple the web and worker release cadences.

## Considered options

- **pnpm workspaces** — minimum-viable monorepo. Shared packages live
  under `packages/`; apps live under `apps/`. No build-graph tooling.
- **Two separate repos** — clean deploy boundaries but constant
  cross-repo type/contract drift.
- **pnpm + Turborepo** — adds task scheduling and remote caching;
  worth it once CI runtime warrants it.

## Decision

Single monorepo using pnpm workspaces. `apps/*` for deployables;
`packages/db` and `packages/shared` for shared code. Turborepo deferred.

## Consequences

- Shared types and the Supabase client factory live in `packages/db`
  and `packages/shared`; cross-app imports are forbidden by ESLint.
- CI runs `pnpm -r {typecheck,test,lint}` on every PR with no graph
  awareness. Acceptable while runtime stays under ~3 minutes.
- Migration to Turborepo is documented as ~30 minutes of work when it's
  needed.
- Revisit: when CI runtime exceeds ~3 minutes consistently.
