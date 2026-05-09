# 0015. Maine marker taxonomy

Date: 2026-05-08
Status: Accepted

## Context

Each segment carries a `marker_type` that classifies what kind of
moment opens the chapter. The taxonomy is filterable in the reader UI
and load-bearing for FOAA-relevant queries (votes, public comment).

Oberoi's NYC taxonomy (`QUESTION`, `TESTIMONY`, `REMARKS`, `PROCEDURE`)
is shaped around City Council hearings, which differ structurally from
Maine selectboard meetings: more public testimony, fewer named agenda
items, no recorded votes per agenda item. A Maine selectboard meeting
runs an agenda with explicit votes per item, scattered public comment,
and procedural framing (call to order, executive session entry/exit,
adjournment).

## Considered options

- **Maine taxonomy: `AGENDA_ITEM`, `PUBLIC_COMMENT`, `DISCUSSION`,
  `VOTE`, `PROCEDURE`** — five marker types matched to Maine
  selectboard structure. FOAA-relevant moments (`VOTE`,
  `PUBLIC_COMMENT`) are isolated by category.
- **Oberoi NYC taxonomy** — fits NYC City Council; misses the
  per-item-vote shape of selectboard procedure.
- **Free-form LLM-chosen labels** — drift across boards; not filterable
  in the reader UI without post-hoc normalization.

## Decision

Use the five-element Maine taxonomy. Per-board tunability of the
taxonomy is deferred to schema pass 2.

## Consequences

- The reader UI can filter on `VOTE` or `PUBLIC_COMMENT` directly;
  these categories don't drift across meetings.
- Adding a board with materially different structure (school
  committee, planning board with site walks) may force a per-board
  taxonomy override. Revisit then.
- The DB enforces the taxonomy via a `CHECK (marker_type in (…))`
  constraint on `segments` so the LLM cannot drift labels silently.
- Revisit: when a board with a materially different structure
  onboards.
