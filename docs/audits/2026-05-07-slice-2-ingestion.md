---
date: 2026-05-07
scope: Slice 2 — ingestion pipeline (cron discovery + worker yt-dlp/AssemblyAI + asr-webhook Edge Function + schema deltas)
commit_range: 940a6f3..HEAD + uncommitted working tree
head_sha: 98237ad4121a8e6fd52f4379dc0d2b88fc857c5b
prior_audit: 2026-05-06-spine-scaffold-3.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 5
questions_count: 6
findings_dropped_by_verification: 3
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 2 ingestion pipeline

Six parallel subagents (P1–P6) produced 17 candidate findings against the
Slice 2 build (committed range `940a6f3..98237ad` plus the uncommitted
working tree). Three same-root-cause findings collapsed into F1 during
deduplication. Fourteen verification subagents then attempted to disprove
each candidate; three were dropped, six reframed as questions, and five
kept as findings. NI-001..NI-006 informed verification rather than gating
candidates directly.

## Mechanical pass results

| Check                                    | Result | Notes                                                                                                                |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r typecheck`                      | PASS   | All five workspaces clean.                                                                                           |
| `pnpm -r lint`                           | PASS   | Five workspaces clean.                                                                                               |
| `pnpm -r test`                           | PASS   | 35 tests across 4 workspaces with tests (db 2, shared 12, worker 5, worker-cron 16). `apps/web` runs `--passWithNoTests` (zero tests after webhook stub deletion). |
| `pnpm format:check`                      | PASS   | Clean.                                                                                                               |
| `git diff --shortstat 940a6f3..HEAD`     | n/a    | 6 files / 469+ / 416−. Doc-only commits since prior audit.                                                            |
| `git diff --shortstat 940a6f3` (working) | n/a    | 28 tracked files plus the new `.dockerignore`, `apps/worker/Dockerfile`, `apps/worker/src/pipeline/*`, `apps/worker/src/poll-loop.ts`, `apps/worker-cron/src/{discover,youtube}{,.test}.ts`, `packages/shared/src/{asr,webhook-url}{,.test}.ts`, `supabase/functions/asr-webhook/index.ts`, `supabase/migrations/20260507165044_slice_2_ingestion_schema.sql`. 821+ / 548− across the slice. |
| TODO/FIXME/XXX                           | 1      | `supabase/functions/asr-webhook/index.ts:10` — intentional dedupe-when-second-EF marker.                              |
| `console.*` in non-worker code           | 9      | All in `supabase/functions/asr-webhook/index.ts` (Deno Edge Function — server-side). Not raised: Edge Functions are a server-runtime surface, the no-`console` heuristic targets `apps/web` browser code. |
| Hardcoded URLs                           | 9      | youtube.com (1), googleapis.com (2), AssemblyAI (2), GitHub yt-dlp release (2), esm.sh (2). All vendor endpoints; none in apps/web. |
| Secret-shaped strings                    | 0      | None.                                                                                                                |
| New files > 500 LOC                      | 0      | Largest is the new migration at 186 LOC; `packages/db/src/types.ts` grew from 38 to 217 LOC.                         |
| Source vs test files                     | ~13 / 6 | Reasonable for a slice with substantial I/O code that's hard to unit-test (yt-dlp shell-out, Storage upload).        |
| Live applies                             | PASS   | `supabase db reset` applied migrations + seed cleanly; seed re-run was idempotent (0 inserts on second pass); `claim_pending_meeting()` and `auto_promote_for_board()` RPCs verified by hand against synthetic rows. |
| `docker build -f apps/worker/Dockerfile .` | PASS  | 1.04GB image; yt-dlp 2026.03.17 + ffmpeg 5.1.8 + Node 24.15.0 inside; multi-arch yt-dlp asset selection works on arm64 host. |

## Findings

### F1 (MEDIUM) — `meetings.youtube_id` left nullable; SPEC mandates `not null`

- Severity: MEDIUM
- Source: P1 + P3 (three same-root-cause findings collapsed: P1's spec deviation, P3's hierarchy/multi-board angle is split into F2, P3's type-drift NIT, P3's NIT.)
- File:line: `supabase/migrations/20260507165044_slice_2_ingestion_schema.sql:46-48`
- Finding: The migration adds UNIQUE on `meetings.youtube_id` but leaves the
  column nullable. SPEC.md Stage 5 "Slice 2 schema deltas → Meetings table
  additions" says: `youtube_id text not null — promote to unique`. The
  scaffold migration created `youtube_id text` (nullable); this slice was
  the documented window to promote both NOT NULL and UNIQUE. The
  consequence is observable: `apps/worker/src/pipeline/claim.ts:28-29`
  carries a runtime null-throw guard (`if (!row || row.youtube_id === null)`)
  that would be unreachable under a NOT NULL column, and
  `packages/db/src/types.ts` types `youtube_id` as `string | null` on
  every consumer despite the cron always populating it.
- Evidence:
  ```sql
  -- youtube_id was nullable in the scaffold. The cron always populates it; the
  -- worker requires it. Promote to UNIQUE (table is empty before this slice).
  alter table public.meetings
    add constraint meetings_youtube_id_unique unique (youtube_id);
  -- (no `alter column youtube_id set not null`)
  ```
  SPEC.md line 268: `- ` + backtick + `youtube_id text not null` + backtick +
  ` — promote to ` + backtick + `unique` + backtick.
- Verification reasoning: SPEC line is unambiguous; the comment in the
  migration acknowledges the safe migration window ("table is empty before
  this slice") but stops short of applying SET NOT NULL. The defensive
  null-throw and the nullable Database type are corroborating evidence
  that the schema is the source of truth and other surfaces are working
  around it. Confidence 92 after verification.
- Confidence: 92

### F7 (MEDIUM) — `asr-webhook` Edge Function has no GitHub Action deploy step

- Severity: MEDIUM
- Source: P4
- File:line: `supabase/functions/asr-webhook/index.ts:1` (and absence of a
  workflow under `.github/workflows/`)
- Finding: The Edge Function source is in repo, but no CI step calls
  `supabase functions deploy asr-webhook`. SPEC.md §CI/CD line 83 mandates:
  "Supabase Edge Functions: deployed via `supabase functions deploy <name>`
  from a GitHub Action on merge to `main`." `.github/workflows/` contains
  exactly two files — `ci.yml` (typecheck/lint/test/format only) and
  `migrate.yml` (`supabase db push --linked` only). Without a deploy
  workflow, the AssemblyAI callback hits no receiver and the slice's
  end-to-end transition (`transcribing → segmenting`) is unreachable.
- Evidence:
  ```
  $ ls .github/workflows/
  ci.yml  migrate.yml

  $ grep -rn "functions deploy" .github/
  (no matches)
  ```
- Verification reasoning: Confirmed absent in workflows. SPEC line is
  load-bearing: the worker → AssemblyAI → Edge Function → state-advance
  loop documented in Stage 2 cannot complete with the function only in
  repo. Confidence 96.
- Confidence: 96

### F8 (LOW) — `_resetEnvCacheForTests` is now an orphan export

- Severity: LOW
- Source: P4
- File:line: `apps/web/src/lib/env.ts:23`
- Finding: The function was added to support the deleted webhook test;
  with the test gone and `apps/web/` carrying zero test files, no caller
  remains. The export's only documented purpose is "test-only".
- Evidence:
  ```
  $ grep -rn "_resetEnvCacheForTests" apps packages
  apps/web/src/lib/env.ts:23:export function _resetEnvCacheForTests(): void {

  $ find apps/web -name '*.test.*' -o -name '*.spec.*'
  (no matches)
  ```
- Verification reasoning: Genuinely dead in the current slice. The export
  could be argued as a future-fixture, but CLAUDE.md "Don't half-finish"
  and "delete completely" guidance argues for removal. Confidence 98.
- Confidence: 98

### F11 (NIT) — `audioStoragePath` is exported but only used inside its own file

- Severity: NIT
- Source: P4
- File:line: `apps/worker/src/pipeline/upload.ts:8`
- Finding: `audioStoragePath` is exported but only consumed at line 23
  of the same file. Public API surface widened with no consumer.
- Evidence:
  ```
  $ grep -rn "audioStoragePath" apps packages
  apps/worker/src/pipeline/upload.ts:8:export function audioStoragePath(meetingId: string): string {
  apps/worker/src/pipeline/upload.ts:23:  const storagePath = audioStoragePath(meetingId);
  ```
- Verification reasoning: Trivial; either drop the `export` keyword or
  inline. No behavioral impact. Confidence 92.
- Confidence: 92

### F12 (NIT) — Explicit `updated_at = now()` in RPCs is overwritten by the BEFORE UPDATE trigger

- Severity: NIT
- Source: P5
- File:line: `supabase/migrations/20260507165044_slice_2_ingestion_schema.sql:132-134`
  (claim_pending_meeting) and `:160-170` (auto_promote_for_board)
- Finding: Both RPCs set `updated_at = now()` explicitly in their UPDATE
  clauses. The `meetings_set_updated_at` BEFORE UPDATE trigger then
  reassigns `new.updated_at = now()` — its assignment wins, so the
  explicit one is dead. Behaviorally identical today (same transaction
  timestamp), but invites drift if the trigger and the explicit
  assignment ever diverge.
- Evidence:
  ```sql
  -- claim_pending_meeting body:
  update public.meetings m
     set status = 'extracting',
         updated_at = now()        -- overwritten by trigger
   where m.id = claimed_id
   ...

  -- trigger:
  create trigger meetings_set_updated_at
    before update on public.meetings
    for each row execute function public.set_updated_at();
  ```
- Verification reasoning: Postgres BEFORE-UPDATE row triggers fire after
  the SET clause builds NEW but before the row writes; the trigger's
  assignment to `new.updated_at` wins. Confidence 92.
- Confidence: 92

## Questions for human

These items have real signal but verification flagged them as judgment
calls (`should_be_question_not_finding: true`) or the post-verification
confidence dropped below the 80 floor.

### Q1 — Global UNIQUE on `meetings.youtube_id` precludes shared-channel boards (SPEC self-contradiction?)

- Source: P3 (verified `false` at conf 78 with reasoning "I cannot disprove the finding")
- Evidence: SPEC.md Stage 3 explicitly anticipates "Town Meeting and
  Planning Board content on the same channel are separate board entities
  with their own patterns when added." But SPEC.md Stage 5 mandates
  global UNIQUE on `meetings.youtube_id`. Mechanically: if board #2
  (e.g., Planning Board) is later configured against the same YouTube
  channel as board #1 (Select Board), `discoverForBoard` for board #2
  inserts via `upsert(..., { onConflict: 'youtube_id', ignoreDuplicates: true })`
  — every video already inserted under board #1 silently no-ops, leaving
  board #2 unable to ever discover its own meetings.
- Why this needs human input: It's a SPEC-internal contradiction, not a
  defect in the migration (the migration faithfully implements Stage 5).
  The natural resolution is either (a) amend SPEC Stage 5 to make the
  UNIQUE composite `(board_id, youtube_id)`, accepting that the same
  video can produce two `meetings` rows when multiple boards target the
  same channel; (b) amend Stage 3 to clarify that one board "owns"
  ingestion per channel and other boards filter the produced rows
  somehow; or (c) re-architect to a separate `youtube_videos` table that
  boards reference. Slice 2 only configures one board, so the issue is
  dormant — Slice 3+ work that adds a second board on a shared channel
  forces the call.

### Q2 — Commit `98237ad` lacks Conventional Commits prefix; NI-006 "Revisit when" trigger fires

- Source: P2 (verified `false` at conf 85 because `should_be_question_not_finding=true`)
- Evidence: `git log --pretty=format:"%H %s" 940a6f3..HEAD` shows
  `98237ad4… claude.md and spec.md updated for new slice build` — single
  parent (direct push, not a squash-merge). Commit dated 2026-05-07,
  one day after NI-006 was accepted (2026-05-06). NI-006 "Revisit when":
  "A direct-push to main without a Conventional Commits prefix occurs
  after the PR squash-merge convention is established; or an audit
  finds the pattern repeating beyond the initial deploy-debugging
  window." This audit is that finding.
- Why this needs human input: Same cost/benefit shape that produced
  NI-006 originally — the only remediation is destructive history
  rewriting on a doc-only diff. Triage options: (a) accept under NI-006
  (extend the registry entry's scope to cover this commit too); (b)
  enforce Conventional Commits via a pre-push hook or a CI check on
  PR-merge so future direct-pushes can't recur; (c) tolerate as a
  one-off process slip and continue.

### Q3 — Cron iterates every board with `youtube_channel_id IS NOT NULL`; no per-publication scoping

- Source: P3 (verified `true` at conf 90, flagged `should_be_question_not_finding=true`)
- Evidence: `apps/worker-cron/src/index.ts:13-17` selects all boards
  whose channel ID is set, across all publications. SPEC.md "Out of
  scope for v1" includes "Additional publications beyond the single
  tenant configured at launch"; CLAUDE.md §7 forbids "admin tooling for
  a second tenant" while the schema is multi-tenant. The cron's selector
  `youtube_channel_id IS NOT NULL` is itself the opt-in (a board only
  gets scanned if an operator populates the column).
- Why this needs human input: Whether v2 should ship publication-level
  scoping (a feature flag, an `enabled_at` timestamp, a per-publication
  cron schedule) or whether the "set the channel ID to opt in"
  convention is enough. Either is reasonable for v1; the former is admin
  tooling that v1 explicitly forbids. Tracking entry, not code work.

### Q4 — `authenticated` RLS on `meetings` filters only by `status='published'`, no tenant filter

- Source: P3 (verified `false` at conf 90 because `should_be_question_not_finding=true`; faithful to spec)
- Evidence: `supabase/migrations/20260507165044_slice_2_ingestion_schema.sql:87-91`:
  ```sql
  create policy "authenticated reads published meetings"
    on public.meetings for select to authenticated
    using (status = 'published');
  ```
  SPEC.md Stage 5 "Slice 2 schema deltas → RLS on `meetings`" mandates
  exactly this shape. Pass-1/pass-2 split explicitly defers
  membership-aware policies to pass 2. Today there are no authenticated
  users (Stage 7 magic-link e2e never completed).
- Why this needs human input: Whether to amend SPEC.md Stage 5 to make
  the policy `using (status = 'published' AND board_id IN (SELECT b.id
  FROM boards b JOIN towns t ON ... JOIN memberships m ON m.publication_id
  = t.publication_id WHERE m.user_id = auth.uid()))` now (defense in
  depth), or to wait until pass-2 schema work and the first
  authenticated-UI slice. The current shape ships a real tenant-boundary
  hole in the same merge that the second publication onboards — easy to
  forget at that point.

### Q5 — SPEC.md secrets matrix lists `ANTHROPIC_API_KEY` as required on the worker, but it's not in the worker env schema

- Source: P4 (verified `false` at conf 85 because `should_be_question_not_finding=true`)
- Evidence: SPEC.md line 70 row: `| ANTHROPIC_API_KEY | — | yes | — | — |`.
  `apps/worker/src/env.ts` schema = `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ASR_VENDOR_API_KEY`, `ASR_WEBHOOK_SECRET` only. No source-code reference
  to `ANTHROPIC_API_KEY` in `apps/` or `packages/` (only `apps/worker/dist/`
  carries a stale optional reference).
- Why this needs human input: Two valid interpretations. (1) SPEC matrix
  is intentionally spec-ahead-of-code — it documents the v1-completion
  topology; Slice 2 doesn't make LLM calls yet; Stage 4 segmentation/
  summarization will re-add the key. Adding the validator now would force
  ops to populate a key with no consumer. (2) SPEC is stale relative to
  what's actually deployed; better to remove the row until the consuming
  slice lands and re-add then. Reasonable people disagree; the
  appropriate disposition is a SPEC.md note clarifying the matrix's
  intent (current vs target topology) rather than code work.

### Q6 — Shared `assemblyAI*Schema` exports have no production consumer; Edge Function inlined copies

- Source: P4 (verified `false` at conf 85 because `should_be_question_not_finding=true`)
- Evidence: `grep -rn 'assemblyAIWebhookPayloadSchema\|assemblyAITranscriptSchema'`
  matches only `packages/shared/src/asr.ts` (declarations),
  `packages/shared/src/index.ts` (re-export), `packages/shared/src/asr.test.ts`
  (tests). The Edge Function inlines its own copies under a TODO comment
  ("dedupe with packages/shared/src/asr.ts when a second Edge Function
  lands"). The worker's `asr-submit.ts` only uses
  `buildAssemblyAISubmitBody`, not the schemas.
- Why this needs human input: Triage choice. Either (a) drop the unused
  exports (and their tests) to reduce dead surface, planning to re-add
  when a second Edge Function lands; or (b) keep the shared module as
  the durable source of truth and accept the temporary duplication —
  the TODO already acknowledges the trade-off. Both defensible.

## Reopen candidates

None. NI-001..NI-006 all remain sound under this audit's scope. F15
(clean-state assumption only commented) was dropped by verification on
the same reasoning that produced NI-002/NI-003 (bare DDL is the
project convention; "scenarios that can't happen" don't get programmatic
guards), so the registry held up under another challenge.

## What NOT to fix (this audit)

Items that are intentional per SPEC.md or CLAUDE.md and should NOT be
touched:

- **Default-deny RLS on `boards`, `towns`, `publications`, `memberships`.**
  SPEC.md Stage 5 pass-1: "no business policies exist beyond an anon
  SELECT on `_scaffold_health`. Default-deny applies to everything else
  until pass 2." Slice 2 only added policies to `meetings`, which is
  spec-mandated.
- **No FK-side index on `memberships.publication_id`** (and similar
  deferred indexes). SPEC.md Stage 5 Indexes paragraph and the prior
  audit's "What NOT to fix" both defer these to pass 2. Slice 2 adds
  only the two mandated indexes (`meetings_status_idx`, `meetings_board_id_idx`).
- **`set_updated_at()` trigger only on `meetings`, not on `boards`/`towns`/etc.**
  SPEC.md Stage 5 Slice 2 deltas: "`set_updated_at()` BEFORE UPDATE on
  `meetings` only. Other tables receive the trigger when a slice touches
  them."
- **Console logging in the Edge Function.** Edge Functions run on Deno
  server-side; CLAUDE.md's no-`console`-in-non-worker heuristic is
  scoped to the browser surface (`apps/web`). The Edge Function is the
  webhook receiver and needs operational logging.
- **Edge Function imports `createClient` directly from `esm.sh`** rather
  than going through `packages/db`. Verification disproved this finding
  (P2 candidate F4): CLAUDE.md §1 carves Edge Functions out as having
  "their own dependency surface" and only sanctions importing generated
  DB types from `packages/db`. The factory uses Node-style npm imports
  the Deno surface can't consume without an import_map, which the slice
  deliberately defers.
- **Inline AssemblyAI schemas in the Edge Function** (with TODO marker).
  Same architectural reason as above; intentional Slice 2 trade-off.
- **`--ignore-scripts` in Dockerfile `pnpm install`.** The workspace
  `prepare` scripts in `packages/shared` and `packages/db` run `tsc`,
  which can't run before source is COPYed. Skipping prepare and running
  the per-package builds explicitly is the correct monorepo Dockerfile
  pattern.
- **`apps/web/package.json` test script using `--passWithNoTests`.** The
  webhook stub deletion correctly removed the only test in `apps/web`.
  The flag prevents `pnpm -r test` from failing on the empty workspace
  until a future slice adds the first real web test.
- **`boards.title_pattern` accepted as raw `~*` regex without
  validation.** Verification disproved this candidate (P5 F14): the
  column is operator-controlled config, not user input; CLAUDE.md
  forbids validation for "scenarios that can't happen"; a malformed
  regex fails noisily on the next cron tick — visible failure matches
  the project's "no auto-retry, manual reset" stance.
- **`uploads_playlist_id` CHECK admits the 2-char literal `'UC'`.**
  Verification reframed as Q (judgment call). Operator-only insert path;
  downstream YouTube call would fail at runtime anyway. Tightening to
  `'UC_%'` is hardening, not a defect fix.

## Suggested fix order

1. **F1** (MEDIUM, schema) — Add a follow-up migration that promotes
   `meetings.youtube_id` to NOT NULL. Backwards-compatibility shape:
   the seeded smoke row already has a non-null value; production
   meetings is empty before this slice; the Slice 2 cron+worker code
   always writes a value. Safe to apply NOT NULL in-place. Once
   applied, regenerate `packages/db/src/types.ts` (or hand-edit) to
   make `youtube_id: string` non-nullable, then drop the defensive
   throw at `apps/worker/src/pipeline/claim.ts:28-29`.

2. **F7** (MEDIUM, CI) — Add a `.github/workflows/deploy-functions.yml`
   that runs `supabase functions deploy asr-webhook` on push to `main`.
   Prerequisites: `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`
   secrets already set for `migrate.yml` are reusable. Ordering vs.
   `migrate.yml` doesn't strictly matter — the function does not depend
   on schema; the function depends on the function's secrets being
   pre-populated via `supabase secrets set` (an out-of-band step
   already documented in the plan).

3. **F8** (LOW, dead code) — Delete `_resetEnvCacheForTests` from
   `apps/web/src/lib/env.ts` and its export. If a future web test needs
   to reset the env cache, the helper takes one minute to re-add.

4. **F11** (NIT, dead surface) — Drop the `export` keyword on
   `audioStoragePath` in `apps/worker/src/pipeline/upload.ts:8`.

5. **F12** (NIT, redundancy) — Remove the explicit `updated_at = now()`
   assignment from both RPCs in
   `supabase/migrations/20260507165044_slice_2_ingestion_schema.sql`.
   **Cannot edit a merged migration** per CLAUDE.md §5 — apply this in
   a follow-up `CREATE OR REPLACE FUNCTION` migration that reissues
   both function definitions without the redundant assignment.

(Q1–Q6 are triage decisions, not fixes. Resolve in the duly_noted
Claude Project; promote to `_known-non-issues.md` or future-slice
tracking as appropriate.)

## Summary

| Bucket                                  | Count |
| --------------------------------------- | ----- |
| Findings (post-verification)            | **5** |
| ↳ BLOCKER                               | 0     |
| ↳ HIGH                                  | 0     |
| ↳ MEDIUM                                | 2     |
| ↳ LOW                                   | 1     |
| ↳ NIT                                   | 2     |
| Questions for human                     | 6     |
| Reopen candidates                       | 0     |
| Findings dropped by verification        | 3     |
| Findings filtered by `_known-non-issues.md` | 0 (registry consulted; F15's drop was on the same shape as NI-002/NI-003 but the candidate didn't directly hit a registry entry) |

The slice landed in good shape. Mechanical passes, live migration apply,
and Docker build are all green. Two MEDIUM findings need attention before
the slice ships end-to-end: the `youtube_id` NOT NULL drift (F1) and the
missing Edge Function deploy workflow (F7). The remaining three findings
are housekeeping. The six questions cluster around two themes — SPEC
internal-consistency on multi-board/multi-publication shape (Q1, Q3, Q4),
and triage choices about what to drop vs keep as future-proofing (Q5,
Q6) — plus the recurring Conventional Commits process slip (Q2).
