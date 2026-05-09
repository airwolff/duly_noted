# 0005. Dashlane as secrets source of truth

Date: 2026-05-05
Status: Accepted

## Context

Duly Noted has roughly ten production secrets spread across Cloudflare
Pages, Render Worker, Render Cron, and Supabase Edge Functions
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`,
`ASR_VENDOR_API_KEY`, `ANTHROPIC_API_KEY`, `ASR_WEBHOOK_SECRET`, plus
the `NEXT_PUBLIC_*` pair). The project is solo-developer; rotation
cadence is on the order of quarters. There is no shared team vault and
no compliance regime that would force a centralized secrets manager.

The choice is what holds the canonical version of each secret. Whatever
the source is, secrets get pasted manually into Cloudflare, Render, and
Supabase dashboards on rotation.

## Considered options

- **Dashlane** — already used as a personal vault. No additional vendor.
  Manual sync to dashboards on change.
- **GitHub Secrets only** — no off-repo source of truth; lost if a
  dashboard is reset or the GitHub org changes.
- **SOPS / age-encrypted in repo** — encrypted-in-repo overkill for a
  solo dev with ~10 keys; adds a tooling surface.
- **Doppler / Infisical** — additional SaaS vendor, additional bill,
  additional auth flow, no upside at this scale.

## Decision

Dashlane is the source of truth for all production secrets. No secrets
in the repo. `.env.example` is checked in with placeholders and kept in
sync as new keys land.

## Consequences

- Rotation is manual: edit Dashlane, then paste into Cloudflare, Render,
  and Supabase dashboards. Auditable but not automated.
- No additional vendor, no additional bill.
- Revisit: when the team grows beyond one developer, or rotation cadence
  exceeds quarterly.
