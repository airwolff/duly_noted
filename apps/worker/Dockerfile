# Build context = repo root. Invoke as:
#   docker build -f apps/worker/Dockerfile -t duly-noted-worker .
#
# yt-dlp pin: latest stable release as of 2026-05-07
# (https://github.com/yt-dlp/yt-dlp/releases/tag/2026.03.17). Bumps are
# intentional commits, not lockfile drift (CLAUDE.md §6).
ARG YT_DLP_VERSION=2026.03.17

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
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && case "${TARGETARCH}" in \
      amd64) ASSET="yt-dlp_linux" ;; \
      arm64) ASSET="yt-dlp_linux_aarch64" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${ASSET}" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp
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
