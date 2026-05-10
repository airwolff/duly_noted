---
audit: 2026-05-10-slice-4-summarization-fix-reaudit.md
date: 2026-05-10
triage_outcome: 1 fix-now (docs), 0 defer, 0 wont-fix
---

# Fix brief — Slice 4 summarization fix-reaudit

## SPEC.md updates

### F1 — Propagate `summarizing → published` flow to upstream sections

**Source.** SPEC §Stage 6 was refined in commit `1a8a895` to land on `summarizing → published` directly (line 295: "no row sits in `review` at v1"). Three upstream sections still describe the legacy `summarizing → review → published` flow. (The third instance, at `SPEC.md:546`, was surfaced during fix application; the audit had enumerated only the first two. Treated as an enumeration error within F1's stated scope, not a separate finding.)

**Edits.**

1. `SPEC.md:26` — replace the second sentence of the worker bullet with:

   > Picks up `summarizing` rows, runs the meeting-summary pass, auto-advances `summarizing → published`. The `review` enum slot is reserved for a future operator review UI slice (see Backlog B4); no row sits in `review` at v1.

2. `SPEC.md:119` — replace the closure with:

   > ~~Operator review step inclusion sets the `review` state semantics.~~ — closed in Stage 6 below: v1 auto-advances `summarizing → published`. Operator review gate deferred (Backlog B4); the `review` state slot is preserved in the enum for that slice.

3. `SPEC.md:546` — rewrite the trailing clause of the Backlog B4 §What bullet to reference the as-built direct transition, matching the §Stage 6 source-of-truth at `SPEC.md:295`. Replace:

   > Until this lands, the worker auto-advances `summarizing → review → published` in Stage 6 with no human gate.

   with:

   > Until this lands, the worker auto-advances `summarizing → published` directly in Stage 6 with no human gate; no row sits in `review` at v1.

**Verification.** Grep `SPEC.md` for `summarizing → review → published` and confirm only the full state-machine diagram at line 19 remains (the diagram correctly enumerates all enum states including the unused-at-v1 `review` slot; it is not a transition assertion). No other tests affected (docs-only).

## Convention docs updates

### Q1 — Record erratum-revisit trigger in audits README

**Source.** NI-016 reasoning prose contains a state-name transcription error (`'segmenting_inflight'` should be `'chaptering'`). Triage decided to leave the entry as-is per the registry's never-edit convention; the cross-reference between source audit (correctly citing `chaptering`), this re-audit (quoting the registry verbatim and noting the error), and the registry entry itself produces a durable correction without registry churn.

**Edit.**

`docs/audits/README.md` — append the "Erratum convention" subsection (text drafted in triage) under the existing "Known non-issues registry" section.

**Verification.** No code or schema impact. Convention amendment only.

## Code fixes

None.

## CLAUDE.md updates

None.

## ADR updates

None.

## Wont-fix items

None.
