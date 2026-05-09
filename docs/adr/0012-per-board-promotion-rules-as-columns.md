# 0012. Per-board promotion rules as columns on `boards`

Date: 2026-05-07
Status: Accepted

## Context

`apps/worker-cron` discovers new YouTube uploads and inserts rows at
`status = 'discovered'`. A row gets auto-promoted to `pending` if its
title matches a board-specific pattern and its duration meets a
board-specific minimum. For Lincolnville Select Board the rule is
`title ~* 'select board' AND duration_seconds >= 600`.

The schema is mandated tenant-ready from day one. The first board is
Lincolnville Select Board; the second is plausibly Lincolnville Town
Meeting or Planning Board, possibly on the same channel. The promotion
rule has to live somewhere — either hardcoded in the cron and
refactored when board #2 lands, or as columns on `boards` from the
start.

## Considered options

- **`title_pattern` and `min_duration_seconds` columns on `boards`** —
  cron reads them per board; new boards configure their own rules
  without code changes.
- **Hardcoded rule in the cron, refactor when board #2 lands** —
  cheaper today, more work later; contradicts the tenant-ready posture.

## Decision

Per-board promotion rules live as columns on `boards`:

- `title_pattern text` (Postgres `~*` regex)
- `min_duration_seconds int default 0`

Cron reads them per board scan and promotes rows that match.

## Consequences

- Adding a new board is data-only: insert a `boards` row with the
  channel ID and promotion rule.
- The schema already carries the per-board configuration the moment a
  second board onboards.
- Pattern complexity is bounded by Postgres regex; a board needing
  fundamentally different logic would need a code path, not a config
  change.
- Revisit: never expected.
