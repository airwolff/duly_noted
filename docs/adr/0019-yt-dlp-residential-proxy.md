# 0019. yt-dlp residential proxy (ProxyWing)

Date: 2026-05-09
Status: Accepted

## Context

After Slice 2 went to production, the Render-hosted worker began failing
every promoted Select Board meeting at the audio-extraction step.
yt-dlp logs showed HTTP 429 plus `Sign in to confirm you're not a bot`
on every request. The Slice 2 smoke had run from a residential IP and
never surfaced the issue: YouTube's anti-bot system fingerprints
data-center IP ranges (which Render's egress falls within) and refuses
automated extraction from them.

Without a working extraction path, the worker can't park rows at
`transcribing` and the entire pipeline stops at `pending`. The fix has
to make yt-dlp egress look like a residential client to YouTube.

The same incident also surfaced two adjacent problems in the worker
container: it lacked Deno (needed for some local invocations of
Edge-Function-adjacent tooling) and the pinned yt-dlp version was old
enough that some of the standard cookies-and-headers workarounds
no longer applied. Both were addressed alongside the proxy work in
the same image bump.

## Considered options

- **ProxyWing residential proxy** — single gateway URL, IP rotation
  per request, $2.50/GB list ($1.63 with WING35 promo over 9 months).
  Bandwidth doesn't expire; one purchase covers >1 year of v1 capacity.
- **Cookies file from a logged-in browser, rotated weekly** — manual
  rotation burden; brittle; multiple extraction methods documented as
  failing even with cookies once YouTube fingerprints the IP.
- **Datacenter proxy** — YouTube blocks datacenter proxy ranges as
  effectively as direct datacenter IPs; same failure mode as today.
- **Bright Data Web Unlocker** — solves the problem but enterprise
  pricing is overkill for ~24 meetings/year of extraction.
- **Self-hosted residential proxy on home network** — architectural
  regression; introduces an operational dependency on a residential
  network the project shouldn't take on.

## Decision

Route yt-dlp egress through ProxyWing's residential gateway. Bump
yt-dlp to current stable in the same image change. Install Deno in the
worker container alongside the proxy work. Worker config reads the
proxy URL from a secret and passes `--proxy` to yt-dlp.

## Consequences

- ~$1.63 one-time on the WING35 promo for >1 year of v1 capacity at
  ~720 MB expected annual usage. Bandwidth doesn't expire.
- Failure modes: provider down, bandwidth exhausted, or pool IPs
  blocked by YouTube → `meetings.status = 'failed'` per the standard
  extraction-failure handling, manual reset after the issue is
  resolved. No new automatic retry surface.
- Worker container now carries Deno; image size grows modestly.
- Revisit: provider unreliability surfaces in production; multi-tenant
  scale justifies enterprise tier (Bright Data); or a non-proxy path
  emerges (e.g., direct YouTube partnership, alternative video host).
