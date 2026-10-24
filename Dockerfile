# syntax=docker/dockerfile:1
# ECHO server image (docs/TECHNICAL_ARCHITECTURE.md §10). Base images pinned by digest
# (docs/SETTINGS_AND_SECURITY.md §12). Debian 13 trixie: current stable; bookworm left regular
# security support on 2026-07-11 (docs/reviews/M1.md, SEC-10).
# Contains no secrets: the master key is a runtime Docker secret.

FROM node:24.22.0-trixie@sha256:03795b45b3153ccaf7459e36c09d4e7ad6bdc08c5c2c2df1fce7e9f465c9103f AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN ECHO_SPECIMEN=0 pnpm build && CI=true pnpm prune --prod && mkdir -p /tmp/data

# Runtime: distroless Node 24 on Debian 13 (M9, SEC-10): no shell, no package manager, no
# util-linux, ncurses or perl, so none of their CVEs (the 43 HIGH findings of the slim base,
# docs/reviews/M1-SEC-10-exception.md). glibc and libstdc++ are there for the native modules.
FROM gcr.io/distroless/nodejs24-debian13@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8
ENV NODE_ENV=production ECHO_PORT=8080 ECHO_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
COPY scripts/verify-hardware.ts ./scripts/
# /data must exist and belong to uid 1000 so a fresh named volume inherits that ownership (no
# shell here to mkdir: an empty directory is copied in with its owner).
COPY --from=build --chown=1000:1000 /tmp/data /data
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+process.env.ECHO_PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The image's entrypoint is node. Admin commands (SETTINGS_AND_SECURITY.md §11):
#   docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts backup | verify | rotate-master-key …
CMD ["src/server/index.ts"]
