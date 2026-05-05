# 0001. Render for background worker and cron

Date: 2026-05-05
Status: Accepted

## Context

Duly Noted needs a long-running process to poll the meetings queue, submit
jobs to the ASR vendor, run LLM segmentation, and write results to Postgres.
Cloudflare Pages (the host for the web app) is request/response only — it
cannot run long-lived processes. We need a separate runtime.

The project budget is small. Workload is light: a single solo newsroom,
on the order of hundreds of meeting-hours per month.

## Considered options

- **Render Background Worker + Cron Job** — long-running Node process plus
  separate scheduled job, $7/mo each on Starter, simple GitHub deploy,
  Blueprint-as-code.
- **Fly.io Machines** — pay-per-use, more flexible, but operational
  overhead is higher and cost ceiling is harder to predict at low scale.
- **Cloudflare Workers + Durable Objects + Cron Triggers** — keeps
  everything on Cloudflare but Durable Objects don't fit the
  "long-running poll loop" pattern, and CPU-time billing is unpredictable
  for LLM/ASR workloads.
- **Self-hosted on a Hetzner box** — cheapest at scale but adds
  sysadmin work that's not the value-add of this project.

## Decision

Render Background Worker (Starter, $7/mo) for `apps/worker`, plus
Render Cron Job for `apps/worker-cron`. Both deployed via `render.yaml`
Blueprint at the repo root.

## Consequences

- Three infrastructure dashboards to manage: Cloudflare, Render, Supabase.
  Acceptable for solo dev; revisit if team grows.
- Worker and cron are colocated in `oregon`; latency to Supabase (also US)
  is fine.
- Migration path if we outgrow Render Starter: standard Node service,
  deployable to any container host. No Render-specific lock-in.
- Two paid Render services (~$14/mo) on top of Cloudflare Pages (free at
  this scale) and Supabase Pro ($25/mo). Total infra floor ~$39/mo before
  vendor APIs.
