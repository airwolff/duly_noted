# 0011. yt-dlp via custom Dockerfile in `apps/worker`

Date: 2026-05-07
Status: Accepted

## Context

`apps/worker` needs to extract audio from YouTube videos and hand the
resulting file to AssemblyAI. The two real options for installing
yt-dlp are: a static binary baked into a custom Docker image, or a
runtime install (pip or Node wrapper) at worker boot. ffmpeg is
required alongside yt-dlp and follows whatever path yt-dlp takes.

Render Background Workers accept either a plain build command or a
custom Dockerfile. A custom image is more setup once but pins both
yt-dlp version and ffmpeg version explicitly.

## Considered options

- **Custom Dockerfile, yt-dlp as a static binary** — base on
  `node:24-bookworm-slim`; `apt-get install -y ffmpeg`; download yt-dlp
  static binary to `/usr/local/bin/yt-dlp` with version pinned via
  build arg.
- **pip install yt-dlp at runtime** — adds a Python runtime to the
  container for one binary; install runs on every cold start.
- **Node wrapper library (e.g. `youtube-dl-exec`)** — wraps yt-dlp but
  still requires the binary somewhere; saves nothing and adds a
  dependency.

## Decision

Custom Dockerfile in `apps/worker/Dockerfile`. yt-dlp installed as a
static binary, version pinned via build arg. ffmpeg version comes from
the pinned Debian bookworm base image. Bumps to either are intentional
commits.

## Consequences

- yt-dlp version drift is impossible without a Dockerfile change. No
  surprise breakage from upstream releases.
- No Python runtime in the worker image.
- Cold start builds are slower than a no-Dockerfile worker; acceptable
  on Render Starter where rebuilds are infrequent.
- Revisit: when Render base-image build time becomes a constraint.
