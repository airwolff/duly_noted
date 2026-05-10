---
name: apply-audit-fixes
description: Implements code fixes for findings that the user marked "Fix now" during audit triage. Reads the canonical fix-brief at docs/audits/<audit-stem>-fix-brief.md (the committed triage outcome from the duly_noted Claude project) and walks the user through approved findings one at a time, applies each fix, and runs verification. Falls back to user-supplied finding IDs when no fix-brief exists. Use when the user wants to fix, address, implement, or apply audit findings; when they reference a triaged audit and want the fixes done; or when they say "let's fix the audit findings", "apply the fixes from yesterday's audit", "implement the fix-brief", "work through the audit". Skips findings in _known-non-issues.md. Verifies after each fix with typecheck, lint, format:check, and tests.
---

# apply-audit-fixes

Implement the "Fix now" findings from a triaged audit, one at a
time, with verification between fixes. The fix-brief at
`docs/audits/<audit-stem>-fix-brief.md` is the single source of
truth for what to change; `_known-non-issues.md` is the source of
truth for what NOT to touch.

## When to use

Use after triaging an audit in the duly_noted Claude project. The
triage produces a committed fix-brief listing fix-now items with
file:line references and CC-ready instructions per item. This
skill executes that brief.

If no fix-brief exists (older workflow or user is paste-driving
the queue), accept finding IDs directly.

## Hard rules

- **Fix-brief is the brief.** When a fix-brief exists for the
  named audit, it is the canonical input. The audit is the
  source of findings; the fix-brief is the triage outcome. Do
  not infer fix scope from the audit when a fix-brief is
  available.
- **Only fix what was triaged.** Do not opportunistically fix
  things you notice along the way. Out-of-scope improvements
  become their own session or a Backlog entry in SPEC.md.
- **Suppress wont-fixes.** Anything in `_known-non-issues.md` is
  off-limits. If a proposed fix would touch the same file:line as
  a registry entry, stop and ask.
- **One finding at a time.** Show the fix, apply, verify, move
  to next. Do not batch fixes across findings.
- **Verify after each fix.** Run typecheck, lint, format:check at
  minimum. Run tests when the changed code has test coverage.
- **Stop on red.** If verification fails after a fix, stop and
  report. Do not proceed while broken. Do not auto-revert or
  auto-retry.
- **Never edit the audit file.** It is a historical record.
- **Never edit the fix-brief mid-pass.** It is immutable once
  committed. If the brief is wrong, surface that and stop.
- **Never edit `_known-non-issues.md`.** Use the
  `promote-to-non-issue` skill for appends; manual CC edits for
  status changes.

## Workflow

Copy this checklist and tick items as you progress:

```
- [ ] Step 1: Identify the audit + fix-brief (or user-supplied IDs)
- [ ] Step 2: Read for context
- [ ] Step 3: Confirm the queue
- [ ] Step 4: For each finding — restate, propose, diff, apply, verify, mark
- [ ] Step 5: Final summary
```

### Step 1: Identify the audit and fix list

Ask:

- Which audit file? (path like
  `docs/audits/2026-05-10-slice-5-reader-ui.md`)
- If `<audit-stem>-fix-brief.md` exists alongside it, use that as
  the canonical queue. Confirm with the user before starting.
- If no fix-brief exists, ask which finding IDs to fix
  (`F1, F2, F-NIT-1` format — preserve verbatim from the audit).

The user may also paste a triage summary directly ("Fix now:
F1, F2, F-NIT-1"). Use that, but note in the final summary that
no committed fix-brief was used so the paper trail can be
reconstructed.

### Step 2: Read for context

In order:

1. The named audit file
2. The fix-brief (`<audit-stem>-fix-brief.md`), if it exists
3. `docs/audits/_known-non-issues.md` — suppression list
4. `CLAUDE.md` at every directory level (root + per-directory)
5. `SPEC.md` — for spec compliance of proposed fixes
6. `docs/adr/` — scan filenames; read any ADR a proposed fix
   would touch

### Step 3: Confirm the queue

Print the fix queue with one-line summaries, preserving the
audit's verbatim finding IDs:

```
Fix queue from 2026-05-10-slice-5-reader-ui-fix-brief.md:
  [1] F1     (MEDIUM) — Meeting list rows omit segment count
  [2] F2     (LOW)    — service_role policies without GRANTs
  [3] F3     (LOW)    — createServerComponentClient phantom symbol
  [4] F6     (MEDIUM) — Prettier autofix corrupts apps/web/CLAUDE.md
  [5] F11    (LOW)    — @testing-library/user-event unused

Workflow/SPEC amendments from the brief:
  [6] Root CLAUDE.md §5 PR gate — add pnpm -r format:check
  [7] SPEC.md §Backlog — add B-NN entry
  [8] build-cycle.md routing policy — manual paste (substantial)

Wont-fixes I'll skip (from _known-non-issues.md):
  - NI-018: Speculative exports in resolvers.ts (F-NIT-1)
  - NI-019: Speculative export in sort-segments.ts (F-NIT-2)

Proceed?
```

Wait for confirmation before starting.

### Step 4: For each finding (one at a time)

#### a. Restate the finding

Quote the finding from the audit (file:line, severity, evidence)
and the fix-brief's CC-ready instruction if present. This anchors
the fix scope.

#### b. Propose the fix

Describe the change in plain prose first:

- Files to be modified
- What changes and why
- Whether SPEC.md or CLAUDE.md amendments are needed (the
  fix-brief usually answers this; if it doesn't and the fix
  drifts toward a spec change, stop)

If the fix requires touching files outside the finding's scope
(refactors, helper additions), surface explicitly. Ask before
expanding scope.

#### c. Show the diff

Show the exact diff before applying. Use code blocks with file
paths.

#### d. Apply

Write the changes. Prefer targeted edits (`str_replace`) over
whole-file rewrites for any change under ~30 lines. Use Write
only for new files.

#### e. Verify

Run, in order:

- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm -r format:check` (per root CLAUDE.md §5 PR gate)
- `pnpm -r test` if the changed area has tests

If any step fails: stop, report the failure verbatim, ask for
direction. Do not auto-revert, do not auto-retry, do not move
to the next finding.

#### f. Mark and continue

Print: `✓ F<N> fixed and verified.`

Move to the next finding.

### Step 5: Final summary

After the queue is empty (or stopped):

```
Audit fix pass complete.

Fixed: N findings (list IDs)
Skipped (wont-fix): N (NI-IDs)
Failed: N (list IDs and failure reasons)
Outstanding: N (list IDs the user deferred during the pass)

Suggested next: re-run the code-audit skill to verify fixes
landed clean and didn't introduce regressions. Use the re-audit
filename convention from docs/audits/README.md:
`<reaudit-date>-<original-slug>-fix-reaudit.md`.
```

## Edge cases

**No fix-brief exists.** Older audits or audits the user is
paste-driving. Fall back to asking for finding IDs. Note this in
the final summary so the paper trail captures it.

**Finding overlaps a wont-fix.** A finding's file:line matches an
entry in `_known-non-issues.md`. Stop and ask: "F<N> touches the
same code as NI-NNN. Fix anyway, or skip?" Do not assume.

**Fix needs a spec amendment.** The cleanest fix conflicts with
SPEC.md, CLAUDE.md, or an ADR. Stop. Direct the user to amend in
the Claude project first; reapply after the amendment lands. Do
not silently amend the spec from this skill.

**Verification reveals pre-existing failures.** Tests fail in
code unrelated to the fix. Surface this honestly: "Typecheck
passes but `apps/worker/test/poller.test.ts` fails — this looks
pre-existing, not caused by this fix. Fix included or skip?"
Let the user decide.

**Format:check fails on a file the fix did not touch.** Same
shape as above — pre-existing drift surfaced by the new gate.
Surface and let the user decide whether to fold the cleanup into
this pass or defer it.

**The audit is stale.** Several findings reference code that no
longer exists (already fixed, or reorganized). Stop and report:
"F3, F5, F7 reference code that's no longer present. The audit
may be stale. Skip these or re-audit first?"

**Mid-queue interruption.** If the user says "stop" or asks a
non-fix question mid-queue, stop the queue, answer the question,
and ask whether to resume. Do not silently abandon the queue.

**Fix-brief instruction is wrong.** The brief says to do X but X
is impossible or harmful. Surface the conflict, do not
work-around silently. The brief is immutable once committed;
correcting it requires a triage session, not a fix session.

## What this skill is not

- Not an auditor. Use `code-audit`.
- Not a triage tool. Triage happens in the duly_noted Claude
  project and produces the fix-brief this skill consumes.
- Not a wont-fix promotion tool. Use `promote-to-non-issue` to
  append entries to `_known-non-issues.md`.
- Not a refactor tool. Refactors that aren't in the brief need
  a separate session with a separate brief.
- Not a deployment tool. Verification stops at typecheck / lint /
  format:check / test. Deploys remain manual per build-cycle.md
  step 9.
