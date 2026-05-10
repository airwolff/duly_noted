---
name: code-audit
description: Audits recent changes to the duly_noted codebase against SPEC.md, CLAUDE.md (root and per-directory), ADRs, and the accepted-non-issues registry. Runs six parallel duly_noted-specific subagent passes (SPEC compliance, CLAUDE.md compliance, schema and tenant integrity, dead code, migration safety, hallucination check), then runs verification subagents that try to disprove each candidate finding before it lands. Applies an 80-confidence floor after verification; sub-80 verified items route to Questions rather than dropping silently. Produces a single dated, read-only audit report in docs/audits/. Use when the user asks to audit, review, or check recent work; when they want to find errors, bugs, or refactor opportunities after a Claude Code session; when they reference a slice, the spine, the scaffold, or "yesterday's work" and want it audited; or when they paste a commit range and ask what's wrong with it. Triggers on phrases like "run an audit", "audit the slice", "review the build", "check yesterday's work", "audit the spine", "find issues in the new code".
---

# code-audit

Multi-agent cold-reviewer audit of recent code changes. Six
duly_noted-specific subagents run in parallel; verification
subagents then try to disprove each candidate finding. 80-confidence
floor applied after verification; sub-80 verified items route to
Questions. Output is one dated audit file.

## Hard rules

- **Read-only on source.** No edits, creates, or deletes of source
  files, configs, migrations, or existing docs.
- **One write, one file.** Only permitted write is creating one new
  file at `docs/audits/<YYYY-MM-DD>-<scope-slug>.md`. The
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

Copy this checklist and tick items as you progress:

```
- [ ] Step 1: Confirm scope
- [ ] Step 2: Read for context
- [ ] Step 3: Run mechanical passes
- [ ] Step 4: Launch P1–P6 subagents in parallel
- [ ] Step 5: Deduplicate findings
- [ ] Step 6: Run verification per candidate
- [ ] Step 7: Write the audit file
- [ ] Step 8: Print summary and stop
```

### Step 1: Confirm scope

Accept: a commit SHA or branch ref, a slice name (`audit the
spine`), a time anchor (`audit today's work`), or "all of it"
since the last audit. Resolve slice names to commit ranges via
`git log --oneline`. Ask if unclear.

### Step 2: Read for context

In order:

1. `docs/audits/README.md` — convention reference
2. `docs/audits/_known-non-issues.md` — suppression list
3. Most recent file in `docs/audits/` — prior context
4. `CLAUDE.md` at every directory level (root, plus any
   `apps/*/CLAUDE.md` or `packages/*/CLAUDE.md`)
5. `SPEC.md`
6. `docs/adr/` — scan filenames; read any ADR a candidate slice
   would touch
7. `git log --oneline <range>` and `git diff --stat <range>`

### Step 3: Run mechanical passes

Capture raw output:

- `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`,
  `pnpm -r format:check` (per root CLAUDE.md §5 PR gate)
- `git diff --stat <range>` and `git diff --shortstat <range>`
- Grep sweeps in changed files: TODO/FIXME/XXX, `console.`
  (excluding `apps/worker*`), hardcoded URLs (excluding tests),
  secret-shaped strings, `.env*` literal references
- File size: new files > 500 LOC; files that grew > 200 LOC
- Test ratio: source vs test files added

### Step 4: Launch six custom subagents in parallel

Each subagent gets: the commit range and changed file list,
`_known-non-issues.md` content, relevant SPEC.md/CLAUDE.md
sections (all directory levels), any in-scope ADRs, relevant
mechanical output, the suppression list, and the hard-rule
reminder. Output schema:
`[{id, severity, file_line, finding, evidence, initial_confidence}]`.
Tag each finding with `source: P<n>`.

#### P1 — SPEC compliance

> Identify which SPEC.md section each new or modified file
> implements. Flag scope creep (code not in spec), spec gaps
> (spec items not implemented), and contradictions between code
> and spec. Reference ADRs where the spec points to one. Do not
> flag stylistic issues (those are P2). Suppress anything in:
> <known-non-issues list>.

#### P2 — CLAUDE.md compliance

> Check every new or modified file against every applicable rule
> in CLAUDE.md at all directory levels. Quote the rule verbatim
> and cite the offending line. Suppress anything in:
> <known-non-issues list>.

#### P3 — Schema and data model integrity

> For any DB or schema work in <range>: tenant boundary check on
> every query, FK, and index. Flag paths that cross Publication
> boundaries without explicit join. Flag breaks in
> Publication → Town → Board → Meeting → Segment. Flag RLS gaps
> on exposed tables. Flag any policy without a matching GRANT in
> the same migration (root CLAUDE.md §6 hard rule).

#### P4 — Dead code and abandoned approaches

> Find: orphaned functions/files, unused imports, config keys
> defined but never read, migrations not referenced by code, env
> vars validated but never accessed, route handlers added but
> not registered, devDependencies declared but never imported.

#### P5 — Migration and state safety

> For any DB migration: check clean-state assumptions, missing
> `IF NOT EXISTS` / `IF EXISTS` guards on DDL, partial-apply
> recovery, idempotency. Flag migrations that aren't
> backwards-compatible with the currently-deployed worker.

#### P6 — Hallucination check

> Verify every external API call, library import, file path, and
> config key in new code actually exists. Flag library functions
> not in the installed version (use `package.json` + installed
> surface as ground truth), config keys read but never set,
> files referenced by path but absent, API methods not in the
> SDK's actual surface. Also flag references in SPEC.md,
> CLAUDE.md, or ADRs to symbols absent from the installed
> library version.

### Step 5: Deduplicate findings

Group by root cause: the same underlying issue surfacing in
multiple passes merges into one finding, with all manifestations
under Evidence and all pass IDs preserved (`source: P1+P3`).

### Step 6: Verification pass

For each candidate finding, launch a verification subagent in
parallel:

> An audit pass flagged this finding:
>
> **Finding:** <claim> · **File:line:** <location> ·
> **Evidence:** <evidence> · **Severity:** <severity> ·
> **Initial confidence:** <X>
>
> Your job is to **disprove** this finding. Read the actual code
> at the cited location. Is the issue real? Is the rule scoped
> to this file? Is there context making the apparent issue
> intentional? Is it covered by `_known-non-issues.md`, endorsed
> by SPEC.md, an ADR, or a CLAUDE.md exception?
>
> Return JSON:
> `{ "verified": bool, "confidence": 0-100, "reasoning": "...", "should_be_question_not_finding": bool }`
>
> If not certain the issue is real, return `verified: false`.
> False positives erode trust more than missed findings cost.

Apply:

- `verified: false` → drop
- `verified: true` AND `confidence >= 80` → Finding
- `verified: true` AND `confidence < 80` → Questions
- `should_be_question_not_finding: true` → Questions regardless

The 80 floor is a precision/recall trade: keep Findings
high-precision; the Questions section is the recall safety
valve so ambiguous items reach the user without false certainty.

### Step 7: Write the audit file

Write to `docs/audits/<YYYY-MM-DD>-<scope-slug>.md`. Use the
Write tool — the protect-audits hook allows new file creation.

#### Finding IDs

Assign IDs as findings are written:

- Default findings: `F1`, `F2`, `F3`, ...
- NIT-severity findings: `F-NIT-1`, `F-NIT-2`, ... (separated so
  triage can scan severity at a glance)
- Questions: `Q1`, `Q2`, ...
- Reopen candidates: cite by `NI-NNN`; no separate ID

Preserve these IDs verbatim — downstream consumers (fix-briefs,
the `promote-to-non-issue` skill) reference them by exact string.

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
passes_run: <comma-separated list of passes that completed>
findings_count: <n>
questions_count: <n>
findings_dropped_by_verification: <n>
findings_filtered_by_known_non_issues: <n>
---

# Audit — <scope>

## Mechanical pass results

<table>

## Findings

Per finding: ID · Severity (BLOCKER | HIGH | MEDIUM | LOW | NIT)
· Source (P<n> or P<n>+P<m>) · File:line · Finding (one
sentence) · Evidence · Verification reasoning · Confidence
(post-verification).

## Questions for human

Per question: ID · Question · Evidence · Why this needs human
input · Verification confidence (the sub-80 that routed it here).

## Reopen candidates

`_known-non-issues.md` entries that warrant reconsideration.
Note the NI-NNN, the original revisit trigger, and what changed.
User has three triage paths per reopened entry: withdraw, update
revisit trigger, or trim the underlying code. Empty if none.

## What NOT to fix (this audit)

Items intentional per SPEC.md, CLAUDE.md, or an ADR — with
citation. Also lists findings dropped by verification as
intentional design (distinguishing them from findings dropped
because they were wrong).

## Suggested fix order

Finding IDs ordered by dependency, not severity alone.

## Summary

Counts by severity; questions; reopen; dropped by verification;
suppressed by registry.
```

### Step 8: Print and stop

Print only the file path and the summary table. Note how many
findings were dropped during verification and how many were
suppressed by the registry. Do not echo the full report. Stop.

## Edge cases

- **No commits in scope** → stop and report.
- **`docs/audits/` does not exist** → stop and direct the user
  to scaffold per `docs/audits/README.md`.
- **Mechanical pass fails** → capture the failure, note it, run
  passes that don't depend on it.
- **A custom subagent fails** → 1–2 fail: note in `passes_run`
  frontmatter (list only completed passes) and proceed. 3+ fail:
  stop.
- **Verification dropped everything** → write the audit with
  zero Findings plus full mechanical results and any Questions.
  The file is the durable record that the audit ran.
- **Audit file already exists for today (same slug)** → append
  numeric suffix (`-2`, `-3`).
- **Hook blocks the audit-file write** → should not happen
  (existence-check hook allows new files). If it does, stop and
  report — misconfigured.
- **Finding cites a symbol present in workspace but not in the
  installed library version** → P6 catches this. If P6 didn't
  run, downgrade confidence on any finding referencing external
  library surface.

## Performance note

6 custom subagents + N verification subagents per audit. For
typical slice-sized scopes, expect 8–20 subagent invocations
total. Wall time is multi-minute, scaling with subagent count
and verification surface. If performance becomes a problem, the
first thing to drop is verification on LOW and NIT findings
(keep verification for BLOCKER / HIGH / MEDIUM; LOW and NIT
carry their initial confidence). The 80 floor still applies.

## What this skill is not

- Not a fix tool. Use `apply-audit-fixes` against the fix-brief.
- Not a triage tool. Triage happens in the duly_noted Claude
  project, where findings become fix-now / defer / accept-as-
  wont-fix and a committed fix-brief.
- Not a wont-fix promotion tool. Use `promote-to-non-issue`.
- The same skill handles re-audits — file naming distinguishes
  them per `docs/audits/README.md` (`<reaudit-date>-<original-
  slug>-fix-reaudit.md`).
