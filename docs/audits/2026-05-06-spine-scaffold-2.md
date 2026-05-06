---
date: 2026-05-06
scope: Spine scaffold re-audit (root → HEAD) under the multi-agent code-audit skill. Includes the protect-audits hook commit added since the first audit.
commit_range: 9d06ba9..7396364
head_sha: 73963644499e4faab206c33eaef71259d530ac63
prior_audit: 2026-05-06-spine-scaffold.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
sources_used:
  - code-review-plugin: not_installed
  - custom-passes: P1, P2, P3, P4, P5, P6
findings_count: 8
questions_count: 9
findings_dropped_by_verification: 2
findings_moved_to_questions_by_verification: 4
findings_filtered_by_known_non_issues: 0
---

# Audit — Spine scaffold re-audit (root → HEAD)

This is a re-audit of the same scope covered by `2026-05-06-spine-scaffold.md`, run under the multi-agent code-audit skill (six parallel custom passes + per-finding verification). The prior audit's findings are not auto-suppressed — every issue here was independently re-derived.

## Mechanical pass results

| Check                                | Outcome                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r lint`                       | Pass — 5 workspaces                                                                                                                                                                                                                                                                                                |
| `pnpm -r typecheck`                  | Pass — 5 workspaces                                                                                                                                                                                                                                                                                                |
| `pnpm -r test`                       | Pass — 6 test files, 8 tests                                                                                                                                                                                                                                                                                       |
| `pnpm format:check`                  | **Fail** — 4 files unformatted: `.claude/skills/apply-audit-fixes/SKILL.md`, `docs/audits/_known-non-issues.md`, `docs/audits/2026-05-06-spine-scaffold.md`, `docs/workflows/build-cycle.md`. The prior audit's Q1 prediction has materialized — the prior audit file itself is now on disk and triggers prettier. |
| `git diff --shortstat 9d06ba9..HEAD` | 51 files changed, 1138 insertions(+), 1 deletion(-)                                                                                                                                                                                                                                                                |
| TODO/FIXME/XXX in changed files      | 1 hit — `packages/db/src/types.ts:1` (intentional, deferred per SPEC.md Stage 5 pass-1)                                                                                                                                                                                                                            |
| `console.*` outside `apps/worker*`   | None                                                                                                                                                                                                                                                                                                               |
| Hardcoded URLs                       | Only `apps/web/next-env.d.ts:6` (auto-generated comment URL)                                                                                                                                                                                                                                                       |
| Secret-shaped strings                | None                                                                                                                                                                                                                                                                                                               |
| `.env*` literal references           | All in env loaders, the login client read, and tests — no leaks                                                                                                                                                                                                                                                    |
| New file > 500 LOC or > 50 KB        | `apps/web/tsconfig.tsbuildinfo` — 157 302 bytes (single-line incremental cache)                                                                                                                                                                                                                                    |
| File grew > 200 LOC                  | None                                                                                                                                                                                                                                                                                                               |
| Test ratio (new)                     | 5 test files vs 22 source files — light, but acceptable for a scaffold                                                                                                                                                                                                                                             |
| `code-review` plugin                 | **Not installed** — custom passes only this run                                                                                                                                                                                                                                                                    |

Engine warning each pnpm run: workspace pins Node `>=24` but local toolchain is on `v22.14.0`. CI uses `.nvmrc` (`24`).

## Findings

### F1 — CI workflow has no migration-application step, contradicting SPEC.md Stage 1

- Severity: **HIGH**
- Source: custom-P5
- File: `.github/workflows/ci.yml` (entire file) and `supabase/migrations/20260505220316_grant_scaffold_health_select.sql:1-5`
- Finding: `.github/workflows/` contains exactly one workflow (`ci.yml`) whose steps are checkout/setup/install/typecheck/lint/test/format-check. There is no `supabase db push`, `supabase migration up`, or any other migration step anywhere in `.github/`. SPEC.md:72 mandates "Migrations: Supabase CLI run from a GitHub Action on merge to `main`, before the Render auto-deploy completes." CLAUDE.md §2 echoes this. The grants migration's own header comment is the smoking gun: "These were applied manually via the SQL editor against the live project; codifying here so `supabase db reset` produces the same state."
- Evidence:
  - `find .github -type f` → only `.github/workflows/ci.yml`
  - `grep -r supabase .github/` → zero hits
  - `supabase/migrations/20260505220316_grant_scaffold_health_select.sql:1-5` confirms hand-application
  - SPEC.md:72, CLAUDE.md:51 — both name CI-driven migrations as the documented practice
- Verification reasoning: V12 attempted to disprove and could not. Confirmed both spec-vs-reality gap and direct evidence (the grants migration's own comment) that hand-application is the operative path.
- Confidence: **99**

### F2 — `apps/web/tsconfig.tsbuildinfo` (157 KB) committed and not gitignored

- Severity: **LOW** (downgraded from prior audit's HIGH after verification)
- Source: custom-P2
- File: `apps/web/tsconfig.tsbuildinfo` (157 302 bytes, tracked)
- Finding: TypeScript incremental build cache committed to the repo. `.gitignore` covers `dist/`, `build/`, `.next/`, `.open-next/`, `.vercel/`, `.wrangler/` but not `*.tsbuildinfo`. `apps/web/tsconfig.json:8` sets `"incremental": true`.
- Evidence:
  - `git ls-files | grep tsbuildinfo` → `apps/web/tsconfig.tsbuildinfo`
  - Verification regenerated the file via `pnpm -F web typecheck` after deleting it; produced a real diff (different MD5).
- Verification reasoning: V9 confirmed the file is purely a cache that tsc regenerates. Severity ceiling is LOW — the file does NOT churn on every typecheck (only on cache invalidation: fresh clone, dep change, branch hop, or deletion), so the practical PR noise is intermittent rather than constant. No correctness, security, or build impact. The prior audit's HIGH severity overstated the harm; LOW is calibrated.
- Confidence: **100**

### F3 — SPEC.md misstates Postgres FK indexing semantics

- Severity: **MEDIUM**
- Source: custom-P1 ∪ custom-P3
- File: `SPEC.md:134` (the "Indexes" paragraph in the Stage 5 pass-1 block)
- Finding: SPEC says "Only the primary keys, the `unique` constraints listed above, and the FK indexes Postgres creates implicitly for `references`." Postgres does **not** create indexes on FK referencing columns — only the _referenced_ (PK) side, via the PK's own implicit unique index. The migration has zero `CREATE INDEX` statements. As a side effect, `meetings.board_id` has no FK-side index and `memberships.publication_id` (trailing column of the composite UNIQUE) has no usable FK-side index either. The composite UNIQUEs on `towns` and `boards` happen to cover their FK columns _as the leading column_ — that is incidental to the unique constraint, not "implicit FK indexing."
- Evidence:
  - SPEC.md:134 quoted above.
  - `supabase/migrations/20260505191054_scaffold.sql` — no `create index` statements.
  - PostgreSQL docs §5.5.5: indexes on referencing columns are the user's responsibility.
- Verification reasoning: V1 confirmed the wording is unambiguous and factually wrong; not mooted by the next sentence ("Performance-tuning indexes … arrive in pass 2") which is consistent with the absence but does not retract the false claim.
- Confidence: **97**

### F4 — SPEC.md per-surface secrets table omits `SUPABASE_URL` for Render Worker and Cron

- Severity: **MEDIUM**
- Source: custom-P1
- File: `SPEC.md:55-63`
- Finding: The per-surface secrets table lists `NEXT_PUBLIC_SUPABASE_URL` only on Cloudflare Pages and has no row for `SUPABASE_URL`. But `apps/worker/src/env.ts:5` and `apps/worker-cron/src/env.ts:5` both validate `SUPABASE_URL: z.string().url()` as required, both `.env.example` files list it as the first key, and `render.yaml` provisions it via the `duly-noted-shared` env-var group. The table is presented as the operator's per-surface checklist; an operator provisioning Render env vars from this table would not know to also set `SUPABASE_URL`.
- Evidence:
  - `apps/worker/src/env.ts:5`, `apps/worker-cron/src/env.ts:5` — required `z.string().url()`.
  - `apps/worker/.env.example:1`, `apps/worker-cron/.env.example:1` — list `SUPABASE_URL=`.
  - `render.yaml` — defines `SUPABASE_URL` in the shared env-var group.
- Verification reasoning: V3 confirmed; rejected the "naming flexibility" hypothesis (the table uses literal env var names in backticks elsewhere) and the "render.yaml is the source of truth" hypothesis (SPEC's table presents itself as the source of truth for per-surface env).
- Confidence: **95**

### F5 — `apps/web/` files use deep relative imports instead of the `@/` alias

- Severity: **LOW**
- Source: custom-P2
- Files / lines:
  1. `apps/web/src/app/api/webhooks/asr/route.ts:2` — `'../../../../../env.js'` (5 levels up)
  2. `apps/web/src/lib/supabase-server.ts:3` — `'../../env.js'`
  3. `apps/web/src/app/auth/callback/route.ts:2` — `'../../../lib/supabase-server.js'`
  4. `apps/web/src/app/auth/signout/route.ts:2` — `'../../../lib/supabase-server.js'`
  5. `apps/web/src/app/page.tsx:1` — `'../lib/supabase-server.js'`
- Rule: CLAUDE.md §4 — "Imports: absolute via `@/` alias inside an app or package; relative across nothing."
- Finding: Two distinct sub-cases.
  - **#1, #2** (env.ts climbs): structural — `apps/web/env.ts` lives outside `src/`, so the `@/* → ./src/*` alias cannot reach it. Fix needs either an `env.ts` move or a second tsconfig paths entry (e.g., `'@env'`).
  - **#3, #4, #5** (in-`src/` relatives): pure style — every target _is_ reachable via `@/lib/...`. 30-second mechanical fix.
- Verification reasoning: V7 confirmed the rule text and all five import lines; recommended splitting into the two sub-cases.
- Confidence: **90**

### F6 — ADR-0001 cost figures contradict SPEC.md

- Severity: **LOW**
- Source: custom-P1
- File: `docs/adr/0001-render-for-background-worker.md:19, 32-34, 44-45`
- Finding: ADR says "$7/mo each" for Worker + Cron and "Two paid Render services (~$14/mo)". SPEC.md:81-82 has Worker $7 + Cron ~$1. Render Cron Jobs are billed per-execution-minute, not as flat-rate Starter instances; SPEC's `~$1/mo` is correct. The ADR overstates the Render bill by ~$6/mo and arrives at a $39/mo floor that disagrees with SPEC's $34/mo.
- Evidence:
  - ADR:19 — "$7/mo each on Starter"
  - ADR:44-45 — "Two paid Render services (~$14/mo) … Total infra floor ~$39/mo before vendor APIs"
  - SPEC.md:81-84 — fixed cost table totalling ~$34/mo
- Verification reasoning: V4 confirmed; rejected "ADR is pre-decision" (ADR is dated 2026-05-05 with Status: Accepted) and "$14 covers Worker + something else" (ADR explicitly enumerates the two services as Worker + Cron).
- Confidence: **92**

### F7 — SPEC.md repo-structure tree omits `apps/worker-cron/`

- Severity: **LOW**
- Source: custom-P1
- File: `SPEC.md:33-45`
- Finding: The tree lists only `apps/web/` and `apps/worker/` under `apps/`, but Stage 1's deployment-topology paragraph (line 9) names `apps/worker-cron` as a separate Render Cron Job, the per-surface secrets table has a separate Render Cron column, the cost table has a separate `Render Cron Job ~$1` line, and CLAUDE.md's repo layout correctly lists `apps/worker-cron/`. No completeness disclaimer follows the SPEC tree. The tree itself is internally inconsistent with the rest of SPEC.md.
- Evidence: SPEC.md:33-45 (tree); SPEC.md:9 (topology); SPEC.md:55-63 (secrets table); SPEC.md:82 (cost line); CLAUDE.md repo layout; filesystem confirms `apps/worker-cron/` exists.
- Verification reasoning: V5 confirmed; the tree has no "illustrative simplification" disclaimer.
- Confidence: **97**

### F8 — SPEC.md claims a `rootDir: apps/worker` deploy filter that doesn't exist

- Severity: **LOW**
- Source: custom-P1
- File: `SPEC.md:70`
- Finding: SPEC says "Render Worker + Cron: git integration on `main`, `rootDir: apps/worker` filter prevents unrelated changes from redeploying." `render.yaml` has no `rootDir`, `rootDirectory`, `buildFilter`, or any other path-filter field. Render's git auto-deploy will redeploy both services on any push to `main` regardless of which app changed. (Side note: `rootDir` is not the render.yaml field name even if the filter were added — the correct field is `buildFilter.paths`/`ignoredPaths`.)
- Evidence:
  - `render.yaml` end-to-end inspection — no rootDir/buildFilter.
  - Repo-wide grep for `rootDir`/`buildFilter` returns only the SPEC sentence itself plus tsconfig `compilerOptions.rootDir` (unrelated).
- Verification reasoning: V6 confirmed. No comment near SPEC.md:70 marks the claim as planned/aspirational.
- Confidence: **92**

## Questions for human

### Q1 — Login client component reads `process.env.NEXT_PUBLIC_*` directly with `?? ''` fallbacks (was prior F4)

- File: `apps/web/src/app/login/page.tsx:7-8`
- Verification (V8) downgraded this from the prior audit's MEDIUM-HIGH. Why: client components can't meaningfully call the server-side Zod validator (`process.env` is not a runtime browser object — Next.js inlines `NEXT_PUBLIC_*` at build time), so the "fail at first user interaction instead of at boot" framing is wrong. The web app's actual boot-time gate is `apps/web/middleware.ts`, which calls `loadEnv()` on every non-asset request and would throw before the login page renders. The `?? ''` fallback only matters at _build_ time (Next.js inlines `''` into the bundle if the var is missing), and even then, middleware fails first on the first request.
- Why this needs you: it's still a stylistic blemish (the cleaner pattern is for a server-component parent to read `loadEnv()` and pass URL/key as props to the client component). But the prior audit's framing of it as a runtime safety risk doesn't survive verification. Your call: keep as a LOW finding to track the cleanup, or accept and promote to `_known-non-issues.md` under "Zod-at-boot is enforced by middleware; client components inherit the gate."

### Q2 — `meetings.updated_at` has no BEFORE UPDATE trigger

- File: `supabase/migrations/20260505191054_scaffold.sql:78`
- Verification (V11) returned conf 75 (below the 80 floor for Findings). The column has `default now() not null` but no trigger. SPEC's pass-2 deferral list (line 117) enumerates "indexes beyond primary keys, soft-delete columns, search columns, and real RLS policies" — triggers are not explicitly named. The column is currently unused (zero references in `apps/`/`packages/`), so this is latent rather than active. Will become real the moment Slice 2 worker code starts writing `UPDATE meetings SET status = ...`.
- Why this needs you: do you want pass-2 to add a trigger, mandate application-side maintenance, or drop the column?

### Q3 — Scaffold migration's `INSERT INTO _scaffold_health` lacks idempotency guard

- File: `supabase/migrations/20260505191054_scaffold.sql:23`
- Verification (V13) confirmed the literal claim but dropped confidence to ~30 because the duplication failure mode is gated by the same migration's `CREATE TABLE` — if the migration ever re-ran without the ledger noticing, `CREATE TABLE` would error first ("relation already exists") and roll back the transaction before the INSERT. Practical blast radius: `apps/web/src/app/page.tsx` uses `.maybeSingle()` which would render a degraded probe error if duplicates somehow appeared; no state-machine, security, or data-integrity impact.
- Why this needs you: do you want to harden against the unrealistic replay path (one-line `WHERE NOT EXISTS`), accept and document, or move the seed to `supabase/seed.sql`? Note: `seed.sql` only runs on `db reset`, not on `db push` to a fresh project, so moving it would actually break the homepage probe on first prod deploy.

### Q4 — Scaffold migration DDL lacks IF NOT EXISTS / OR REPLACE guards

- File: `supabase/migrations/20260505191054_scaffold.sql:9-90`
- Verification (V14) returned conf 35 (below floor). The literal claim is correct, but two reasons make this a question rather than a finding: (a) it is downstream of F1 — once `supabase db push` runs from CI, each migration is wrapped in a transaction by the CLI, making partial-apply structurally impossible and IF NOT EXISTS guards redundant; (b) Postgres 15/16 (Supabase's current major) has no `CREATE POLICY ... IF NOT EXISTS` form and no `CREATE TYPE ... AS ENUM IF NOT EXISTS` form, so the proposed remediation is not fully expressible without DO-blocks.
- Why this needs you: this likely resolves the moment F1 lands. Confirm that's the intended path (don't add guards), or signal that hand-application will continue and guards should be added defensively.

### Q5 — Format-check trap on uncommitted scaffold files (still open from prior audit's Q1)

- `pnpm format:check` fails on `.claude/skills/apply-audit-fixes/SKILL.md`, `docs/audits/_known-non-issues.md`, `docs/audits/2026-05-06-spine-scaffold.md`, `docs/workflows/build-cycle.md`. Same shape as prior Q1 — except the prior audit _itself_ now triggers it. Every new audit file will trip prettier until either (a) the audit pipeline runs prettier on its output before writing, or (b) `.prettierignore` skips `docs/audits/*.md`.
- Why this needs you: the audit skill writes the file directly. Add a `.prettierignore` line for the audit directory, or change the audit-write step to invoke prettier?

### Q6 — Cloudflare Pages production build of `apps/web` is unverified by CI (still open from prior audit's Q2)

- `apps/web/next.config.mjs` has a webpack `extensionAlias` workaround for `verbatimModuleSyntax: true` + `moduleResolution: "bundler"` + the `.js` import suffix convention. CI runs typecheck/lint/test/format-check but not `pnpm -F web pages:build`. There is no green-build evidence that `@cloudflare/next-on-pages` consumes the `.next` output successfully.
- Why this needs you: has the first deploy of `apps/web` to Cloudflare Pages succeeded? If not, this is real risk. If yes, the CI gap is acceptable for now and worth a note.

### Q7 — Webhook test relies on module-cache stickiness of `loadEnv` (still open from prior audit's Q3)

- `apps/web/src/app/webhook.test.ts` mutates `process.env` in `beforeEach` and dynamically imports the route. `apps/web/env.ts` caches the parsed env in module scope. Both tests happen to seed `'shhh'`, so the cache is compatible. A future test seeding a different `ASR_WEBHOOK_SECRET` will silently get the cached value.
- Why this needs you: design choice. Export a `_resetEnvCacheForTests()`, switch to dependency injection, or document "tests seed a single env per file".

### Q8 — Pass-2 GRANT checklist (still open from prior audit's Q4)

- The grants follow-up migration `20260505220316_grant_scaffold_health_select.sql` exists because table-level GRANTs were missing on `_scaffold_health` despite RLS allowing the read. The same will be true for `publications`/`towns`/`boards`/`meetings`/`memberships` once pass-2 RLS policies land.
- Why this needs you: is there a pass-2 checklist or template that pairs each new policy with its required GRANTs? (Note: F1 partially mitigates this — once CI runs `db push`, hand-applying-then-forgetting becomes impossible because the migration is the deploy.)

### Q9 — Worker `dev`/`start` scripts depend on root-hoisted `tsx`/`typescript` (still open from prior audit's Q5)

- `apps/worker/package.json` and `apps/worker-cron/package.json` declare `dev` (`tsx watch`) and `build` (`tsc`) but neither workspace lists these as dependencies. Render's build command (`pnpm install --frozen-lockfile`) succeeds because pnpm hoists root devDependencies, but a future `--prod` flag or devDep stripping would break.
- Why this needs you: keep root-only (lean, current) versus duplicate `tsx`/`typescript` into each worker (redundant, isolated)?

## Reopen candidates

None. `_known-non-issues.md` registry is empty.

## What NOT to fix (this audit)

- **Performance indexes on FK columns and `meetings.status`** — explicitly deferred per SPEC.md Stage 5 pass-1 "Indexes" paragraph. (F3 flags the spec's _wording_ about FK indexing; it does not flag the absence of the indexes themselves.)
- **`packages/db/src/types.ts` placeholder + TODO** — explicitly deferred per SPEC.md Stage 5 pass-1 "Identity"; regen after Slice 2 once the live project is linked.
- **`render.yaml` `# TODO(stage-2): production schedule TBD`** — Stage 2 territory.
- **No business RLS policies on the five Stage-5 tables** — explicitly default-deny per SPEC.md Stage 5 pass-1.
- **No `unique` on `meetings.youtube_id`** — verification (V10) confirmed this is explicitly deferred per SPEC pass-2 and was already named in the prior audit's "What NOT to fix". Do not raise.
- **Worker has no actual queue-poll loop, cron has no YouTube call** — Slice 2/3 territory.
- **Three "another render change" commits (1d86bd9, fbc03eb, 83391b0)** — modify `render.yaml` only; not material to this audit.

## Findings dropped by verification (not raised)

- **`_scaffold_health` policy roles broader than SPEC** (P1-2 ∪ P3-1) — V2 disproved. SPEC.md:119 ("an anon SELECT") describes the use case (anonymous reading from the homepage), not an exhaustive role list. SPEC.md:136 explicitly enumerates `anon`, `authenticated`, `service_role` as the API role set. Including `authenticated` in the policy is the conventional Supabase pattern; omitting it would _break_ logged-in homepage rendering. The prior audit's F5 was a misread; correctly dropped here.
- **`meetings.youtube_id` has no unique constraint** (P3-3) — V10 disproved. Explicitly deferred to pass-2 per SPEC; SPEC's "Worker invocations are idempotent" guarantee is scoped to the worker step (preventing ASR double-charge), not to the cron's discovery boundary.

## Suggested fix order

By dependency, not severity:

1. **F1 (HIGH)** — wire `supabase db push` into `.github/workflows/` per SPEC.md:72. Independent. Unblocks Q4 and Q8 procedurally.
2. **F2 (LOW)** — add `*.tsbuildinfo` to `.gitignore` and `git rm --cached apps/web/tsconfig.tsbuildinfo`. ~2 min.
3. **F3 (MEDIUM)** — one-paragraph SPEC.md fix to the "Indexes" paragraph. Optionally pre-load pass-2 with an explicit "FK columns require manual indexing" note. ~5 min.
4. **F4 (MEDIUM)** — add a `SUPABASE_URL` row to SPEC.md's per-surface secrets table. ~2 min.
5. **F7 (LOW)** — add `apps/worker-cron/` to the SPEC.md repo-structure tree. ~1 min.
6. **F8 (LOW)** — either add `buildFilter.paths` to `render.yaml` or correct the SPEC sentence. ~5 min.
7. **F6 (LOW)** — update ADR-0001's cost figures to match SPEC. ~3 min.
8. **F5 (LOW)** — split into two PRs:
   - F5a: in-`src/` relatives → `@/lib/...` (mechanical).
   - F5b: env.ts climbs → relocate `apps/web/env.ts` into `src/lib/env.ts` (touches `tsconfig.json`, `middleware.ts`, two route handlers, `supabase-server.ts`, the test).
9. **Q1** — best decided after F5b lands; the cleanest fix for Q1 is to read `loadEnv()` from a server file and pass values as props to the client component, which is easier once env.ts is colocated.

## Summary

| Severity                                        | Count                  |
| ----------------------------------------------- | ---------------------- |
| BLOCKER                                         | 0                      |
| HIGH                                            | 1 (F1)                 |
| MEDIUM                                          | 2 (F3, F4)             |
| LOW                                             | 5 (F2, F5, F6, F7, F8) |
| NIT                                             | 0                      |
| **Total findings**                              | **8**                  |
| **Questions for human**                         | **9**                  |
| **Reopen candidates**                           | **0**                  |
| **Findings dropped by verification**            | **2**                  |
| **Findings moved to questions by verification** | **4**                  |
| **Findings filtered by `_known-non-issues.md`** | **0** (registry empty) |

Mechanical: lint/typecheck/test green; format:check fails on out-of-scope untracked files plus the prior audit (Q5).

Sources used: six custom passes (P1 SPEC, P2 CLAUDE, P3 schema, P4 dead code, P5 migration safety, P6 hallucination). The Anthropic `/code-review` plugin was not installed; if added, run again to combine plugin findings with these.

Notable shifts vs. prior audit:

- **F1 (HIGH) is new** — prior audit alluded to it via Q4 but did not raise the missing CI workflow itself. Multi-pass design surfaced it cleanly via P5.
- **F2 severity downgraded LOW** (was prior F1 HIGH) — verification showed cache only churns on invalidation, not every typecheck.
- **Prior F5 dropped** — `_scaffold_health` policy roles were a misread of SPEC prose.
- **Prior F4 moved to Q1** — verification dismantled the "fails at user interaction" premise; middleware enforces first.
- **Four new findings** beyond what the prior audit caught: F4 (SUPABASE_URL secrets-table gap), F6 (ADR cost figures), F7 (SPEC tree omits worker-cron), F8 (SPEC rootDir filter doesn't exist).
