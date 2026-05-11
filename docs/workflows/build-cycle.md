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
   Discuss scope using current SPEC.md (including §Backlog),
   CLAUDE.md, prior audits, _known-non-issues.md, the research KB
   docs, and any specific ADR being revisited. Output: a description
   of what Slice N covers and any SPEC.md, CLAUDE.md, or ADR
   amendments it requires.

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
   Outputs:
   - A fix-brief saved as `docs/audits/<audit-stem>-fix-brief.md`
     listing fix-now items with concrete CC-ready instructions
     (committed alongside the source audit; append-only after
     commit — existing decisions never rewritten, but retroactive
     convention updates allowed). Includes a "Wont-fix items"
     section listing the audit IDs accepted as wont-fix with
     pointers to the resulting NI-NNN registry entries, so the
     audit + fix-brief pair is self-describing.
   - A transient list of wont-fix entries (reasoning + revisit
     trigger per item) used as input to the promote-to-non-issue
     skill in step 6. Not committed; redundant once registry
     entries land.
   Don't modify the source audit file in response to triage; the
   audit stands as the auditor's findings, the fix-brief and
   registry stand as the human's decisions.

6. **Promote accepted wont-fixes** (Claude Code)
   Run the promotion prompt with the transient wont-fix list from
   triage. Appends entries to `_known-non-issues.md` with stable
   NI-NNN IDs and citations back to the originating audit.
   Append-only; never edits past entries.

7. **Fix** (Claude Code, fresh session)
   Implement the triaged fixes from the fix-brief. Do NOT reuse
   the audit session — cold context is the whole point of having
   an auditor and a fixer be different cognitive instances.

8. **Re-audit** (Claude Code, optional but recommended for spine)
   Verify fixes landed correctly and didn't introduce regressions.
   Mandatory for foundational work (schema, auth, ingestion);
   optional for smaller slices. Naming:
   `<reaudit-date>-<original-slug>-fix-reaudit.md` when verifying
   a fix-brief application.

9. **Deploy and verify** (outside Claude surfaces)
   Push commits, watch Render deploys, watch worker logs for the
   first real handler invocation against new code, spot-check
   resulting DB rows for the slice's data products. Record
   operational observations that surface deferred architectural
   work as `SPEC.md §Backlog` entries (see "Backlog and
   operational discoveries" below). Mandatory for any slice that
   ships new behavior to production; skip only for docs-only or
   test-only slices.

10. **Begin next slice** — back to step 1.

## Artifacts and where they live

| Artifact | Location | Purpose | Update cadence |
|---|---|---|---|
| `SPEC.md` | repo root | Active architecture, schema state, open items, backlog | Amended per slice when scope adds new concepts |
| `CLAUDE.md` | repo root + per-dir | Rules audits check against | Amended when conventions change |
| `docs/audits/<date>-<slug>.md` | per audit | Findings from one audit run | Append-only; one file per audit |
| `docs/audits/<audit-stem>-fix-brief.md` | per audit | Fix-now items from triage with CC-ready instructions; references the audit's wont-fix items by NI ID | Per triage; append-only after commit (retroactive convention updates allowed) |
| `docs/audits/_known-non-issues.md` | one file | Registry of accepted wont-fixes | Append-only; entries get promoted out |
| `docs/audits/README.md` | one file | Audit directory convention | Rare updates |
| `docs/adr/NNNN-<slug>.md` | one per locked decision | Locked architectural decisions, MADR format | One file per decision; superseded, never edited |
| `docs/workflows/build-cycle.md` | this file | The workflow itself | Updated when the workflow changes |

Wont-fix briefs are intentionally not committed — they exist only
during triage as transient input to the promote-to-non-issue
skill, and become redundant once `_known-non-issues.md` holds the
canonical entries with stable IDs.

## When SPEC.md changes

`SPEC.md` holds active architecture, schema state, open items, and
the backlog of deferred architectural work. Locked architectural
decisions live in `docs/adr/` (one file per decision, MADR format)
and are referenced from `SPEC.md` by pointer, not duplicated in it.

Amend SPEC.md when:
- A new slice introduces concepts the spec didn't cover
- A wont-fix in `_known-non-issues.md` becomes a permanent stance
  and gets promoted into the spec
- An ADR is accepted and the spec needs a pointer to it
- A bug fix reveals the spec was wrong
- Operational verification surfaces deferred architectural work
  → `SPEC §Backlog` entry with what/why/trigger

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

## Triage briefs

Each audit produces one committed triage brief that captures the
outcome of the triage discussion in this Claude project:

- `<audit-stem>-fix-brief.md` — fix-now items, organized by work
  stream (code fixes vs SPEC updates vs other), with file:line
  references and concrete CC-ready instructions per item. Includes
  a "Wont-fix items" section listing audit IDs accepted as
  wont-fix with pointers to the resulting NI-NNN registry entries.

The fix-brief is committed alongside the source audit. Its content
is append-only after commit — existing triage decisions are never
rewritten, but retroactive convention updates (e.g., adding a
mandatory section type that postdates the brief) may be applied.
Even if every audit item was triaged as wont-fix, the fix-brief is
committed (header + wont-fix references only) so the directory
listing remains self-describing.

The wont-fix entries themselves are produced during triage as a
transient list (reasoning + revisit trigger per item), pasted
directly into the promote-to-non-issue skill in Claude Code, and
then discarded. The canonical record is the resulting NI-NNN
entries in `_known-non-issues.md` plus the fix-brief's wont-fix
references section.

## Backlog and operational discoveries

Operational verification (step 9 of the slice cycle) surfaces work
that is real but doesn't fit anywhere else in the existing cycle:

- Not a wont-fix — there's actual implementation work to do
- Not an audit finding — emerged from running the system, not
  from reading the code
- Not current-slice fix — belongs in a later slice

These go in `SPEC.md` under a top-level `## Backlog / Slice
candidates` section. Each entry has three lines:

- **What:** the work
- **Why:** the rationale (with concrete evidence where possible —
  a row ID, a log timestamp, a measurement)
- **Trigger:** the slice or condition that should promote it out
  of the backlog and into a slice

Items are cut from the Backlog when a slice picks them up. The
git history preserves the entry; the live SPEC.md tracks only
unaddressed work.

The Backlog section is the destination for:
- Architectural insights that surfaced after a slice shipped
- Deferred follow-ups that don't rise to wont-fix status
- Cross-cutting concerns that touch multiple future slices
- Real-world data quirks that imply design changes (mislabeled
  upstream content, unavailable assets, schema constraints worth
  tightening)

Slice planning (step 1) reads the Backlog section as part of
establishing current state. Items in the Backlog don't compete
with audit findings or wont-fixes — they're a separate class of
deferred work with their own promotion path (into the next slice
that fits their trigger).

## Project knowledge ingestion

For this Claude project's KB, pull in:
- Current `SPEC.md` (includes §Backlog)
- Current `CLAUDE.md`
- Most recent audit file
- Most recent fix-brief (`<audit-stem>-fix-brief.md`)
- `_known-non-issues.md` (always)
- This file (one-time, re-sync when updated)
- `docs/audits/README.md` (one-time, re-sync when updated)
- Research KB docs (the `kb_*.xml` files)

Do NOT pull in:
- Older audit files (git history is enough; old findings either
  got fixed or got promoted to the registry)
- Older fix-briefs (same reasoning)
- Source code (too noisy; Claude Code handles that surface)
- Generated build artifacts, lockfiles, vendored dependencies

Re-sync the KB after each audit and any SPEC.md amendment.

## How updates flow back to the repo

This Claude project cannot write to the repo. Two paths:

**Manual paste** — copy updated content from this conversation,
save to the appropriate file, commit. Use for substantial
revisions where reading the diff yourself matters before
committing. Fix-briefs land via downloadable artifacts saved to
`docs/audits/`.

**Claude Code mediated** — ask Claude Code to apply specific
edits ("update SPEC.md section X to read: …"). Use for small
targeted edits (single-line replacements, named-symbol
substitutions, additive single paragraphs). CC's `str_replace`
is more precise than human copy-paste at this scale; manual
whitespace and adjacent-line errors are the dominant failure
mode for one-line edits, regardless of file type.

Default by edit size, not by file type. Small targeted → CC;
substantial revision → manual paste. Always use Claude Code for
code changes.

## Order of operations recap

```
plan (here, reads SPEC §Backlog among other inputs)
  → update SPEC/CLAUDE if needed
  → build slice (Claude Code)
  → audit (Claude Code, fresh session)
  → triage (here, produces fix-brief + transient wont-fix list)
  → promote wont-fixes (Claude Code, from transient wont-fix list)
  → fix (Claude Code, fresh session, from fix-brief)
  → re-audit (Claude Code, optional)
  → deploy + verify (outside Claude; updates SPEC §Backlog)
  → plan next slice (here)
  → ...
```

## Related docs

- `docs/audits/README.md` — audit directory convention (narrow
  scope; this file is the broad workflow)
- `SPEC.md` — the spec audits check compliance against; includes
  the §Backlog section for deferred architectural work
- `CLAUDE.md` — the rules audits check compliance against
- `docs/adr/` — architecture decision records, when added
