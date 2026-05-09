# 0003. Postgres as queue

Date: 2026-05-05
Status: Accepted

## Context

The pipeline needs a queue for meeting jobs flowing through the state
machine `discovered → pending → extracting → transcribing → segmenting →
summarizing → review → published`. The worker picks up rows whose
`meetings.status` matches the next stage and advances them. Throughput at
v1 is bounded: ~6 meetings/day at the Scale-1 ceiling, with a single
selectboard meeting roughly monthly per board.

Adding a dedicated queue service would mean another vendor, another set
of secrets, and a second source of truth for job state alongside the
Postgres rows that already record meeting metadata.

## Considered options

- **Postgres polling on `meetings.status`** — `SELECT … FOR UPDATE SKIP
LOCKED` followed by an atomic `UPDATE`. Single source of truth; no
  extra vendor.
- **Cloudflare Queues** — keeps everything on Cloudflare but introduces
  a second job-state surface and ties queue semantics to Workers.
- **Upstash Redis** — fast, but a second store and a second monthly bill.
- **AWS SQS** — adds an AWS dependency the project otherwise has none of.

## Decision

Use Postgres as the queue. The worker polls `meetings.status` with
`SELECT … FOR UPDATE SKIP LOCKED` and atomically advances state.

## Consequences

- Job state and meeting state are the same row; no synchronization
  surface.
- No extra vendor, no extra bill, no extra secret.
- Polling cadence is the lower bound on latency. Acceptable at v1
  meeting volume; becomes a problem only at multi-tenant scale.
- Revisit: if concurrent meeting throughput exceeds ~10/hr, or if
  multi-publication tenancy requires fairness across tenants.
