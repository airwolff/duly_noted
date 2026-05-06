---
name: code-audit
description: Audit recent changes to the duly_noted codebase against SPEC.md, CLAUDE.md, and the accepted-non-issues registry. Runs six parallel duly_noted-specific subagent passes (SPEC compliance, CLAUDE.md compliance, schema integrity, dead code, migration safety, hallucination check), then runs verification subagents to disprove false positives. Produces a single dated, read-only audit report in docs/audits/. Use when the user asks to audit, review, or check recent work; when they want to find errors, bugs, or refactor opportunities after a Claude Code session; when they reference a slice, the spine, the scaffold, or "yesterday's work" and want it audited; or when they paste a commit range and ask what's wrong with it. Triggers on phrases like "run an audit", "audit the slice", "review the build", "check yesterday's work", "audit the spine", "find issues in the new code".
---

# code-audit

Multi-agent cold-reviewer audit of recent code changes. Six
duly_noted-specific subagents run in parallel — SPEC compliance,
CLAUDE.md compliance, schema/tenant integrity, dead code, migration
safety, hallucination check — then verification subagents attempt to
disprove each candidate finding. 80-floor applied after verification.
Output is one dated audit file.

## What the passes cover

The six passes target duly_noted-specific concerns: tenant
boundaries, the Publication → Town → Board → Meeting → Segment
hierarchy, `_known-non-issues.md` suppression, SPEC.md compliance,
CLAUDE.md compliance at all directory levels, and the integrity of
external API/library/config references.

The verification pass attempts to disprove each candidate finding
before it lands in the report. False positives erode trust more than
missed findings cost.

## Hard rules

- **Read-only on source.** No edits, creates, or deletes of source
  files, configs, migrations, or existing docs.
- **One write, one file.** Only permitted write is creating one
  new file at `docs/audits/<YYYY-MM-DD>-<scope-slug>.md`. The
  protect-audits hook blocks edits to existing audit files; new
  audit creation is allowed.
- **No state changes.** No installs, migrations, formatters with
  `--write`, linters with `--fix`.
- **No fixes.** Findings only.
- **Skip suppressed items.** Anything in `_known-non-issues.md` is
  suppressed from new findings. Pass this list to every subagent.
- **80-confidence floor after verification.**
- **Subagents inherit hard rules.** Pass these constraints into
  every subagent task description.

## Workflow

### 1. Confirm scope

Ask the user what scope to audit. Accept:

- A commit SHA or branch reference
- A slice name (`audit the spine`)
- A time anchor (`audit today's work`)
- "All of it" for everything since the last audit

If unclear, ask. Resolve named slices to commit ranges via
`git log --oneline`.

### 2. Read for context (main agent)

In this order:

1. `docs/audits/README.md` — convention reference
2. `docs/audits/_known-non-issues.md` — suppression list
3. The most recent file in `docs/audits/` — prior context
4. `CLAUDE.md` (all directory levels)
5. `SPEC.md`
6. `git log --oneline <range>`
7. `git diff --stat <range>`

Keep scope, file list, and known-non-issues in main context.

### 3. Run mechanical passes (main agent)

Capture raw output:

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm format:check`
- `git diff --stat <range>` and `git diff --shortstat <range>`
- Grep sweeps in changed files: TODO/FIXME/XXX, `console.`
  (excluding `apps/worker*`), hardcoded URLs (excluding tests),
  secret-shaped strings, `.env*` literal references
- File size: new files > 500 LOC; files that grew > 200 LOC
- Test ratio: source vs test files added

These run fast and inform every subagent.

### 4. Launch six custom subagents in parallel

Each subagent gets:

- The commit range and changed file list
- `_known-non-issues.md` content
- Relevant section(s) of SPEC.md and CLAUDE.md
- Mechanical pass output relevant to its pass
- Output schema:
  `[{severity, file_line, finding, evidence, initial_confidence}]`
- Hard rule reminder: read-only, no fixes
- Suppression list

Tag each finding with `source: P<n>`.

#### P1 — SPEC compliance subagent

> For each new or modified file in <range>, identify which SPEC.md
> section it implements. Flag scope creep (code not in spec), spec
> gaps (spec items not implemented), and contradictions between
> code and spec. Do not flag stylistic or convention issues.
> Suppress anything in: <known-non-issues list>.

#### P2 — CLAUDE.md compliance subagent

> Check every new or modified file against every applicable rule
> in CLAUDE.md at all directory levels. Quote the rule verbatim
> and cite the offending line. Suppress anything in:
> <known-non-issues list>.

#### P3 — Schema and data model integrity subagent

> For any DB or schema work in <range>: tenant boundary check on
> every query, FK, and index. Flag paths that cross Publication
> boundaries without explicit join. Flag breaks in the
> Publication → Town → Board → Meeting → Segment hierarchy. Flag
> any RLS gap on exposed tables.

#### P4 — Dead code and abandoned approaches subagent

> Look for: orphaned functions/files, unused imports, config keys
> defined but never read, migrations not referenced by code, env
> vars validated but never accessed, route handlers added but not
> registered.

#### P5 — Migration and state safety subagent

> For any DB migration in <range>: check clean state assumptions,
> missing IF NOT EXISTS / IF EXISTS guards on DDL, partial-apply
> recovery, idempotency.

#### P6 — Hallucination check subagent

> Verify every external API call, library import, file path, and
> config key referenced in new code actually exists. Flag library
> functions not in the installed version, config keys read but
> never set, files referenced by path but not present, API
> methods not in the SDK's actual surface. Use `package.json` and
> installed versions as ground truth.

### 5. Deduplicate findings

Group findings by root cause: same underlying issue surfacing in
multiple passes merges into one finding with all manifestations
under Evidence and all source pass IDs preserved.

### 6. Verification pass

For each candidate finding, launch a verification subagent in
parallel:

> An audit pass flagged this finding:
>
> **Finding:** <claim>
> **File:line:** <location>
> **Evidence cited:** <evidence>
> **Severity:** <severity>
> **Initial confidence:** <X>
>
> Your job is to **disprove** this finding. Read the actual code
> at the cited location. Ask: is this issue real? Is the rule it
> cites scoped to this file? Is there context that makes the
> apparent issue intentional? Is it covered by
> `_known-non-issues.md`?
>
> Return JSON:
>
> ```
> {
>   "verified": true | false,
>   "confidence": 0-100,
>   "reasoning": "...",
>   "should_be_question_not_finding": true | false
> }
> ```
>
> If you are not certain, return `verified: false`. False
> positives erode trust.

Apply:

- `verified: false` → drop
- `verified: true` AND `confidence >= 80` → keep as Finding
- `verified: true` AND `confidence < 80` → move to Questions
- `should_be_question_not_finding: true` → move to Questions
  regardless

### 7. Write the audit file

Write to `docs/audits/<YYYY-MM-DD>-<scope-slug>.md`. Use the
Write tool — the protect-audits hook allows new file creation
(blocks only existing-file edits).

#### Output format

```markdown
---
date: YYYY-MM-DD
scope: <human description>
commit_range: <root-sha>..<head-sha>
head_sha: <head-sha>
prior_audit: <filename or "none">
known_non_issues_consulted: <true|false>
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: <n>
questions_count: <n>
findings_dropped_by_verification: <n>
findings_filtered_by_known_non_issues: <n>
---

# Audit — <scope>

## Mechanical pass results

<table>

## Findings

For each:

- Severity: BLOCKER | HIGH | MEDIUM | LOW | NIT
- Source: P<n> (or P<n>+P<m> if merged across passes)
- File:line
- Finding: one sentence
- Evidence: code excerpt or command output
- Verification reasoning: brief note
- Confidence: 0–100 (post-verification)

## Questions for human

For each:

- Question
- Evidence
- Why this needs human input

## Reopen candidates

Items in `_known-non-issues.md` you believe warrant
reconsideration. Empty section if none.

## What NOT to fix (this audit)

Intentional per SPEC.md or CLAUDE.md, with citation.

## Suggested fix order

Ordered list of finding IDs by dependency, not severity alone.

## Summary

Counts by severity; questions; reopen; findings dropped by
verification; findings suppressed by known-non-issues registry.
```

### 8. Print and stop

After writing:

- Print only the file path and the summary table
- Note how many findings were dropped during verification and
  how many were suppressed by the registry
- Do not echo the full report
- Stop

## Edge cases

**No commits in scope.** Stop and report.

**`docs/audits/` does not exist.** Stop and direct user to scaffold.

**Mechanical pass fails.** Capture failure, note in audit, continue
with passes that don't depend on it.

**A custom subagent fails.** If 1–2 of six fail, note and proceed.
If 3+ fail, stop.

**Verification dropped everything.** Audit still written with zero
Findings, full mechanical results, any Questions.

**Audit file already exists for today (same slug).** Append numeric
suffix (`-2`, `-3`).

**Hook blocks the audit-file write.** Should not happen with the
existence-check hook (new files allowed). If it does, stop and
report — something is misconfigured.

## Performance note

6 custom subagents + N verification subagents per audit. For
typical slices, expect 8–20 subagent invocations per audit. Wall
time typically 3–10 minutes for a slice-sized scope.

If performance becomes a problem, the verification pass on LOW
and NIT findings is the first thing to drop.

## What this skill is not

- Not a fix tool. Use `apply-audit-fixes`.
- Not a triage tool. Triage in the duly_noted Claude Project.
- Not a wont-fix promotion tool. Use `promote-to-non-issue`.
