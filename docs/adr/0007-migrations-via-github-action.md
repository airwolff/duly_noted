# 0007. Migrations via GitHub Action, not worker boot

Date: 2026-05-05
Status: Accepted

## Context

Schema migrations have to run somewhere on merge to `main`. The two
plausible places are: (a) the Render worker boots, runs pending
migrations, then enters its poll loop; or (b) a dedicated GitHub Action
runs `supabase db push` on merge while Render redeploys in parallel.

Option (a) couples runtime startup to schema state. Option (b) keeps
schema concerns on a separate path but introduces a parallel-deploy
race: the migration job and the Render auto-deploy run concurrently,
so the worker may briefly run pre-migration code against a
post-migration schema or vice versa.

## Considered options

- **GitHub Action runs `supabase db push` on merge to `main`** —
  schema concerns stay off the runtime path. Backwards-compatible
  migrations make the parallel-deploy race safe.
- **Worker boot runs migrations** — couples startup to schema state;
  every worker restart re-checks migration status; harder to reason
  about during incidents.
- **Manual migration** — operationally fragile; easy to forget after a
  merge.

## Decision

Migrations run from a GitHub Action on merge to `main`. Migrations are
forward-only and must be backwards-compatible with the previously
deployed worker (additive ahead of consuming code; expand/contract for
destructive changes).

## Consequences

- Schema changes are decoupled from worker startup. The worker boots
  fast and never blocks on migration logic.
- The migrate workflow runs in parallel with Render's auto-deploy.
  Backwards-compatibility is the substantive guarantee that makes the
  parallelism safe; this is codified in CLAUDE.md §6.
- Rollback is by writing a forward migration that undoes — no `down`
  scripts.
- Revisit: when zero-downtime requirements force pre/post-deploy
  migration phasing (deploy hook, concurrency gate, or worker-side
  migration-version check).
