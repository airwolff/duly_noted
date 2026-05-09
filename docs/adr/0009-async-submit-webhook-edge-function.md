# 0009. Async submit + webhook callback to Supabase Edge Function

Date: 2026-05-07
Status: Accepted

## Context

ASR jobs run for minutes to hours. The worker has to kick the job off
and the system has to learn when it's done. Two general shapes: poll
the vendor's `GET /transcript/{id}` from the worker, or subscribe to a
webhook and let the vendor call us.

If we go async-with-webhook, the receiver needs to hold both
`ASR_VENDOR_API_KEY` (to fetch the completed transcript) and
`SUPABASE_SERVICE_ROLE_KEY` (to write the artifact and advance state).
The web app deliberately holds neither (anon key only, RLS-protected).
Supabase Edge Functions hold both as built-ins. That makes the Edge
Function the architecturally correct receiver.

## Considered options

- **Async submit + webhook to Supabase Edge Function** — vendor calls
  `https://{project-ref}.supabase.co/functions/v1/asr-webhook` with an
  auth header verified against `ASR_WEBHOOK_SECRET`.
- **Polling from the worker** — wastes worker cycles for a job that
  takes minutes to hours; worker must run idempotent checks on every
  poll.
- **Webhook into `apps/web`** — would force the web app to hold both
  vendor key and service role; violates the secret-isolation invariant
  in CLAUDE.md §6.

## Decision

Async submit from `apps/worker` with `webhook_url` pointing at
`supabase/functions/asr-webhook`. The Edge Function verifies the
`X-DulyNoted-Webhook` header before any side effect, fetches the full
transcript JSON, writes it to Storage, and advances state to
`segmenting`.

## Consequences

- The Edge Function is the only surface holding `ASR_VENDOR_API_KEY`
  and `SUPABASE_SERVICE_ROLE_KEY` simultaneously; the web app stays on
  anon-only.
- Worker cycles are not consumed by polling; the worker parks the row
  at `transcribing` and picks up its next job.
- Webhook auth, idempotency under duplicate delivery, and the
  conditional `WHERE status = 'transcribing'` update are all
  load-bearing for correctness; codified in SPEC.md Stage 2.
- Revisit: never expected at v1 scale.
