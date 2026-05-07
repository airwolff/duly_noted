---
date: 2026-05-06
scope: Full pre-slice scaffold — root commit through HEAD (third audit of the same scope)
commit_range: 9d06ba9..940a6f3
head_sha: 940a6f350fb593da4b189ff6f3ad32b7e986753d
prior_audit: 2026-05-06-spine-scaffold-2.md (plus audit-fix-brief landed in commits 0c983fc..940a6f3)
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 1
questions_count: 2
findings_dropped_by_verification: 13
findings_filtered_by_known_non_issues: 1
---

# Audit — Pre-slice scaffold (third pass)

Third audit of the full pre-slice scaffold, run after the audit-fix-brief
(commits `0c983fc..940a6f3`) was applied. Six parallel subagents (P1–P6)
each produced candidate findings; thirteen verification subagents tried
to disprove them. Two prior wont-fix entries (`NI-001..NI-005`) shaped
the suppression list.

## Mechanical pass results

| Check                              | Result | Notes                                                                                                                         |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r typecheck`                | PASS   | All five workspaces clean.                                                                                                    |
| `pnpm -r lint`                     | PASS   | Five workspaces clean (test workspace not listed; tests linted via `apps/web` etc.).                                          |
| `pnpm -r test`                     | PASS   | 8 tests across 5 files (web 2, db 2, shared 2, worker 1, worker-cron 1).                                                      |
| `pnpm format:check`                | PASS   | Clean — `.prettierignore` covers `docs/audits/`, `docs/workflows/`, `.claude/skills/`.                                        |
| `git diff --shortstat 9d06ba9..HEAD` | n/a  | 67 files changed, 3006 insertions, 3 deletions.                                                                               |
| TODO/FIXME/XXX                     | 1     | `packages/db/src/types.ts:1` — regenerate after Slice 2 (intentional).                                                        |
| `console.*` in non-worker code     | 0     | Worker/worker-cron logs (allowed); none in `apps/web` or `packages/`.                                                         |
| Hardcoded URLs                     | 0     | None outside tests / `.env.example`.                                                                                          |
| Secret-shaped strings              | 0     | None.                                                                                                                         |
| New files > 500 LOC                | 0     | Largest is `docs/audits/2026-05-06-spine-scaffold-2.md` at 262 lines.                                                         |
| Source vs test files               | 23 / 5 | Reasonable for a scaffold pass.                                                                                              |
| Node engine warning                | yes   | `pnpm` warns local Node v22 vs `engines.node >= 24`. Local-env only; CI reads `.nvmrc` (24). Not raised as a finding.         |

## Findings

### F1 (LOW) — `pre-slice-scaffold-spec.md` is orphaned at the repo root

- Severity: LOW
- Source: P4
- File:line: `pre-slice-scaffold-spec.md:1`
- Finding: A 14,995-byte markdown file at the repo root, added in the
  bootstrap commit `9d06ba9`, has no live reference anywhere in the
  codebase. README points to `SPEC.md`, `CLAUDE.md`, and `docs/adr/`;
  `CLAUDE.md` and `SPEC.md` never name it. Its opening line declares
  itself "concrete scaffold targets for the first Claude Code session"
  — a one-shot bootstrap input whose stated function ended when the
  scaffold shipped.
- Evidence:
  ```
  $ grep -rn "pre-slice-scaffold-spec" .
  ./pre-slice-scaffold-spec.md:1:# pre-slice scaffold targets...
  (no other matches)
  ```
  README.md links `SPEC.md`, `CLAUDE.md`, `docs/adr/` only. SPEC.md
  uses the bare phrase "pre-slice scaffold" once at line 119 in prose;
  it does not point at the file.
- Verification reasoning: The "immutable historical record" defense is
  plausible but unsupported — there is no living pointer establishing
  that role, and `git history` already preserves it. New contributors
  will see it adjacent to `SPEC.md`/`CLAUDE.md` and have to guess its
  status. Confidence 85 after verification.
- Confidence: 85

## Questions for human

These items have real signal but failed the 80-confidence floor or
verification flagged them as judgment calls rather than defects. Triage
them; promote to wont-fix or file as work for a future slice.

### Q1 — Three commits on `main` violate Conventional Commits

- Source: P2 (verified true at conf 92, but flagged
  `should_be_question_not_finding`)
- Evidence: Commits `1d86bd9` ("render change"), `fbc03eb`
  ("another render change"), `83391b0` ("another render change again")
  carry no `feat:`/`fix:`/`chore:` prefix. CLAUDE.md §5: "Conventional
  Commits. `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
  Scope optional."
- Why this needs human input: The commits are immutable on `main`.
  Force-pushing to rewrite history is a destructive operation outside
  the audit's mandate, and the diffs are tiny `render.yaml` tweaks
  during initial deploy debugging. The natural disposition is a
  process reminder ("don't direct-push without a Conventional Commits
  prefix"), not code work — promote to `_known-non-issues.md` as a
  process wont-fix, or accept that PR squash-merges from now on render
  this moot.

### Q2 — Migrate workflow runs in parallel with Render auto-deploy, not before it

- Source: P5 (verified true at conf 55, flagged
  `should_be_question_not_finding`)
- Evidence: `.github/workflows/migrate.yml:3-5` triggers on `push:
  branches: [main]`; `render.yaml` services use Render's git
  integration on the same branch. Neither side waits for the other.
  SPEC.md §CI/CD says "Supabase CLI run from a GitHub Action on merge
  to `main`, before the Render auto-deploy completes" — the
  "before…completes" wording is aspirational; nothing enforces it.
- Why this needs human input: At present scaffold scope (worker only
  reads `_scaffold_health`, no schema-dependent business code yet),
  the race is inert — neither side touches a schema the other depends
  on. The risk materializes when Slice 2 lands code that reads new
  columns/tables added in the same merge. The honest call is "fix
  when Slice 2 introduces the first schema-dependent change" — i.e.,
  defer to Slice 2 with a tracking entry, or wire a deploy hook /
  `concurrency:` group / health gate now as a precaution. Both are
  reasonable. SPEC.md amendment may also be appropriate to move
  "before…completes" to "in parallel with, gated by Slice 2 schema
  needs."

## Reopen candidates

None. The five existing wont-fix entries (`NI-001..NI-005`) all remain
sound under this audit's scope. `NI-002` and `NI-003` were
re-considered by P5 (DDL+DML interleave, `gen_random_uuid` without
explicit `pgcrypto`, FK to `auth.users`) and verification dropped each
candidate — the registry's reasoning still holds.

## What NOT to fix (this audit)

Items that are intentional per `SPEC.md` or `CLAUDE.md` and should
NOT be touched, with citation:

- **Default-deny RLS on the five tenant tables** (`publications`,
  `towns`, `boards`, `meetings`, `memberships`). SPEC.md Stage 5
  pass-1: "no business policies exist beyond an anon SELECT on
  `_scaffold_health`. Default-deny applies to everything else until
  pass 2."
- **No FK-side indexes on `meetings.board_id`,
  `memberships.publication_id`, etc.** SPEC.md Stage 5 Indexes
  paragraph: "FK-side indexes for `meetings.board_id`,
  `memberships.publication_id`, and any other referencing columns are
  deferred to pass 2."
- **No `set_updated_at()` BEFORE UPDATE trigger on `meetings`**
  despite the `updated_at` column. SPEC.md Stage 5 pass-1 intro:
  trigger "applied to every table with an `updated_at` column" is
  pass-2 work.
- **No `IF NOT EXISTS` / `OR REPLACE` guards** on scaffold migration
  DDL. NI-003 explicitly accepts this; CLAUDE.md §5 forbids editing
  the migration anyway.
- **Worker/cron Zod schemas mark ASR/LLM/YouTube keys `.optional()`**
  with `# Optional until Slice 2/3` comments. SPEC.md Decision Record
  open items defer the values; the optionality is the documented
  gradual-fill pattern.
- **Sibling-relative dynamic imports in `apps/web/src/app/webhook.test.ts`**
  (`'./api/webhooks/asr/route.js'`). Prior audit Finding 5 explicitly
  enumerated only relative-climb imports as violations of CLAUDE.md
  §4 ("relative across nothing"); sibling-relative `./` was implicitly
  accepted, and `vi.resetModules()` + dynamic `import()` is the
  idiomatic Vitest pattern for forcing fresh module instances.
- **The grants migration's "applied manually via the SQL editor"
  header comment.** The narrative is historically accurate for that
  specific migration; CLAUDE.md §5 forbids editing it; the migration
  ledger is content-hashed so a comment edit also breaks idempotency.
- **TODO in `packages/db/src/types.ts:1`** about regenerating types.
  Full text says "every other table goes through the generated types
  after Slice 2" — coupled to pass-2 schema work, not to "linked
  status."

## Suggested fix order

1. **F1** — Decide whether to remove `pre-slice-scaffold-spec.md`,
   move it to `docs/archive/` (or similar), or add a one-line pointer
   from `README.md` establishing its role. Cheapest path: `git rm`
   and let `git log` remain the historical record.

(Q1 and Q2 are not "fixes" — they need triage decisions, not code
work. Fold the outcomes into `_known-non-issues.md` or future-slice
tracking as appropriate.)

## Summary

| Bucket                                  | Count |
| --------------------------------------- | ----- |
| Findings (post-verification)            | **1** |
| ↳ BLOCKER                               | 0     |
| ↳ HIGH                                  | 0     |
| ↳ MEDIUM                                | 0     |
| ↳ LOW                                   | 1     |
| ↳ NIT                                   | 0     |
| Questions for human                     | 2     |
| Reopen candidates                       | 0     |
| Findings dropped by verification        | 13    |
| Findings filtered by `_known-non-issues.md` | 1 (P5 DDL+DML interleave overlapped NI-002/NI-003) |

The scaffold is in good shape. The audit-fix-brief work landed cleanly
(`@/lib/env.js` consolidation, `tsbuildinfo` ignore, `.prettierignore`,
migrate workflow). Mechanical passes are green. The single LOW
finding is housekeeping, and both questions are triage decisions, not
defects.
