---
name: apply-audit-fixes
description: Implement code fixes for findings that the user marked as "Fix now" during audit triage. Reads the dated audit file from docs/audits/, walks the user through approved findings one at a time, applies the fix, and runs verification. Use when the user wants to fix, address, implement, or apply audit findings; when they reference a triaged audit and want the fixes done; or when they say "let's fix the audit findings", "apply the fixes from yesterday's audit", "implement the fix list", "work through the audit". Skips findings in _known-non-issues.md. Verifies after each fix with lint/typecheck/tests.
---

# apply-audit-fixes

Implement the "Fix now" findings from a triaged audit, one at a
time, with verification between fixes. Distinct from a vibe-coding
session — the audit is the single source of truth for what to
change, and `_known-non-issues.md` is the source of truth for
what NOT to touch.

## When to use

Use after triaging an audit in the duly_noted Claude Project and
deciding which findings to fix. The user typically arrives with
either a list of finding IDs to fix or a triage summary they'll
paste in.

## Hard rules

- **Audit is the brief.** Only fix findings the user explicitly
  selected from the audit. Do not opportunistically fix things
  you notice along the way.
- **Suppress wont-fixes.** Anything in `_known-non-issues.md` is
  off-limits. If a proposed fix would touch the same file:line as
  a registry entry, stop and ask.
- **One finding at a time.** Show the fix, apply, verify, move to
  next. Do not batch fixes across findings.
- **Verify after each fix.** Run typecheck and lint at minimum.
  Run tests when the changed code has test coverage.
- **Stop on red.** If verification fails after a fix, stop and
  report. Do not proceed to the next finding while broken.
- **Never edit the audit file.** It's a historical record.
- **Never edit `_known-non-issues.md`.** Use the
  `promote-to-non-issue` skill for that.

## Workflow

### 1. Identify the audit and fix list

Ask:
- Which audit file? (path like
  `docs/audits/2026-05-06-spine-scaffold.md`)
- Which findings to fix? (IDs like "1, 2, 4" or a description
  like "the BLOCKER and the HIGH")

If the user pastes a triage summary from the Claude Project
("Fix now: 1, 2, 4"), use that directly.

### 2. Read for context

1. The named audit file
2. `docs/audits/_known-non-issues.md` (suppress these)
3. `CLAUDE.md` (all directory levels) — conventions to follow
4. `SPEC.md` — to check spec compliance of proposed fixes

### 3. Confirm the queue

Print the fix queue with one-line summaries:

```
Fix queue from 2026-05-06-spine-scaffold.md:
  [1] Finding 1 (BLOCKER) — ASR_WEBHOOK_SECRET not in render.yaml
  [2] Finding 2 (HIGH)    — Open redirect on /auth/callback
  [3] Finding 4 (MEDIUM)  — Deep relative imports

Wont-fixes I'll skip (from _known-non-issues.md):
  - NI-001: Webhook secret comparison (Finding 6 from same audit)
  - NI-002: loadEnv caching divergence (Finding 9)

Proceed?
```

Wait for confirmation before starting.

### 4. For each finding (one at a time)

#### a. Restate the finding

Quote the finding from the audit (file:line, severity, evidence).
This anchors the fix scope.

#### b. Propose the fix

Describe the change in plain prose first:
- Files to be modified
- What changes and why
- Whether spec or CLAUDE.md amendments are needed (rare; usually
  fixes work within current conventions)

If the fix requires touching files outside the finding's scope
(refactors, helper additions), surface this explicitly. Ask
before expanding scope.

#### c. Show the diff

Show the exact diff before applying. Use code blocks with file
paths.

#### d. Apply

Write the changes.

#### e. Verify

Run, in order:
- `pnpm typecheck` (or workspace-specific equivalent)
- `pnpm lint`
- `pnpm test` if the changed area has tests

If any step fails: stop, report the failure, ask for direction.
Do not auto-revert; do not auto-retry; do not move to the next
finding.

#### f. Mark and continue

Print: `✓ Finding N fixed and verified.`
Move to the next finding.

### 5. Final summary

After the queue is empty (or stopped):

```
Audit fix pass complete.

Fixed: N findings (list IDs)
Skipped (wont-fix): N (NI-IDs)
Failed: N (list IDs and failure reasons)
Outstanding: N (list IDs the user deferred during the pass)

Suggested next: re-run code-audit skill to verify fixes landed
clean and didn't introduce regressions.
```

## Edge cases

**Finding overlaps a wont-fix.** A finding's file:line matches an
entry in `_known-non-issues.md`. Stop and ask: "Finding N touches
the same code as NI-NNN. Fix anyway, or skip?" Do not assume.

**Fix needs a spec amendment.** The cleanest fix conflicts with
SPEC.md or CLAUDE.md. Stop. Direct the user to amend the spec in
the duly_noted Claude Project first; reapply the fix after the
amendment lands. Do not silently amend the spec from this skill.

**Verification reveals new issues.** Tests fail in code unrelated
to the fix. Surface this honestly: "Typecheck passes but
`apps/worker/test/poller.test.ts` fails — this looks pre-existing,
not caused by my fix. Fix included or skip?" Let the user decide.

**The audit is stale.** Several findings reference code that no
longer exists (already fixed in a previous session, or reorganized).
Stop and report: "Findings 3, 5, 7 reference code that's no longer
present. The audit may be stale. Skip these or re-audit first?"

**Mid-queue interruption.** If the user says "stop" or asks a
non-fix question mid-queue, stop the queue, answer the question,
and ask whether to resume. Do not silently abandon the queue.

## What this skill is not

- Not an auditor. Use `code-audit` for that.
- Not a triage tool. Triage happens in the Claude Project.
- Not a refactor tool. Refactors that aren't in the audit need a
  separate session with a separate brief.
- Not a deployment tool. Verification stops at lint/typecheck/test.
  Deploys remain manual.
