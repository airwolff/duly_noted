# 0006. Cloudflare/Render git auto-deploy + GitHub Actions for PR checks

Date: 2026-05-05
Status: Accepted

## Context

Three deployable surfaces — Cloudflare Pages, Render Background Worker,
Render Cron Job — all sit downstream of the same `main` branch. Cloudflare
and Render each ship native git integrations that auto-deploy on push.
GitHub Actions is also available and could drive deploys directly. The
decision is what owns the deploy verb.

PR-time checks (typecheck, lint, test) are a separate question and have
to live on GitHub Actions regardless, since neither Cloudflare nor Render
runs PR-blocking checks themselves. Migrations also need to run from
somewhere on merge to `main`.

## Considered options

- **Native git integrations + GitHub Actions for PR checks and
  migrations** — deploys triggered by Cloudflare/Render watching `main`;
  GitHub Actions runs typecheck/lint/test on PRs and the Supabase
  migration on merge.
- **Manual deploy** — push a button per surface per release. Fine for
  one app, painful for three.
- **Full GitHub-Actions-driven deploy** — actions push to Cloudflare and
  Render via APIs. Adds deploy-credential surface and replicates work
  the native integrations already do.

## Decision

Use native git integrations on Cloudflare Pages and Render for deploys.
Use GitHub Actions for PR checks (typecheck, lint, test) and for the
Supabase migration job on merge to `main`.

## Consequences

- The deploy path is the path of least surprise: push to `main`,
  Cloudflare and Render each redeploy independently.
- No Cloudflare or Render API credentials live in GitHub Secrets.
- Render redeploys both worker and cron on any push regardless of
  whether the relevant paths changed; acceptable at v1 because Render
  Starter bills monthly, not per-deploy.
- Revisit: when per-environment promotion (staging → prod) becomes
  necessary, the native integrations stop being sufficient.
