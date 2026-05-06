---
date: 2026-05-06
scope: Spine scaffold — every commit since the root commit (workspace bootstrap, packages, three apps, Stage 5 pass-1 schema, Stage 7 magic-link auth wiring, Stage 1/7 spec amendments)
commit_range: 9d06ba9..251d271
head_sha: 251d271198598e3ecccdf4ddc16e4c01e9862826
prior_audit: none
known_non_issues_consulted: true
findings_count: 5
questions_count: 5
---

# Audit — Spine scaffold (root → HEAD)

## Mechanical pass results

| Check | Outcome |
| --- | --- |
| `pnpm -r lint` | Pass — 5 workspaces, no warnings |
| `pnpm -r typecheck` | Pass — 5 workspaces |
| `pnpm -r test` | Pass — 6 test files, 8 tests across 5 workspaces |
| `pnpm format:check` | **Fail** — 5 files unformatted, all OUT OF SCOPE (`.claude/skills/*.md`, `docs/audits/_known-non-issues.md`, `docs/workflows/build-cycle.md` — none committed; `git ls-files` does not include them) |
| `git diff --shortstat 9d06ba9..HEAD` | 50 files changed, 1107 insertions(+), 1 deletion(-) |
| TODO/FIXME/XXX grep on changed files | 1 hit — `packages/db/src/types.ts:1` (intentional, deferred per SPEC.md Stage 5 pass-1) |
| `console.*` grep | Worker/cron only (intentional observability); zero in `apps/web` |
| Hardcoded URLs | None in code paths; only doc URLs and `localhost`/`127.0.0.1` in `supabase/config.toml` (local CLI) |
| JWT/secret-shaped strings | None |
| `.env*` literal references | All confined to env loaders, the login page client-bundle reads, and tests — no leaks |
| New file > 500 LOC | `apps/web/tsconfig.tsbuildinfo` — 1 LOC, **157 KB**, single minified line (see F1) |
| File grew > 200 LOC | None |
| Test ratio (new) | 4 test files vs ~26 source files — light but acceptable for a scaffold |

Engine warning during every pnpm run: workspace pins Node `>=24` but the local toolchain is on `v22.14.0`. CI uses `.nvmrc` (`24`) so it ran on Node 24; local results above were obtained on Node 22 with no observed failures.

## Findings

### F1 — Build artifact `apps/web/tsconfig.tsbuildinfo` committed and not gitignored

- Severity: **HIGH**
- Pass: mechanical (file size + tracked-files sweep)
- File: `apps/web/tsconfig.tsbuildinfo` (157 302 bytes, committed in `9c3f521 feat(apps): scaffold worker-cron, worker, and web with magic-link auth`)
- Finding: A TypeScript incremental build cache is checked into the repo, regenerated on every `pnpm -F web typecheck`, and absent from `.gitignore`. Future typechecks will produce uncommitted diffs and noisy `git status`; if anyone ever runs `git add -A` it will be re-staged.
- Evidence:
  - `git ls-files | grep tsbuildinfo` → `apps/web/tsconfig.tsbuildinfo`
  - `.gitignore` (line ranges 5–13) lists `dist/`, `build/`, `.next/`, `.open-next/`, `.vercel/`, `.wrangler/` but no `*.tsbuildinfo`.
  - `apps/web/tsconfig.json:8` sets `"incremental": true`, which writes this file every typecheck.
- Confidence: **100**

### F2 — SPEC.md misstates Postgres FK indexing behaviour

- Severity: **MEDIUM**
- Pass: P1 (SPEC compliance) crossed with P3 (schema integrity)
- File: `SPEC.md` Stage 5 pass-1, "Indexes" paragraph
- Finding: SPEC.md says "Only the primary keys, the `unique` constraints listed above, and the FK indexes Postgres creates implicitly for `references`." Postgres does **not** create implicit indexes on FK referencing columns — only on the referenced column (the PK side, via the PK's own implicit unique index). The referencing columns (`towns.publication_id`, `boards.town_id`, `meetings.board_id`, `memberships.user_id`, `memberships.publication_id`) are **un-indexed** as the migration stands.
- Evidence:
  - `SPEC.md:121` (the indexes paragraph in the Stage 5 pass-1 block).
  - `supabase/migrations/20260505191054_scaffold.sql` — no `create index` statements; only PKs, the `(publication_id, slug)` / `(town_id, slug)` / `(user_id, publication_id)` UNIQUEs, and FK constraints.
  - Postgres docs (`CREATE TABLE` → "Foreign Keys"): "PostgreSQL does not enforce that the columns of a unique constraint must reference a primary key… The constraint requires that the referenced columns be indexed (which is automatically the case for primary key columns), but it does **not** automatically create an index on the referencing side."
- Why it matters: The audit is flagging the *spec*, not the implementation. The migration is consistent with the rest of the spec ("Performance-tuning indexes … arrive in pass 2."), but a future maintainer reading the cited paragraph will plan pass-2 indexing on a wrong assumption. Either the doc text needs correcting or pass-2 needs an explicit reminder that FK columns must be hand-indexed.
- Confidence: **100**

### F3 — Two import-convention violations of CLAUDE.md §4 inside `apps/web/`

- Severity: **LOW**
- Pass: P2 (CLAUDE.md compliance)
- Files / lines:
  - `apps/web/src/app/api/webhooks/asr/route.ts:2` — `import { loadEnv } from '../../../../../env.js';` (5 levels up to reach `apps/web/env.ts`).
  - `apps/web/src/lib/supabase-server.ts:3` — `import { loadEnv } from '../../env.js';`
  - Lesser version: `apps/web/src/app/auth/callback/route.ts:2` and `apps/web/src/app/auth/signout/route.ts:2` — `'../../../lib/supabase-server.js'` (could be `@/lib/supabase-server`).
- CLAUDE.md §4: "Imports: absolute via `@/` alias inside an app or package; relative across nothing."
- Root cause: `apps/web/env.ts` lives at the app root (outside `src/`) so the configured `@/*` → `./src/*` alias cannot reach it. Two fixes possible: (a) move `env.ts` into `src/lib/env.ts` and update the `tsconfig.json` `include` list; or (b) add a second alias.
- Confidence: **90** (rule is unambiguous; the in-`src/` ones are pure style; the out-of-`src/` deep climbs are concretely fragile if files move).

### F4 — Login client component bypasses the Zod env validator and silently degrades on missing config

- Severity: **LOW**
- Pass: P2 (CLAUDE.md compliance — Zod-at-every-external-input rule, §2 Stack)
- File: `apps/web/src/app/login/page.tsx:7–8`
  ```ts
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  ```
- Finding: The web app validates env via `loadEnv()` in `apps/web/env.ts`, which throws on missing keys. The login page bypasses that path with empty-string fallbacks, meaning a Cloudflare Pages deploy without `NEXT_PUBLIC_SUPABASE_URL` builds green and then fails on the first `signInWithOtp` call instead of at boot. CLAUDE.md §2: "Zod at every API boundary and every external input … `.env` is also validated via Zod at boot."
- Caveat: this is a `'use client'` module, so it cannot import the server validator directly. Options: drop the `?? ''` fallback so the build/runtime fails loudly, pass values down from a validated server component, or read them via `loadEnv()` in a server file and serialise into the client.
- Confidence: **85**

### F5 — `_scaffold_health` SELECT policy is broader than SPEC.md describes

- Severity: **NIT**
- Pass: P1 (SPEC compliance)
- File: `supabase/migrations/20260505191054_scaffold.sql:18–21`
  ```sql
  create policy "anon can read scaffold health"
    on public._scaffold_health
    for select
    to anon, authenticated
    using (true);
  ```
- SPEC.md Stage 5 pass-1 describes the only business policy as "an anon SELECT on `_scaffold_health` (the homepage's boot probe)". The migration also grants `authenticated`. Functional impact: zero — both roles need read for the homepage probe to work whether the user is signed in or not — but the spec and the implementation now disagree on which roles are intended. Either tighten the policy to `to anon` only, or amend the spec line. The CLAUDE.md "SPEC.md wins for architecture" rule applies; the spec line is the cheaper change.
- Confidence: **80**

## Questions for human

### Q1 — Format-check trap on the audit-scaffold files

Currently `pnpm format:check` fails because `.claude/skills/*.md`, `docs/audits/_known-non-issues.md`, and `docs/workflows/build-cycle.md` are unformatted. They are untracked at HEAD and therefore out of this audit's diff scope. As soon as they are committed (the audit-scaffold rollout intends this), CI breaks on the format step.
- Evidence: `pnpm format:check` output above; `git status -s` lists `.claude/`, `docs/audits/`, `docs/workflows/` as untracked.
- Why it needs you: the fix is one-line — either `pnpm format:write` on those files before committing, or extend `.prettierignore` to skip skill `.md` files. Both are reasonable; SPEC.md/CLAUDE.md don't take a position.

### Q2 — End-to-end production build of `apps/web` for Cloudflare Pages is unverified

`apps/web/next.config.mjs` has a webpack `extensionAlias` workaround so that `verbatimModuleSyntax: true` + `moduleResolution: "bundler"` + the `.js` import suffix convention all play together. CI runs typecheck, lint, and tests, but not `pnpm -F web pages:build`. There is no green-build evidence that `@cloudflare/next-on-pages` consumes the resulting `.next` output successfully.
- Evidence: `.github/workflows/ci.yml` runs only typecheck/lint/test/format; `apps/web/package.json` defines `pages:build` but no test or CI step exercises it; `transpilePackages: ['@duly-noted/db', '@duly-noted/shared']` plus the webpack hack is a known-fragile combination.
- Why it needs you: the recent five "render change" commits suggest Render-side iteration but say nothing about Cloudflare Pages. If the first deploy of `apps/web` to Cloudflare Pages has not yet succeeded, this is a real risk; if it has, the CI gap is acceptable for now and worth a note in `SPEC.md`.

### Q3 — Webhook test relies on module-cache stickiness of `loadEnv`

`apps/web/src/app/webhook.test.ts` mutates `process.env` in `beforeEach` and dynamically imports `./api/webhooks/asr/route.js`. `apps/web/env.ts` caches the parsed env in module scope (`let cached`). Both tests happen to seed the same secret (`'shhh'`), so the cache returns a value compatible with both assertions. If a future test seeds a different `ASR_WEBHOOK_SECRET`, the cached env from the first test wins silently.
- Evidence: `apps/web/env.ts:12–19` shows the cache; `apps/web/src/app/webhook.test.ts:6–10` shows the env seed; `vi.resetModules` is not called between tests.
- Why it needs you: design choice. Options include exporting a `_resetEnvCacheForTests()`, switching to dependency-injection of env, or accepting the constraint and documenting "tests seed a single env per file."

### Q4 — Pass-2 grants for the rest of the schema

The follow-up migration `20260505220316_grant_scaffold_health_select.sql` exists because table-level GRANTs were missing on `_scaffold_health` despite RLS allowing the read. The same will be true for `publications`, `towns`, `boards`, `meetings`, `memberships` once pass-2 RLS policies land — the policies alone won't grant API visibility. Is there a checklist for pass-2 to remember GRANTs alongside policies?
- Evidence: `supabase/migrations/20260505220316_grant_scaffold_health_select.sql:1–9` (the comment explicitly notes the manual fix); SPEC.md Stage 5 "Grants" paragraph mentions only the scaffold table.
- Why it needs you: this is procedural memory, not code.

### Q5 — Worker dev/start scripts assume a `tsx` and `tsc` workflow that Render won't autoinstall

`apps/worker/package.json` and `apps/worker-cron/package.json` declare `dev` (`tsx watch`) and `build`/`start` (`tsc` then `node dist/index.js`), but neither workspace lists `tsx` or `typescript` as a dependency. Both come from the workspace root `devDependencies`. Render's build phase runs `corepack enable && pnpm install --frozen-lockfile && pnpm -F worker build` — this will succeed because pnpm hoists root devDependencies, but it depends on `--frozen-lockfile` on a workspace-aware pnpm. If a future Render-side change ever uses `--prod` or strips devDependencies, the build fails.
- Evidence: `apps/worker/package.json`, `apps/worker-cron/package.json`, `package.json` (root) and `render.yaml`.
- Why it needs you: design choice — keep the deps at the root (current state, lean) versus duplicate `tsx`/`typescript` into each worker (more redundant, more isolated). No SPEC line locks this in either direction.

## Reopen candidates

None. `_known-non-issues.md` has no entries.

## What NOT to fix (this audit)

- **Performance indexes on FK columns and `meetings.status`** — explicitly deferred. SPEC.md Stage 5 pass-1 "Indexes" paragraph: "Performance-tuning indexes (status filtering, date ordering, search) arrive in pass 2."
- **`packages/db/src/types.ts` placeholder + TODO** — explicitly deferred. SPEC.md Stage 5 pass-1 "Identity" / file's own TODO comment, regen after Slice 2 once the live project is linked.
- **`render.yaml` `# TODO(stage-2): production schedule TBD`** — explicitly deferred per SPEC.md "Open items inherited by later stages: Stage 2: ASR vendor selection determines …".
- **No business RLS policies on the five Stage-5 tables** — explicitly default-deny per SPEC.md Stage 5 pass-1.
- **No `unique` on `meetings.youtube_id`** — pass-2 territory; SPEC.md does not require it for pass 1.
- **Worker has no actual queue-poll loop, cron has no YouTube call** — Slice 2/3 territory; SPEC.md Stage 1 explicitly contains this scope.
- **The three "another render change" commits (1d86bd9, fbc03eb, 83391b0)** — modified `render.yaml` only (no source/schema/test impact); not material to this audit.

## Suggested fix order

By dependency, not severity:

1. **F1** — add `*.tsbuildinfo` to `.gitignore`, `git rm --cached apps/web/tsconfig.tsbuildinfo`. Independent. ~2 min.
2. **F2** — one-paragraph fix in `SPEC.md`. Independent. ~5 min. Decide whether to also pre-load pass-2 with an explicit "FK columns require manual indexing" note.
3. **F5** — one-line policy or one-line spec change. Independent. ~5 min.
4. **F3** — relocate `apps/web/env.ts` to `apps/web/src/lib/env.ts`, update `tsconfig.json` `include`, switch the four import sites to `@/lib/env`. Touches `middleware.ts`, `tsconfig.json`, `env.ts`, `webhook.test.ts`, `supabase-server.ts`, the two consumers. ~15 min.
5. **F4** — best done after F3, because the cleanest fix is to make the login page consume validated env from a server component or a shared accessor, which is easier once `env.ts` is colocated under `src/lib/`. ~15 min.

## Summary

| Severity | Count |
| --- | --- |
| BLOCKER | 0 |
| HIGH | 1 (F1) |
| MEDIUM | 1 (F2) |
| LOW | 2 (F3, F4) |
| NIT | 1 (F5) |
| **Total findings** | **5** |
| **Questions for human** | **5** |
| **Reopen candidates** | **0** |

Mechanical passes: lint, typecheck, tests all green. Format check fails on out-of-scope untracked files only — see Q1.
