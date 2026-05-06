# Audit-fix brief — duly_noted spine scaffold

**Audit:** `docs/audits/2026-05-06-spine-scaffold-2.md` (multi-agent re-audit;
finding IDs in this brief reference that audit unless otherwise noted).

**Triage decisions:** completed in the duly_noted Claude Project on 2026-05-06.
8 findings + 9 questions walked. Outcomes summarized below.

## Pre-conditions — already done

These steps land before this fix session begins. Confirm they're in the repo
before starting; if any are missing, stop and report.

1. **SPEC.md** — five amendments applied (worker-cron in repo tree; SUPABASE_URL
   row in secrets table; Render bullet rewritten for no-filter; Stage 5 pass-1
   intro expanded with FK-side index/GRANT/trigger items; Indexes paragraph
   corrected on Postgres FK semantics).
2. **CLAUDE.md** — §6 hard rules expanded with the GRANT-pairing rule.
3. **docs/adr/0001-render-for-background-worker.md** — correction note added,
   cost figures corrected (~$8/mo combined Render, ~$34/mo total).
4. **`_known-non-issues.md`** — five wont-fix entries appended via
   `promote-to-non-issue` skill: Q1 (login client `?? ''`), Q3 (scaffold INSERT
   idempotency), Q4 (DDL guards), Q6 (Cloudflare Pages CI build verification),
   Q9 (worker root-hoisted tsx/typescript).

If `_known-non-issues.md` doesn't have these five entries yet, run the
promotion step before this fix session — apply-audit-fixes reads the registry
and will skip suppressed items, but the items aren't suppressed yet if the
promotion didn't run.

## What this session does NOT touch

- **SPEC.md, CLAUDE.md, docs/adr/0001-render-for-background-worker.md.** Already
  amended. Do not edit them again.
- **Any wont-fix item from `_known-non-issues.md`.** The registry is the gate.
- **Anything outside the audit's scope.** Do not opportunistically fix
  unrelated issues noticed along the way.

## Fix list — execute in this order

Order is by dependency, not severity. The doc amendments are pre-applied;
this list is code-only.

### 1. Finding 1 (HIGH) — wire CI migration step

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#finding-1`

**What to do.** Add a job to `.github/workflows/` that runs `supabase db push`
on merge to `main`, before Render's auto-deploy completes. Either extend
`ci.yml` with a job gated to `push: branches: [main]` or create a separate
workflow file (e.g., `.github/workflows/migrate.yml`) — your call, but keep
the PR-time checks (typecheck/lint/test/format) on `pull_request` and the
migration step on `push` to `main` only.

**Required:**
- Job runs on `push` to `main` (not on PRs).
- Uses `supabase/setup-cli` action or equivalent.
- Authenticates via `SUPABASE_ACCESS_TOKEN` repo secret + project ref repo
  secret (or var). Add both as repo secrets in GitHub if they don't exist.
- Runs `supabase link --project-ref $SUPABASE_PROJECT_REF` then
  `supabase db push --linked`.
- Idempotent — re-running on a clean tree is a no-op.

**Verification:**
- Typecheck/lint/test green (these don't touch the workflow but should still pass).
- The workflow file lints (use `actionlint` if available, otherwise eyeball).
- Commit, push to a branch, open a PR — confirm the migration job does NOT
  run on the PR (gating works). Don't merge until the rest of this fix list lands.

**Notes.** Per SPEC.md CI/CD: "Supabase CLI run from a GitHub Action on merge
to `main`, before the Render auto-deploy completes." This finding closes the
spec-vs-reality gap that the grants migration's own header comment named
("These were applied manually via the SQL editor"). Resolves Q4 and partially
mitigates Q8 procedurally — neither needs further action.

---

### 2. Q5 (Path C) — `.prettierignore` additions

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#question-5`

**What to do.** Add three lines to `.prettierignore`:

```
docs/audits/*.md
docs/workflows/*.md
.claude/skills/**/*.md
```

If `.prettierignore` doesn't exist, create it.

**Verification:**
- `pnpm format:check` — should now pass (the four files Audit 2 flagged were
  all in these directories).
- The audit files in `docs/audits/` are not modified.

**Notes.** Closes the recurring format-check trap. Audit files are append-only
historical records; running prettier on them risks accidental edits via
`pnpm format:write`. Doing this fix early in the session means later
verification runs of `pnpm format:check` for other fixes don't false-positive.

---

### 3. Finding 2 (LOW) — gitignore `*.tsbuildinfo`, untrack the cache

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#finding-2`

**What to do.**
1. Add `*.tsbuildinfo` to `.gitignore` (root; same place `dist/`, `.next/`, etc. live).
2. `git rm --cached apps/web/tsconfig.tsbuildinfo` — remove from tracking
   without deleting the local file.

**Verification:**
- `git ls-files | grep tsbuildinfo` returns nothing.
- `pnpm -F web typecheck` regenerates the file locally; `git status` shows
  it as ignored, not as a new untracked file.

**Notes.** Independent of every other finding. ~2 min.

---

### 4. Finding 5b (LOW) — in-`src/` relative imports → `@/` alias

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#finding-5` (sub-case 5b only)

**What to do.** Replace three import lines with the `@/` alias form:

| File | Current | Change to |
|---|---|---|
| `apps/web/src/app/auth/callback/route.ts:2` | `'../../../lib/supabase-server.js'` | `'@/lib/supabase-server.js'` |
| `apps/web/src/app/auth/signout/route.ts:2` | `'../../../lib/supabase-server.js'` | `'@/lib/supabase-server.js'` |
| `apps/web/src/app/page.tsx:1` | `'../lib/supabase-server.js'` | `'@/lib/supabase-server.js'` |

**Verification:**
- `pnpm -F web typecheck` green.
- `pnpm -F web test` green.
- `pnpm -F web lint` green.

**Notes.** Mechanical. Per CLAUDE.md §4: "Imports: absolute via `@/` alias
inside an app or package; relative across nothing." Do this BEFORE Finding 5a
so verification on 5a starts from a clean import surface inside `src/`.

---

### 5. Finding 5a (LOW) — relocate `apps/web/env.ts` into `src/lib/`

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#finding-5` (sub-case 5a only)

**What to do.**
1. `git mv apps/web/env.ts apps/web/src/lib/env.ts`.
2. Update `apps/web/tsconfig.json` `include` if it explicitly listed `env.ts`
   at the app root (verify by reading current `include` first).
3. Update import sites:
   - `apps/web/src/app/api/webhooks/asr/route.ts:2` — change to `'@/lib/env.js'`
   - `apps/web/src/lib/supabase-server.ts:3` — change to `'@/lib/env.js'`
   - `apps/web/middleware.ts` — search for any import of `env` and update to
     `'@/lib/env.js'` (or the appropriate relative path if middleware sits
     outside the alias scope; verify before editing)
   - `apps/web/src/app/webhook.test.ts` — update env import to `'@/lib/env.js'`

Search the whole `apps/web/` tree for any other importers of `env.ts` before
finishing — `grep -r "env.js" apps/web/src apps/web/middleware.ts`. Update
any matches.

**Verification:**
- `pnpm -F web typecheck` green.
- `pnpm -F web test` green (especially `webhook.test.ts`, which imports
  the route handler that imports env).
- `pnpm -F web lint` green.
- `pnpm -F web build` if available — Next.js needs to resolve `@/lib/env`
  from the moved location.

**Notes.** Touches more files than 5b; do it after 5b so verification baseline
is clean. Q7 (next item) lands cleanly after this.

---

### 6. Q7 (Path A) — export `_resetEnvCacheForTests()` from env.ts

**Source:** `docs/audits/2026-05-06-spine-scaffold-2.md#question-7`

**What to do.**
1. In `apps/web/src/lib/env.ts` (the new location after Finding 5a), add a
   test-only export:

   ```ts
   // test-only: clears the module-cached env so tests can seed fresh values
   // in beforeEach without inheriting state from a prior test.
   export function _resetEnvCacheForTests(): void {
     cached = undefined;
   }
   ```

   (Adjust the `cached` variable name if the actual identifier in env.ts
   differs — read the file first to confirm.)

2. In `apps/web/src/app/webhook.test.ts`:
   - Import `_resetEnvCacheForTests` from `'@/lib/env.js'`.
   - Call `_resetEnvCacheForTests()` in `beforeEach`, before the `process.env`
     mutations.
   - Add `vi.resetModules()` in `beforeEach` if the test uses dynamic
     `import('./api/webhooks/asr/route.js')` — the dynamic import bypasses
     the env cache reset on its own, but resetting modules ensures the route
     handler's own module-scope state is fresh too.

**Verification:**
- `pnpm -F web test` green. Both existing tests should still pass with the
  same secret value (`'shhh'`).
- Optionally add a third test that seeds a different `ASR_WEBHOOK_SECRET`
  to confirm the cache reset works end-to-end. Not required for this fix.

**Notes.** Land after Finding 5a so the import is `@/lib/env`, not a relative
climb to the old location. The `_` prefix on the export name signals
"do not call from production code"; the comment makes the intent explicit.

---

## Final check before commit / push

1. `pnpm -r typecheck` — all workspaces green.
2. `pnpm -r test` — all workspaces green.
3. `pnpm -r lint` — all workspaces green.
4. `pnpm format:check` — green (Q5 makes this real).
5. `git status` — only the expected files modified. No tsbuildinfo. No env.ts
   at the old root location. No .claude/, docs/audits/, or docs/workflows/
   files changed (those should not be touched by this session).

## Commit strategy

Commit per finding or per logical group. Suggested commits:

1. `ci: add supabase db push migration step on merge to main` (Finding 1)
2. `chore: ignore claude-authored markdown in prettier` (Q5)
3. `chore: gitignore tsbuildinfo and untrack apps/web cache` (Finding 2)
4. `refactor(web): use @/ alias for in-src imports` (Finding 5b)
5. `refactor(web): relocate env.ts to src/lib/env.ts` (Finding 5a)
6. `test(web): add env cache reset for webhook tests` (Q7)

Or combine 4+5+6 into one `refactor(web): consolidate env imports under @/lib`
if you prefer atomic-feature commits over atomic-finding commits.

## After this session

1. Stop. Do not start the re-audit in the same session — fresh Claude Code
   session is required (cold reviewer is the whole point).
2. Sync the updated repo to the duly_noted Claude Project KB (SPEC.md and
   CLAUDE.md were already synced after amendments; the new audit will sync
   after the re-audit runs).
3. Run the re-audit prompt in a fresh session.
