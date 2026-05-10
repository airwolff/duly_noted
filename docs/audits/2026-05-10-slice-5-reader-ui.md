---
date: 2026-05-10
scope: Slice 5 reader UI + membership-aware RLS, ADR 0020, slice-5 SMTP doc fill, slice-4 reaudit fix-application
commit_range: 9904111..7f07ef4
head_sha: 7f07ef44b44be63ab47662a5a8e47cdf164c3ae1
prior_audit: 2026-05-10-slice-4-summarization-fix-reaudit.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 7
questions_count: 1
findings_dropped_by_verification: 2
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 5 reader UI

## Mechanical pass results

| Pass               | Result | Notes |
| ------------------ | ------ | ----- |
| `pnpm -r typecheck` | PASS  | All 5 workspaces clean |
| `pnpm -r test`      | PASS  | 129 tests passed (web 37, db 2 unit + 2 RLS skipped, shared 50, worker 17, worker-cron 23) |
| `pnpm -r lint`      | PASS  | All 5 workspaces clean |
| `pnpm format:check` | **FAIL** | `apps/web/CLAUDE.md` — see F6 |
| `git diff --shortstat` | — | 36 files changed, 2755 insertions, 55 deletions |
| TODO/FIXME/XXX grep | clean | none in source files in scope |
| `console.*` grep    | clean | none in non-worker source files |
| Hardcoded URLs      | clean | only SPEC.md examples + youtube.com in components (intentional) |
| Test ratio          | good  | 9 new test files / 12 new source files in apps/web |
| File size           | clean | no new file > 500 LOC; largest in scope is `youtube-embed.tsx` at 98 LOC |

## Findings

### F1 — Meeting list rows omit segment count

- **Severity:** MEDIUM
- **Source:** P1
- **File:line:** `apps/web/src/app/[publication]/[town]/[board]/page.tsx:21-24`, `:39-51`
- **Finding:** SPEC §Stage 8 specifies the meeting list row shape; implementation omits the segment count.
- **Evidence:**
  ```
  SPEC.md:573 — "Meeting list — reads `meetings WHERE board_id = ? AND status =
                  'published'`, ordered `meeting_date DESC`. Each row shows
                  date, title, segment count."
  ```
  ```ts
  // apps/web/src/app/[publication]/[town]/[board]/page.tsx:21-24
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, title, meeting_date')
    .eq('board_id', chain.board.id)
    ...
  ```
  No `segments(count)` aggregate in the select, no count in the JSX render.
- **Verification reasoning:** SPEC quote verbatim, implementation gap real, no
  registry suppression. The page shipped with the slice that SPEC §Stage 8
  describes; not a deferral.
- **Confidence:** 92

### F2 — Slice 5 migration adds `service_role FOR ALL` policies without matching GRANTs

- **Severity:** LOW
- **Source:** P1 + P5 (merged: scope creep + hard-rule violation manifest at the same lines)
- **File:line:** `supabase/migrations/20260510191756_slice_5_reader_ui_rls.sql:20-31`
- **Finding:** The migration creates four `service_role full access` policies (`for all to service_role`) on `publications`, `towns`, `boards`, `memberships` but does NOT pair them with matching `GRANT ALL` (or `GRANT INSERT/UPDATE/DELETE`) statements. CLAUDE.md §6 hard rule: *"Every RLS policy must be paired with the corresponding table-level GRANT (`SELECT`/`INSERT`/`UPDATE`/`DELETE` for `anon`, `authenticated`, or `service_role` as appropriate) in the same migration."* Slice 2 set the precedent — `service_role full access on meetings` (FOR ALL) was paired with `grant all on public.meetings to service_role` in the same migration. Memberships has no `service_role` grants anywhere in the migration history (not even SELECT). Functionally inert at v1 (worker reads only `boards`, which has SELECT from Slice 2 followup; `service_role` bypasses RLS regardless), but a literal hard-rule violation. Also scope creep against SPEC §Slice 5 schema deltas, which enumerates only the `authenticated` policies and matching grants.
- **Evidence:**
  ```sql
  -- 20260510191756_slice_5_reader_ui_rls.sql:20-31
  create policy "service_role full access on publications" ...
  create policy "service_role full access on towns" ...
  create policy "service_role full access on boards" ...
  create policy "service_role full access on memberships" ...
  -- (no `grant ... to service_role` anywhere in this file; line 96-99 only
  --  grants SELECT to authenticated)
  ```
  Slice 2 precedent (`20260507165044_slice_2_ingestion_schema.sql:80-93`):
  pairs the `meetings` FOR ALL policy with `grant all on public.meetings to
  service_role` in the same migration.
- **Verification reasoning:** All five claims confirmed against source files.
  Hard-rule wording quoted verbatim. Registry has no entry suppressing
  this. The scope-creep angle reinforces the finding: SPEC §Slice 5
  enumerates only `authenticated` policies+grants, so the `service_role`
  policies are also out-of-scope additions whose own justification ("audit
  symmetry — not strictly required") acknowledges the policies are
  decorative.
- **Confidence:** 90

### F3 — `createServerComponentClient` reference is a phantom symbol in `@supabase/ssr`

- **Severity:** LOW
- **Source:** P1 + P2 + P6 (P6 cleared the implementation; P1/P2 surfaced the doc drift)
- **File:line:** `SPEC.md:585`, `apps/web/CLAUDE.md:11-13`
- **Finding:** Both convention docs reference `createServerComponentClient` from `@supabase/ssr`. That named export does not exist in `@supabase/ssr@0.10.2` (the installed version exports `createBrowserClient`, `createServerClient`, types, and utils only). `createServerComponentClient` is the legacy export from the deprecated `@supabase/auth-helpers-nextjs` package. The actual implementation correctly uses `createServerClient` — wrapped via the `@duly-noted/db` factory in `packages/db/src/server-client.ts:9`. The convention docs ask future readers to reach for a non-existent symbol.
- **Evidence:**
  ```
  SPEC.md:585 — "Server components read via `createServerComponentClient`
                  from `@supabase/ssr`"
  apps/web/CLAUDE.md:10-13 — "Data fetching happens in server components via
                              the Supabase SSR helper (`createServerComponentClient`
                              from `@supabase/ssr`)."
  ```
  vs.
  ```ts
  // apps/web/src/lib/supabase-server.ts:2
  import { createServerClient } from '@duly-noted/db';
  // packages/db/src/server-client.ts (verified): wraps @supabase/ssr's createServerClient
  ```
  Verified `@supabase/ssr@0.10.2` exports — no `createServerComponentClient`.
- **Verification reasoning:** Implementation correct; doc text drifts. Doc-only fix.
- **Confidence:** 97

### F6 — Prettier autofix on `apps/web/CLAUDE.md` corrupts content

- **Severity:** MEDIUM (auto-fix is destructive on semantics, not just style)
- **Source:** P2 (mechanical pass + verification)
- **File:line:** `apps/web/CLAUDE.md:77-79`
- **Finding:** `pnpm format:check` fails on this file. Running the documented `pnpm format` (Prettier write) would rewrite line 79 from `+ URL state are sufficient` to `- URL state are sufficient`, inverting the meaning of the sentence from "React state plus URL state" to "React state minus URL state". Prettier is interpreting the indented `+` as a sibling list-bullet under the parent `-` list item and normalizing the bullet style. Either reword the prose (e.g., "React state and URL state" or "React state plus URL state") or add a `<!-- prettier-ignore -->` directive on the bullet.
- **Evidence:**
  ```
  apps/web/CLAUDE.md:77-79
  - Client-side state management libraries (Redux, Zustand). React state
    + URL state are sufficient at the v1 page surface.
  ```
  ```
  $ pnpm exec prettier --check apps/web/CLAUDE.md
  [warn] apps/web/CLAUDE.md
  [warn] Code style issues found in the above file. Run Prettier with --write to fix.
  ```
  Diff Prettier would write:
  ```
  -  + URL state are sufficient at the v1 page surface.
  +  - URL state are sufficient at the v1 page surface.
  ```
- **Verification reasoning:** Prettier really does change `+` → `-`,
  inverting the sentence's meaning. Note: root CLAUDE.md §5 PR-gate
  wording lists only `pnpm -r typecheck && pnpm -r test && pnpm -r lint`
  (no `format:check`), so CI doesn't block on this directly — but a
  developer following the documented `pnpm format` command silently
  corrupts content. MEDIUM severity is correct.
- **Confidence:** 97

### F11 — `@testing-library/user-event` declared but never imported

- **Severity:** LOW
- **Source:** P4
- **File:line:** `apps/web/package.json:29`
- **Finding:** Added as a `devDependency` in commit `4836555` (the vitest jsdom + testing-library setup). Zero import sites across `apps/web/src`, `apps/web/middleware.test.ts`, `apps/web/vitest.setup.ts`, or any other file in the repo. The other testing-library packages added alongside it (`jest-dom`, `react`) are referenced from `vitest.setup.ts` and `youtube-embed.test.tsx`; `user-event` is not.
- **Evidence:**
  ```
  $ git diff 9904111..HEAD -- apps/web/package.json
  +    "@testing-library/user-event": "^14.6.1",
  $ grep -rn "user-event\|userEvent" apps/web/src apps/web/*.ts
  (no matches)
  ```
- **Verification reasoning:** Confirmed. No implicit pull-in via the test setup file.
- **Confidence:** 97

### F-NIT-1 — `resolveBoard` and `PubRef`/`TownRef`/`BoardRef` exported with no external consumer

- **Severity:** NIT
- **Source:** P4 (not separately verified — initial confidence carried forward)
- **File:line:** `apps/web/src/lib/resolvers.ts:6-20`, `:41-53`
- **Finding:** `resolveBoard` is exported but only called from `resolveBoardChain` in the same file (line 65). `PubRef`/`TownRef`/`BoardRef` interfaces are exported but used only as parameter/return types of internal functions. `resolvers.test.ts` imports `resolvePublication`, `resolveTown`, `resolveBoardChain` but not `resolveBoard`; pages use the inferred chain type from `resolveBoardChain`. Could be made non-exported or kept as public surface for future consumers (e.g., a board page that doesn't go through the full chain).
- **Evidence:**
  ```
  $ grep -rn "resolveBoard\b" apps/web/src packages
  (matches only inside resolvers.ts)
  $ grep -rn "BoardRef\|TownRef\|PubRef" apps/web/src packages
  (matches only inside resolvers.ts)
  ```
- **Confidence:** 75 (initial, not separately verified per skill perf note for NITs)

### F-NIT-2 — `SortableSegment` interface exported with no external consumer

- **Severity:** NIT
- **Source:** P4
- **File:line:** `apps/web/src/lib/sort-segments.ts:1-4`
- **Finding:** Exported interface used only as the generic constraint of `sortSegments` in the same file. `sort-segments.test.ts` does not import the type.
- **Evidence:**
  ```
  $ grep -rn "SortableSegment" apps/web
  apps/web/src/lib/sort-segments.ts:1:export interface SortableSegment {
  apps/web/src/lib/sort-segments.ts:11:export function sortSegments<T extends SortableSegment>(...)
  ```
- **Confidence:** 70 (initial, not separately verified)

## Questions for human

### Q1 — RLS integration test scope: starter coverage or gap?

- **Question:** `packages/db/src/rls.test.ts` seeds only publications and memberships and asserts only on those two tables. The other four new policies (`towns`, `boards`, `meetings`, `segments`) are untested. Specifically, the load-bearing membership-aware meetings policy and the recursive segments policy (which gets both its `status='published'` gate and its tenant boundary via RLS recursion through meetings) have no integration coverage. Is this a deliberately-bounded MVP starter (consistent with the commit message scope), or should the test be extended now to seed a town/board/meeting/segment under each publication and assert the full cross-publication isolation?
- **Evidence:** `packages/db/src/rls.test.ts:15-110` — fixtures include only publications + memberships rows; assertions query only `publications` and `memberships`. No other test in the repo exercises RLS on towns/boards/meetings/segments. NI-008 (now closed) noted that v1 single-tenant deployment makes cross-publication runtime exposure structurally bounded — which is the argument for deferring the extension; but the load-bearing policy *shape* is the asset Slice 5 added, and the shape is what tests would lock in.
- **Why this needs human input:** The question is whether to commit test infrastructure for an axis whose runtime exposure is structurally zero at v1, OR to defer until a second publication onboards (which is the exact trigger NI-008's reasoning leveraged for deferring the predicate itself before this slice). Same trade, opposite direction; depends on how much the project values shape-locking vs. lean-test posture.
- **Verification confidence:** 80

## Reopen candidates

### NI-014 — Speculative barrel exports in `packages/shared/segmentation`

- **Status in registry:** Accepted (2026-05-09)
- **Why reopen:** NI-014's reasoning rested on imminent reader-UI consumers ("the reader UI (Slice 5+) needs `MARKER_TYPES` for filter chips and the length constants for client-side truncation"). Slice 5 has now shipped the reader UI, and it consumes nothing from `packages/shared/segmentation/index.ts`:
  - `apps/web/src/components/segment-card.tsx` defines `MARKER_LABEL` locally as a display-string lookup rather than importing `MARKER_TYPES`. (This is not duplication — `MARKER_TYPES` is the value enum, not display strings — but the consumption pathway still didn't materialize.)
  - No reader file imports `TITLE_MAX_LEN`, `DESCRIPTION_MAX_LEN`, `lookupTToken`, or any `Step*Output` type.
  Per NI-014's revisit trigger ("when imminent consumers ship and the actual consumed surface is known"), this is exactly that condition. Worth a re-triage: trim what reader-UI did *not* end up consuming, or add a follow-up note that the search slice (Slice 6) is the real test of these exports.
- **Not raised as a finding** — per NI registry conventions; flagged here for triage.

## What NOT to fix (this audit)

- **Recursive segments policy without inline `m.status = 'published'`** —
  `supabase/migrations/20260510191756_slice_5_reader_ui_rls.sql:81-88`.
  Explicitly endorsed by SPEC.md:509 ("segments inherit both gates")
  and the migration's own comment block. Verification subagent disproved
  this finding (verified=false, conf=80). Intentional, documented design
  coupling; not a defect.
- **Triple-redundant `.eq()` predicate stack** on the meeting page
  (`[meeting]/page.tsx:26-32`). Defense-in-depth on top of RLS;
  harmless. Initial confidence 30 (NIT).
- **Component file naming** (`segment-card.tsx`, `transcript-toggle.tsx`,
  `youtube-embed.tsx` in kebab-case despite root CLAUDE.md §4's
  ambiguous "React components: `PascalCase.tsx`"). Verification
  subagent could not disprove or confirm — root rule is genuinely
  ambiguous and these are the first non-route React components in
  apps/web; the slice establishes precedent rather than violating one.
  If the user wants kebab-case to be the durable convention, root
  CLAUDE.md §4 deserves a one-line clarification.
- **Hand-rolled type cast** on relational select in
  `apps/web/src/app/page.tsx:13-18` — works correctly, low value to
  refactor against generated types now (NIT, conf 35).
- **Header layout grouping** on the meeting page — SPEC §575 lists
  title/meeting_date/board name/town name as header content; the
  implementation has all four on the page but uses a breadcrumb above
  the title rather than colocating. Information present, layout
  differs (NIT, conf 35).

## Suggested fix order

By dependency, not severity alone:

1. **F6** — Prettier corruption risk on `apps/web/CLAUDE.md`.
   Fix first because the failure mode is silent: anyone running
   `pnpm format` corrupts the doc. Reword the bullet (e.g., "React
   state and URL state") or add a `<!-- prettier-ignore -->` directive.
2. **F3** — Doc reference to `createServerComponentClient`. Two
   one-line fixes (SPEC.md and apps/web/CLAUDE.md). Trivial; cluster
   with F6 in a docs commit.
3. **F2** — Migration GRANT pairing. Needs a follow-up migration
   adding the matching `grant all to service_role` on the four tables
   (or, alternatively, dropping the four service_role policies as
   genuinely unnecessary — service_role bypasses RLS regardless, and
   removing them eliminates both the GRANT-pairing rule and the
   misleading-signal cost). Either path is fine; both close the
   finding.
4. **F1** — Add `segments(count)` to the meeting-list query and
   render the count in the row. Single-file change.
5. **F11** — Remove `@testing-library/user-event` from
   `apps/web/package.json` devDependencies (or add a use site if it
   was added in anticipation of imminent interaction tests).
6. **F-NIT-1, F-NIT-2** — Trim exports if not slated for upcoming
   consumers; otherwise keep as public-surface placeholders consistent
   with NI-014's barrel-export reasoning.
7. **Q1** — Decide whether to extend `rls.test.ts` to cover the four
   uncovered policies or defer until a second publication exists.

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0 |
| HIGH     | 0 |
| MEDIUM   | 2 |
| LOW      | 3 |
| NIT      | 2 |
| **Total findings** | **7** |
| Questions | 1 |
| Reopen candidates | 1 (NI-014) |
| Findings dropped by verification | 2 (kebab-case files; segments policy decoupling — both intentional) |
| Findings suppressed by registry | 0 |

Mechanical posture: typecheck/test/lint all green; one Prettier
failure that is itself a finding (F6). RLS migration is correctly
backwards-compatible with the running worker. The membership-aware
policy shape closes NI-008 as SPEC §Slice 5 promised. Reader UI
implements the SPEC §Stage 8 surface modulo F1 (segment count) and
the doc-drift items (F3, F6).
