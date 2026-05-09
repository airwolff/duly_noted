# 0002. Cloudflare Pages for web

Date: 2026-05-05
Status: Accepted

## Context

`apps/web` is the Next.js (App Router) reader and admin UI for Duly Noted.
It is stateless: no webhook receivers, no long-running compute. Webhook
receivers run on Supabase Edge Functions; the pipeline runs on Render. The
hosting choice for the web surface drives both the recurring cost floor
and ToS compliance for a commercial newsroom product.

The project runs on a tight fixed budget. Reducing recurring spend on the
web surface frees room for the variable lines (ASR, LLM).

## Considered options

- **Cloudflare Pages** — Free tier permits commercial use. Native git
  integration with preview deploys on PRs. Supports Next.js App Router
  via `@cloudflare/next-on-pages`.
- **Vercel** — Smoothest Next.js DX, but Hobby tier ToS forbids commercial
  use and Pro is $20/mo (~$240/yr).

## Decision

Host `apps/web` on Cloudflare Pages, deployed via `@cloudflare/next-on-pages`
with native git integration on `main`.

## Consequences

- ~$240/yr saved versus Vercel Pro.
- Cloudflare Pages cannot run long-lived processes; this reinforces the
  existing split where webhooks live on Supabase Edge Functions and the
  pipeline lives on Render.
- No Vercel-specific features (Edge Middleware vendor extensions, Vercel
  KV) used or planned.
- Revisit: never expected at v1 scale.
