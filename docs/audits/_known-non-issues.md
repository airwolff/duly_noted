# Known Non-Issues

Findings raised in audits and explicitly accepted as wont-fix.
Append-only. Each entry has a stable ID (`NI-NNN`) so audits can
reference it.

## How audits use this file

The audit prompt reads this file before producing findings. Any
item listed here is suppressed from new audits. If an audit
believes an entry warrants reconsideration, it lists the ID under
"Reopen candidates" in its report — it does not re-raise the item
as a finding.

## Entry format

```
## NI-NNN: <short title>
- Status: Accepted | Promoted (see [target]) | Withdrawn
- Source: docs/audits/<filename>#<finding-id>
- Date accepted: YYYY-MM-DD
- Scope: <files or component this applies to>
- Reasoning: <why this is acceptable now>
- Revisit when: <trigger condition, or "permanent">
```

## Promotion

When an entry's reasoning becomes a permanent stance, promote it:
- to `SPEC.md` if it's a product/architecture position, or
- to `docs/adr/NNNN-<slug>.md` if it's an architectural decision
  with tradeoffs.

After promotion, change Status to `Promoted (see <target>)` and
keep the entry — do not delete. The history is the value.

## Entries


## NI-001: Login client `?? ''` fallback for NEXT_PUBLIC_* env vars
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#finding-4
- Date accepted: 2026-05-06
- Scope: apps/web/src/app/login/page.tsx:7-8
- Reasoning: Client components in Next.js cannot call server-side Zod validators because `process.env` is not a runtime browser object — `NEXT_PUBLIC_*` values are inlined at build time. The web app's Zod-at-boot gate is enforced by `apps/web/middleware.ts` on every non-asset request, which throws before any page renders. Direct `process.env` reads with `?? ''` fallbacks in client components are stylistically loose but inherit the middleware gate; they are not a runtime safety risk.
- Revisit when: `middleware.ts` is removed, the `loadEnv()` boot gate moves elsewhere, or the login page starts reading server-only env vars (which would be a separate violation).

## NI-002: `_scaffold_health` INSERT lacks idempotency guard
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-2.md#question-3
- Date accepted: 2026-05-06
- Scope: supabase/migrations/20260505191054_scaffold.sql:23
- Reasoning: The INSERT is unguarded but the duplication failure mode is gated by the same migration's `CREATE TABLE` statement. If the migration ledger ever lost track and re-ran the migration, `CREATE TABLE` would fail first ("relation already exists") and roll back the transaction before the INSERT could fire. The realistic path runs the migration exactly once on a fresh database, where the INSERT correctly seeds one row. The probe page tolerates the degraded duplicate case via `.maybeSingle()`. No state-machine, security, or data-integrity impact. The seed cannot move to `seed.sql` because `seed.sql` only runs on `db reset`, not on `db push` to a fresh project.
- Revisit when: The scaffold migration is split (table creation moves to a separate migration from the seed INSERT), at which point the INSERT becomes independently reachable and needs a guard.

## NI-003: Scaffold migration DDL lacks `IF NOT EXISTS` / `OR REPLACE` guards
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-2.md#question-4
- Date accepted: 2026-05-06
- Scope: supabase/migrations/20260505191054_scaffold.sql:9-90
- Reasoning: Migration DDL guards (`IF NOT EXISTS`, `OR REPLACE`) are unnecessary in this project because (1) Supabase CLI migrations run in transactions per migration, making partial-apply structurally impossible once CI-driven migrations land per Finding 1; and (2) Postgres 15/16 has no clean `IF NOT EXISTS` form for `CREATE POLICY` or `CREATE TYPE ... AS ENUM`, so the remediation requires DO-blocks that are heavier and uglier than bare DDL. Bare DDL is the correct convention for this project.
- Revisit when: Migrations stop running through Supabase CLI / CI (i.e., Finding 1 is reverted), or Postgres adds `IF NOT EXISTS` support for `CREATE POLICY` and `CREATE TYPE AS ENUM` in a major version this project upgrades to.

## NI-004: Cloudflare Pages production build unverified by GitHub Actions CI
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#question-2
- Date accepted: 2026-05-06
- Scope: .github/workflows/ci.yml, apps/web/next.config.mjs
- Reasoning: Cloudflare Pages git integration runs the production build on every push to `main` and on every PR. As of 2026-05-06, all production deploys have succeeded (HEAD `7396364` deployed green). Cloudflare's deploy is the canonical build verifier per SPEC.md CI/CD section ("git integration on `main`. Preview deploys on PRs serve as the only non-prod environment"). Adding `pages:build` to GitHub Actions CI would duplicate the signal Cloudflare already provides. The lighter checks (typecheck/lint/test/format) catch the regressions CI is appropriate for; build regressions surface via Cloudflare on the PR or on `main`.
- Revisit when: A build regression lands on `main` without being caught by Cloudflare's build (i.e., Cloudflare reports green but runtime fails), or PR previews stop running reliably, or build time on Cloudflare becomes a bottleneck and a fail-fast CI check would shorten the loop.

## NI-005: Worker dev/start scripts rely on root-hoisted tsx/typescript
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#question-5
- Date accepted: 2026-05-06
- Scope: apps/worker/package.json, apps/worker-cron/package.json, root package.json
- Reasoning: `apps/worker` and `apps/worker-cron` rely on `tsx` and `typescript` hoisted from the workspace root devDependencies. This is the standard pnpm workspace pattern — pnpm hoists root devDeps and resolves them from per-workspace bin paths, which is why Render's `pnpm install --frozen-lockfile && pnpm -F worker build` succeeds. The conditional risk (a future Render contract that strips devDeps via `--prod` or similar) is not a present defect, and the remediation if it ever fires is a 30-second `package.json` edit per worker. Duplicating `tsx`/`typescript` into each worker's devDependencies now would defend against an unspecified future change at the cost of a slightly fatter dependency graph.
- Revisit when: Render's build documentation introduces `--prod`, devDep-stripping behavior, or any other contract change that breaks pnpm root-hoisted devDep resolution; or when a third worker workspace is added (point at which the duplication cost compounds).

## NI-006: Three direct-push commits on main lack Conventional Commits prefix
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-3.md#question-1
- Date accepted: 2026-05-06
- Scope: commits 1d86bd9, fbc03eb, 83391b0 on main
- Reasoning: The three commits are immutable artifacts of initial render.yaml deploy debugging during the bootstrap window. Force-pushing main to rewrite history is destructive (invalidates every downstream contributor's clone) and disproportionate to three tiny config tweaks with no runtime impact. CLAUDE.md §5 mandates PR squash-merges going forward, which authors the squash commit message deliberately and bounds this violation category at the merge boundary. The deploy-debugging window that produced these commits is closed.
- Revisit when: A direct-push to main without a Conventional Commits prefix occurs after the PR squash-merge convention is established; or an audit finds the pattern repeating beyond the initial deploy-debugging window.
