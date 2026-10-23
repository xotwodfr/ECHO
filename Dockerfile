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
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN ECHO_SPECIMEN=0 pnpm build && CI=true pnpm prune --prod

FROM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c
ENV NODE_ENV=production ECHO_PORT=8080
WORKDIR /app
# /data must exist and belong to uid 1000 so a fresh named volume inherits that ownership.
# npm and corepack are never used at runtime; removing them drops their bundled dependencies
# (and their CVEs) from the image.
RUN mkdir /data && chown 1000:1000 /data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY scripts/verify-hardware.ts ./scripts/
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.ECHO_PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/server/index.ts"]
