# Build context = repo root. Invoke as:
#   docker build -f apps/worker/Dockerfile -t duly-noted-worker .
#
# yt-dlp pin: latest stable release as of 2026-08-07
# (https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04). Bumps are
# intentional commits, not lockfile drift (CLAUDE.md §6).
ARG YT_DLP_VERSION=2026.07.04
# Deno pin: yt-dlp's YouTube extractor now requires a JavaScript runtime and
# enables only deno by default. Without it every extraction logs "No supported
# JavaScript runtime could be found" and loses formats (ADR 0019).
ARG DENO_VERSION=2.9.5

FROM node:24-bookworm-slim AS builder
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
# --ignore-scripts: the workspace `prepare` scripts in packages/shared and
# packages/db run `tsc`, which needs the source we have not COPYed yet.
# We build the packages explicitly below.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN pnpm -F @duly-noted/shared build \
 && pnpm -F @duly-noted/db build \
 && pnpm -F worker build

FROM node:24-bookworm-slim AS runtime
ARG YT_DLP_VERSION
ARG DENO_VERSION
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/* \
 && case "${TARGETARCH}" in \
      amd64) ASSET="yt-dlp_linux"; DENO_TARGET="x86_64-unknown-linux-gnu" ;; \
      arm64) ASSET="yt-dlp_linux_aarch64"; DENO_TARGET="aarch64-unknown-linux-gnu" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${ASSET}" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${DENO_TARGET}.zip" \
      -o /tmp/deno.zip \
 && unzip -q /tmp/deno.zip -d /usr/local/bin \
 && rm /tmp/deno.zip \
 && chmod +x /usr/local/bin/deno \
 && yt-dlp --version \
 && deno --version
RUN corepack enable
WORKDIR /app
COPY --from=builder /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=builder /repo/apps/worker/package.json apps/worker/
COPY --from=builder /repo/packages/shared/package.json packages/shared/
COPY --from=builder /repo/packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /repo/apps/worker/dist apps/worker/dist
COPY --from=builder /repo/packages/shared/dist packages/shared/dist
COPY --from=builder /repo/packages/db/dist packages/db/dist
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
