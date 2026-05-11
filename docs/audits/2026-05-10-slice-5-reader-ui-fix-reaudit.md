---
date: 2026-05-10
scope: Slice 5 reader-UI fix application (verification of 2026-05-10-slice-5-reader-ui-fix-brief.md)
commit_range: 650effc..8241e7e+uncommitted
head_sha: 8241e7e33e19ef7d16bbc87cfd4e161305d0024f
prior_audit: 2026-05-10-slice-5-reader-ui.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 1
questions_count: 1
findings_dropped_by_verification: 1
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 5 reader-UI fix re-audit

Verification pass over the fix-brief application from
`2026-05-10-slice-5-reader-ui-fix-brief.md`. Scope is the work
since the slice-5 audit landed: two committed commits
(`5b35d44` NI-018/NI-019 promotion, `8241e7e` audit-skills
update) plus the uncommitted fix-brief application
(F1/F2/F3/F6/F11 + workflow/SPEC amendments + registry edits).

## Mechanical pass results

| Pass | Result | Notes |
| ---- | ------ | ----- |
| `pnpm -r typecheck` | PASS | All 5 workspaces clean |
| `pnpm -r test` | PASS | 129 tests passed, 2 skipped (web 37, db 2 unit + 2 RLS skipped, shared 50, worker 17, worker-cron 23) — same posture as prior audit |
| `pnpm -r lint` | PASS | All 5 workspaces clean |
| `pnpm format:check` | PASS | F6 fix landed cleanly — `apps/web/CLAUDE.md` now Prettier-clean |
| `git diff --shortstat 650effc..HEAD` | 4 files, 536/-336 | Skill files + registry append |
| `git diff --shortstat` (uncommitted) | 8 files, 33/-30 | Fix-brief application + new migration (untracked, +20 LOC) |
| TODO/FIXME/XXX grep | clean | Only pre-existing TODO in `supabase/functions/asr-webhook/index.ts:10` |
| `console.*` grep (non-worker) | clean | none |
| Hardcoded URLs | clean | none in scope |
| Secret-shaped strings | clean | none in scope |
| `user-event`/`userEvent` grep | clean | Source-side clean post-F11; only `.next` build artifacts retain the symbol (gitignored) |
| `createServerComponentClient` grep | clean | Phantom symbol fully purged from doc surface; only audit-history files mention it |
| File size | clean | No new file > 500 LOC; new migration is 20 LOC |
| Test ratio | n/a | No new source files; F1 modifies existing surface, F2 is a migration |

Fix-brief items verified applied:

- **F1** (segment count) — `apps/web/src/app/[publication]/[town]/[board]/page.tsx:21` adds `segments(count)` to the select; `:53` renders `m.segments[0]?.count ?? 0 segments`. Pluralization is unconditional (`1 segments`); not a fix-brief defect — the brief specified the form verbatim.
- **F2** (drop service_role policies) — new migration `supabase/migrations/20260510223016_slice_5_drop_service_role_policies.sql` drops the 4 audit-symmetry policies. Policy names byte-for-byte match the originating CREATE statements at `20260510191756_slice_5_reader_ui_rls.sql:20,23,26,29`. Timestamp ordering correct. Backwards-compatible with the deployed worker (service_role bypasses RLS regardless).
- **F3** (createServerClient symbol) — `SPEC.md:585` and `apps/web/CLAUDE.md:12` both updated. Symbol is a real export of `@supabase/ssr@0.10.2` and is the one already used by `packages/db/src/server-client.ts`.
- **F6** (Prettier-corruption defuse) — `apps/web/CLAUDE.md:79` now reads `React state and URL state are sufficient…` (the `+` glyph that Prettier was normalizing is gone). `pnpm format:check` is green.
- **F11** (drop `@testing-library/user-event`) — removed from `apps/web/package.json:29` and from `pnpm-lock.yaml`. Zero source-side references repo-wide. Sister testing-library packages (`jest-dom`, `react`) still consumed by `vitest.setup.ts` and `youtube-embed.test.tsx`.
- **CLAUDE.md §5 PR gate** — line 118 now ends `… && pnpm format:check` (no `-r`, which is the working form; root is the only package defining the script).
- **B7 backlog entry** (Q1 absorbed) — `SPEC.md:644` added under §Backlog with the correct sequential ID (B1, B2, B4, B5, B6 exist; B3 is a Stage 8 inline label, not a backlog entry; B7 is the next free).
- **`docs/workflows/build-cycle.md` rewrite** — "How updates flow back to the repo" subsection rewritten to default by edit size, not file type.
- **NI-008 promotion** — `Status: Promoted (see SPEC.md §Stage 5 schema deltas, §Stage 8)` applied per registry promotion convention.
- **NI-014 revisit-trigger update** — only the `Revisit when:` line was rewritten; reasoning prose unchanged (compliant with the registry's no-edits-to-past-reasoning rule).
- **NI-018, NI-019** — appended via promote-to-non-issue skill, citing `2026-05-10-slice-5-reader-ui.md — F-NIT-1` / `F-NIT-2`.

## Findings

### F1 — `pnpm -r format:check` in audit-skills SOPs would fail; the `-r` flag is wrong

- **Severity:** LOW
- **Source:** P6
- **File:line:**
  - `.claude/skills/code-audit/SKILL.md:72`
  - `.claude/skills/apply-audit-fixes/SKILL.md:157`
  - `.claude/skills/apply-audit-fixes/SKILL.md:105` (also bakes `pnpm -r format:check` into an example fix-brief listing string)
- **Finding:** Both audit-skills SOPs prescribe `pnpm -r format:check` as the verification command and cite "per root CLAUDE.md §5 PR gate." But root CLAUDE.md §5 (line 118) uses `pnpm format:check` (no `-r`), because `format:check` is defined only in the root `package.json` (`prettier --check .`); no workspace defines it. `pnpm -r` excludes the root project, so `pnpm -r format:check` finds zero scripts and errors with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. Anyone running the skill's verification step verbatim hits the error.
- **Evidence:**
  ```
  $ grep "format:check" package.json apps/*/package.json packages/*/package.json
  package.json:    "format:check": "prettier --check ."
  (no other matches)

  $ grep -n "format:check" .claude/skills/code-audit/SKILL.md .claude/skills/apply-audit-fixes/SKILL.md
  .claude/skills/code-audit/SKILL.md:72:  `pnpm -r format:check` (per root CLAUDE.md §5 PR gate)
  .claude/skills/apply-audit-fixes/SKILL.md:105:  [6] Root CLAUDE.md §5 PR gate — add pnpm -r format:check
  .claude/skills/apply-audit-fixes/SKILL.md:157:- `pnpm -r format:check` (per root CLAUDE.md §5 PR gate)

  $ grep -n "format:check" CLAUDE.md
  CLAUDE.md:118:- Before opening a PR: `pnpm -r typecheck && pnpm -r test && pnpm -r lint && pnpm format:check` must pass locally.
  ```
  The citation phrase "per root CLAUDE.md §5 PR gate" is also factually wrong inside the skills: §5 PR gate uses the non-`-r` form, and the skills' added `-r` does not match what they cite. (This audit's own Step 3 ran `pnpm exec prettier --check .` and so dodged the bug — but a literal reading of the skill would have errored.)
- **Verification reasoning:** Confirmed by direct file reads. Root is the only definition site; `pnpm -r` excludes root; the cited authority (root CLAUDE.md §5) uses the working form. Verified true, confidence 98.
- **Confidence:** 98
- **Fix shape:** drop `-r` at all three call sites in the skill files (changes `pnpm -r format:check` → `pnpm format:check`). Verify with `pnpm format:check` after the edit.

## Questions for human

### Q1 — F2 drop migration omits `IF EXISTS`; sibling slice-5 migration uses it

- **Question:** The new migration `supabase/migrations/20260510223016_slice_5_drop_service_role_policies.sql:12-19` drops 4 policies with bare `drop policy "name" on public.<table>`. The sibling migration created in the same slice — `20260510191756_slice_5_reader_ui_rls.sql:12-15` — uses `drop policy if exists "..." on public.<table>` when dropping its own pass-1 policies, with an inline comment justifying the choice: *"Policy name strings match the originals byte-for-byte. IF EXISTS guards against drift if a manual SQL Editor edit ever renamed a policy in the cloud."* Both migrations drop policies created earlier in the migration history. The fix-brief F2 instruction at `docs/audits/2026-05-10-slice-5-reader-ui-fix-brief.md:52-61` authors the bare-drop form verbatim, so the implementation faithfully matches the brief — but the inconsistency with the sibling is observable. Is the bare-drop form the durable project convention for drop-policy operations (and the sibling's `IF EXISTS` is a one-off opt-in), or should both migrations use the same defensive form? NI-003 covers CREATE-side bare DDL but doesn't speak to DROP guards.
- **Evidence:**
  ```sql
  -- 20260510191756_slice_5_reader_ui_rls.sql:9-15
  -- Policy name strings match the originals byte-for-byte. IF EXISTS
  -- guards against drift if a manual SQL Editor edit ever renamed a
  -- policy in the cloud.
  drop policy if exists "authenticated reads published meetings"
    on public.meetings;
  drop policy if exists "authenticated read segments of published meetings"
    on public.segments;
  ```
  vs.
  ```sql
  -- 20260510223016_slice_5_drop_service_role_policies.sql:12-19
  drop policy "service_role full access on publications"
    on public.publications;
  drop policy "service_role full access on towns"
    on public.towns;
  drop policy "service_role full access on boards"
    on public.boards;
  drop policy "service_role full access on memberships"
    on public.memberships;
  ```
- **Why this needs human input:** Three signals point in different directions. (1) Fix-brief authored bare-drop verbatim → migration matches the user-approved instruction. (2) NI-003 rationale (Supabase CLI transactional apply, no partial-apply) is symmetric across CREATE/DROP and supports bare DDL. (3) The sibling migration's inline comment explicitly cites a real-world drift scenario (manual SQL Editor renames in the cloud) that applies identically to the four policies the new migration drops. The decision is: do we treat the sibling's `IF EXISTS` as a per-migration opt-in defense for an exceptional case (the slice-5 RLS migration was the first one in this codebase to drop policies created in a different prior migration — making cloud drift a concrete worry), or as a project-wide precedent that the new migration should also match? Either answer is defensible. If "opt-in per migration": no fix needed. If "precedent to match": amend the migration to add `if exists` to the four drops, and consider promoting the choice to a one-line note in the root CLAUDE.md DDL conventions. The base condition (4 policies created 31 minutes earlier in the same slice, CI-applied to a single-tenant project) makes the drift risk small either way.
- **Verification confidence:** 55 (verified=false; verifier flagged `should_be_question_not_finding: true` because the inconsistency is real but the case for it being a defect is undermined by the fix-brief endorsement and NI-003's symmetric rationale)

## Reopen candidates

None. NI-014's revisit-trigger update was the last living follow-up from the slice-5 audit, and it now correctly points at the search slice (Slice 6) per the registry edit in this re-audit's scope.

## What NOT to fix (this audit)

- **F1 segment-count pluralization** — `m.segments[0]?.count ?? 0 segments` renders `1 segments` for the singular case. Cosmetic; fix-brief specified the form verbatim. Not a defect against the brief.
- **F1 hand-rolled type assertion** for the relational select (`as Array<{...}>`) — same pattern accepted as "not worth refactoring against generated types now" in the source audit's "What NOT to fix" list. Carries forward.
- **F2 bare-drop without `IF EXISTS`** — routed to Q1 above; verifier disproved as a defect, recommended Question routing.
- **Service_role implicit GRANT history on `memberships`** — the new migration drops a service_role policy on memberships, and no prior migration explicitly grants service_role anything on memberships. Supabase's project bootstrap grants `ALL ON ALL TABLES IN SCHEMA public TO service_role` as a platform default, and no current code path queries memberships from service_role. Per root CLAUDE.md §6 ("every direct table query from a service-role surface needs a GRANT"), the rule has no offending call site in the current codebase. Not a defect.

## Suggested fix order

1. **F1** — fix the `-r` typo in three sites (`code-audit/SKILL.md:72`, `apply-audit-fixes/SKILL.md:157`, `apply-audit-fixes/SKILL.md:105`). Mechanical edit.
2. **Q1** — answer the IF EXISTS question (no action if "opt-in per migration"; one-migration amendment if "precedent to match").

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 |
| NIT | 0 |
| **Total findings** | **1** |
| Questions | 1 |
| Reopen candidates | 0 |
| Findings dropped by verification | 1 (sub-80 confidence → routed to Q1) |
| Findings suppressed by registry | 0 |

Mechanical posture: typecheck / test / lint / format:check all green. The fix-brief application is faithful to the brief in every traced item. The one durable finding is a tool-config defect introduced by the same commit that updated the audit skills — the verification command those skills prescribe would itself fail. Closes the slice-5 audit cycle modulo Q1 + F1.
