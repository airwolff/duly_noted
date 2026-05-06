# Audits

Post-session audits of `duly_noted` and the registry of accepted
wont-fixes. This directory is the operative record of code-quality
findings, separate from `SPEC.md` (the spec) and `docs/adr/` (when
added, for architecture decisions).

This file documents the audit directory convention. For the broader
build cycle (plan → build → audit → triage → promote → fix → re-audit),
see `docs/workflows/build-cycle.md`.

## Why this exists

Claude Code sessions can fabricate paths, drift from `CLAUDE.md`
rules, leave half-finished approaches in place, and produce
migrations that work locally but fail on redeploy. A fresh session
acting as a cold reviewer catches these. Persisting the findings
lets the next session — human or AI — skip what's already been
decided and focus on what's new.

## Layout

- `YYYY-MM-DD-<scope-slug>.md` — dated audit reports. Append-only.
  Never edit a past audit; produce a new one if circumstances change.
- `_known-non-issues.md` — registry of findings explicitly accepted
  as wont-fix. Live document, append-only entries with stable IDs.
- `README.md` — this file.

## The cycle

1. **Audit.** After a meaningful slice of work, start a fresh Claude
   Code session and run the audit prompt (read-only on source,
   writes one file to this directory). The audit reads
   `_known-non-issues.md` first and skips items already accepted.
2. **Triage.** Read the audit. For each finding, decide: fix now,
   defer, or accept as wont-fix.
3. **Promote.** Accepted wont-fixes get appended to
   `_known-non-issues.md` with a citation back to the originating
   audit. Use the promotion prompt (see below).
4. **Fix.** Run a separate Claude Code session to implement
   approved fixes. Never let the audit session also fix — that
   collapses the cold-reviewer benefit.
5. **Re-audit.** After fixes land, re-audit the same scope to
   verify and catch regressions.

This is the audit-triage-fix loop only. The full slice cycle (which
wraps this loop with planning and spec amendments) is in
`docs/workflows/build-cycle.md`.

## Filename conventions

- Audits: `YYYY-MM-DD-<scope-slug>.md`
  Examples: `2026-05-05-spine-scaffold.md`,
  `2026-06-12-ingestion-pipeline.md`
- Slug describes the scope, not the verdict. Date carries the
  ordering; don't number them.

## Findings vs questions

Audits separate two buckets:

- **Findings** are defects verifiable against `SPEC.md`, `CLAUDE.md`,
  or external ground truth. Confidence floor 80.
- **Questions for human** are items where the code is internally
  consistent but the intent is unclear. The audit cannot resolve
  these alone.

A "question" that you answer "yes, deferred to Slice N" typically
graduates to a `_known-non-issues.md` entry.

## Promotion paths out of `_known-non-issues.md`

Wont-fix entries are temporary acceptances, not permanent design.
When an entry stops being temporary:

- **Promote to `SPEC.md`** when it represents a permanent product
  or architecture stance (e.g., "no automatic worker retry — manual
  reset only"). Update the spec, change the entry's Status to
  `Promoted (see SPEC.md#section)`, keep the entry.
- **Promote to `docs/adr/NNNN-<slug>.md`** when it's an explicit
  architectural decision with tradeoffs worth preserving. Once the
  ADR is accepted, change Status to `Promoted (see ADR-NNNN)`,
  keep the entry.
- **Withdraw** if circumstances changed and the item should be
  fixed after all. Change Status to `Withdrawn`. The next audit
  will re-raise it as a fresh finding.

Never delete registry entries. The history is the value.

## Project knowledge ingestion

For Claude Projects (browser-side analysis), ingest:

- The most recent audit file
- `_known-non-issues.md` (always)
- This README (one-time)

Do NOT ingest the full audit history. Older audits stay in git for
reference but pollute the active KB context.

## Related

- `CLAUDE.md` — rules audits check compliance against
- `SPEC.md` — spec audits check compliance against
- `docs/adr/` — when added, the ADR log
