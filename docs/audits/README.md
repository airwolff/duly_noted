# Audits

This directory holds compliance audits of the duly_noted codebase
and the artifacts that capture how their findings were resolved.

## File types

### Source audits

`<YYYY-MM-DD>-<slug>.md`

A read-only record of one audit run by Claude Code. Lists findings,
questions for human, reopen candidates, and what NOT to fix. The
audit file is never modified after the audit session writes it; any
human decisions about its findings live in the fix-brief and the
known-non-issues registry, not in the audit file itself.

Examples:
- `2026-05-09-slice-3-segmentation.md`
- `2026-05-10-slice-3-fix-reaudit.md`

### Fix briefs

`<audit-stem>-fix-brief.md`

Triage outcome from the Claude project: a list of fix-now items
from the source audit, organized by work stream (code fixes vs
SPEC updates vs other) with file:line references and concrete
CC-ready instructions per item. Brief content is append-only after
commit — existing triage decisions are never rewritten, but
retroactive convention updates (e.g., adding a mandatory section
type that postdates the brief) may be applied. The brief forms the
paper trail linking an audit's findings to the human's decisions.

A fix-brief is committed for every triaged audit, even if every
item was triaged as wont-fix — in that case the brief contains a
header noting all items were accepted as wont-fix and pointing to
the resulting NI entries. The 1:1 audit-to-brief mapping makes the
directory listing self-describing.

Examples:
- `2026-05-09-slice-3-segmentation-fix-brief.md`
- `2026-05-10-slice-3-fix-reaudit-fix-brief.md`

### Known non-issues registry

`_known-non-issues.md`

Append-only registry of accepted wont-fixes. Each entry has a
stable NI-NNN ID, reasoning, and a revisit trigger. Entries are
never edited or deleted; they are promoted out (to `SPEC.md` or
to an ADR under `docs/adr/`) or marked `Withdrawn` when
circumstances change. Audits read this file first to skip
already-accepted items.

## Wont-fix briefs are not committed

Triage in the Claude project produces wont-fix entries with
reasoning + revisit triggers. These are pasted directly into the
`promote-to-non-issue` skill in Claude Code, which appends them
to `_known-non-issues.md` with NI-NNN IDs and citations back to
the originating audit. After promotion, the brief is redundant —
the registry holds the same content with stable IDs and proper
citations. Wont-fix briefs therefore live only in the triage
conversation and the resulting registry entries; they do not
land in the repo.

The fix-brief is the durable record of what was triaged as
wont-fix in a given audit cycle: each fix-brief includes a
"Wont-fix items (promoted to NI-NNN through NI-MMM)" section
listing the audit IDs that were accepted, with pointers to the
resulting registry entries. Anyone reading the audit + fix-brief
together gets the full triage outcome without consulting the
transient wont-fix brief.

## Lifecycle

```
audit (CC session writes <date>-<slug>.md)
  → triage (Claude project produces fix-brief + transient wont-fix list)
  → promote wont-fixes (CC: wont-fix list → _known-non-issues.md)
  → commit fix-brief alongside source audit
  → fix (CC session uses fix-brief)
  → optional re-audit (CC writes <date>-<original-slug>-fix-reaudit.md)
```

Re-audit naming: for verification of a fix-brief application,
use `<reaudit-date>-<original-slug>-fix-reaudit.md`. For full
re-runs of an earlier audit (different scope, same slice), use a
fresh `<date>-<slug>.md` with a different slug.

## Related docs

- `docs/workflows/build-cycle.md` — broad workflow that this
  directory's conventions implement
- `SPEC.md` — the spec audits check compliance against
- `CLAUDE.md` — the rules audits check compliance against
- `docs/adr/` — architecture decision records (locked decisions
  that audits also check against)
