# 0013. Hourly cron schedule

Date: 2026-05-07
Status: Accepted

## Context

`apps/worker-cron` polls each board's YouTube uploads playlist for new
videos. Lincolnville Select Board meets monthly; the realistic upload
cadence is one new video every few weeks. The cron schedule sets the
upper bound on detection latency for a newly uploaded meeting.

Each board scan costs a fixed 2 quota units against the YouTube Data
API daily quota of 10,000. With a single board, hourly polling is
~48 units/day — well within budget even at multi-board scale.

## Considered options

- **Hourly (`0 * * * *`)** — predictable cadence, ~48 quota units/day
  per board, latency upper bound of one hour from upload to discovery.
- **Every 5 minutes** — overkill for a monthly meeting body; would
  consume meaningful YouTube quota at multi-board scale.
- **Daily** — too slow if a meeting is uploaded the morning after; the
  ASR + segmentation pipeline can take an hour by itself.
- **Per-meeting-window** — schedule polling around expected meeting
  dates; brittle and adds calendar logic with no clear win.

## Decision

Cron runs hourly on the `0 * * * *` schedule across all boards.

## Consequences

- Latency from upload to discovery is at most one hour.
- YouTube quota usage is trivial (~48 units/day per board against a
  10,000-unit daily budget).
- Render Cron Job pricing is per-execution-minute; hourly invocations
  fit the ~$1/mo budget line cleanly.
- Revisit: when ingest volume across all tenants makes hourly polling
  visibly wasteful.
