# Build Cycle — duly_noted

How work moves through this project: where each step happens, what
artifacts get created, and how slices stay coherent across sessions.

## Two surfaces, distinct roles

**Claude Code** (terminal, inside the repo)
- All code writes, audits, file-system operations
- Source of truth for the codebase
- Fresh sessions for distinct cognitive jobs (build, audit, fix)

**Claude Project** (browser, the `duly_noted` project)
- Planning, spec drafting, audit triage, research synthesis
- Persistent knowledge base of research docs and current state
- No direct repo writes — outputs come back via paste or via Claude
  Code applying specific edits
- Cross-session reasoning that would compress out in a single
  Claude Code conversation

The split exists because Claude Code is the only surface with live
filesystem access, and this project is the only surface with the
persistent KB and the bandwidth for longer planning discussions.

## The slice cycle

Each meaningful unit of work — a "slice" like the spine scaffold,
the ingestion pipeline, the search layer — moves through these steps:

1. **Plan** (here)
   Discuss scope using current SPEC.md, CLAUDE.md, prior audits,
   _known-non-issues.md, the research KB docs, and any specific
   ADR being revisited. Output: a description of what Slice N
   covers and any SPEC.md, CLAUDE.md, or ADR amendments it
   requires.

2. **Update SPEC.md and CLAUDE.md if needed**
   Copy amended content from this project to the repo, or have
   Claude Code apply specific edits. Commit before starting build.

3. **Build** (Claude Code)
   Implement the slice against the updated spec. Single session
   preferred; use `claude --resume` if interrupted. Plan mode
   first for non-trivial slices.

4. **Audit** (Claude Code, fresh session)
   Run the audit prompt. Read-only on source; writes exactly one
   file to `docs/audits/<YYYY-MM-DD>-<slug>.md`. Reads
   `_known-non-issues.md` first to skip already-accepted items.

5. **Triage** (here)
   Read the audit. For each finding decide: fix now / defer /
   accept as wont-fix. Questions-for-human get answered too —
   often they graduate to wont-fix entries with reasoning.

6. **Promote accepted wont-fixes** (Claude Code)
   Run the promotion prompt. Appends entries to
   `_known-non-issues.md` with stable NI-NNN IDs and citations
   back to the originating audit. Append-only; never edits past
   entries.

7. **Fix** (Claude Code, fresh session)
   Implement the triaged fixes. Do NOT reuse the audit session —
   cold context is the whole point of having an auditor and a
   fixer be different cognitive instances.

8. **Re-audit** (Claude Code, optional but recommended for spine)
   Verify fixes landed correctly and didn't introduce regressions.
   Mandatory for foundational work (schema, auth, ingestion);
   optional for smaller slices.

9. **Begin next slice** — back to step 1.

## Artifacts and where they live

| Artifact | Location | Purpose | Update cadence |
|---|---|---|---|
| `SPEC.md` | repo root | Active architecture, schema state, open items | Amended per slice when scope adds new concepts |
| `CLAUDE.md` | repo root + per-dir | Rules audits check against | Amended when conventions change |
| `docs/audits/<date>-<slug>.md` | per audit | Findings from one audit run | Append-only; one file per audit |
| `docs/audits/_known-non-issues.md` | one file | Registry of accepted wont-fixes | Append-only; entries get promoted out |
| `docs/audits/README.md` | one file | Audit directory convention | Rare updates |
| `docs/adr/NNNN-<slug>.md` | one per locked decision | Locked architectural decisions, MADR format | One file per decision; superseded, never edited |
| `docs/workflows/build-cycle.md` | this file | The workflow itself | Updated when the workflow changes |

## When SPEC.md changes

`SPEC.md` holds active architecture, schema state, and open items.
Locked architectural decisions live in `docs/adr/` (one file per
decision, MADR format) and are referenced from `SPEC.md` by pointer,
not duplicated in it.

Amend SPEC.md when:
- A new slice introduces concepts the spec didn't cover
- A wont-fix in `_known-non-issues.md` becomes a permanent stance
  and gets promoted into the spec
- An ADR is accepted and the spec needs a pointer to it
- A bug fix reveals the spec was wrong

Do NOT amend SPEC.md for:
- Routine bug fixes that align with existing spec
- Refactors that don't change behavior
- Internal implementation details
- New locked decisions — those become a new ADR under `docs/adr/`,
  with `SPEC.md` updated only if the decision changes active
  architecture or schema state.

## When CLAUDE.md changes

Amend CLAUDE.md when:
- A new convention is adopted (import aliases, file size limits,
  test patterns)
- An audit reveals an unwritten rule the codebase already follows
- A wont-fix represents a recurring pattern worth codifying

## Promotion paths out of `_known-non-issues.md`

Wont-fix entries are temporary acceptances, not permanent design.
When an entry stops being temporary:

- **To `SPEC.md`** — the entry represents a permanent product or
  architecture stance (e.g. "no automatic worker retry — manual
  reset only"). Update the spec, change the registry entry's
  Status to `Promoted (see SPEC.md#section)`, keep the entry.
- **To `docs/adr/NNNN-<slug>.md`** — the entry is an explicit
  architectural decision with tradeoffs worth preserving. Once the
  ADR is accepted, change Status to `Promoted (see ADR-NNNN)`.
- **Withdrawn** — circumstances changed and the item should be
  fixed after all. Change Status to `Withdrawn`. The next audit
  will re-raise it as a finding.

Never delete registry entries. The history is the value.

## Project knowledge ingestion

For this Claude project's KB, pull in:
- Current `SPEC.md`
- Current `CLAUDE.md`
- Most recent audit file
- `_known-non-issues.md` (always)
- This file (one-time)
- `docs/audits/README.md` (one-time)
- Research KB docs (the `kb_*.xml` files)

Do NOT pull in:
- Older audit files (git history is enough; old findings either
  got fixed or got promoted to the registry)
- Source code (too noisy; Claude Code handles that surface)
- Generated build artifacts, lockfiles, vendored dependencies

Re-sync the KB after each audit and any SPEC.md amendment.

## How updates flow back to the repo

This Claude project cannot write to the repo. Two paths:

**Manual paste** — copy updated content from this conversation,
save to the appropriate file, commit. Use for substantial
revisions where you want to read the diff yourself before
committing.

**Claude Code mediated** — ask Claude Code to apply specific
edits ("update SPEC.md section X to read: …"). Faster for small
targeted changes; riskier for large rewrites because the model
might miss context.

When in doubt, paste manually for SPEC.md and CLAUDE.md changes.
Use Claude Code for code changes always.

## Order of operations recap

```
plan (here)
  → update SPEC/CLAUDE if needed
  → build slice (Claude Code)
  → audit (Claude Code, fresh session)
  → triage (here)
  → promote wont-fixes (Claude Code)
  → fix (Claude Code, fresh session)
  → re-audit (Claude Code, optional)
  → plan next slice (here)
  → ...
```

## Related docs

- `docs/audits/README.md` — audit directory convention (narrow
  scope; this file is the broad workflow)
- `SPEC.md` — the spec audits check compliance against
- `CLAUDE.md` — the rules audits check compliance against
- `docs/adr/` — architecture decision records, when added
