# ECHO

An immersive, self-hosted music player for Navidrome and Spotify, with a floating, word-synchronised
lyric field in an audio-reactive room lit by the album cover.

**Status:** M1 (foundation) closed with an accepted SEC-10 exception
([`docs/reviews/M1-SEC-10-exception.md`](docs/reviews/M1-SEC-10-exception.md)). M2 (the shell, the
WebGL Stage, the UI components) is built; four of its criteria wait on later milestones
([`docs/reviews/M2.md`](docs/reviews/M2.md)). M3, the floating lyrics, is in progress
([`docs/reviews/M3.md`](docs/reviews/M3.md)).
There is no music yet: development builds play invented fixture albums silently (the "Guide Tones"
album plays synthetic guide tones for the lyric fixtures), and the production image has no library
until the Navidrome provider (M5). The server serves the client and a health check.
Typeface: **Mona Sans**. The design and plan live in [`docs/`](docs/README.md), which is the source of
truth.

Licence: [AGPL-3.0](LICENSE). Fonts: SIL OFL 1.1 (`src/client/fonts/OFL-*.txt`).

## Requirements

- Node **24.22.0** (`.node-version`; `fnm use` picks it up)
- pnpm **12.11.2** via corepack: `corepack enable`
- Docker with Compose v2, for the container

## Develop

```sh
pnpm install
pnpm dev            # Vite (client, HMR) + the server with --watch
```

The server listens on `ECHO_PORT` (default 8080) and Vite proxies `/api` to it. If 8080 is taken on
your machine, run `ECHO_PORT=8787 pnpm dev` instead.

| Variable | Default | Meaning |
|---|---|---|
| `ECHO_PORT` | `8080` | Listen port |
| `ECHO_LOG` | `info` | `debug`, `info`, `warn` or `error` (JSON lines on stdout) |
| `ECHO_PUBLIC_ORIGIN` | unset | `https://echo.example.com`. Validated now, required from M5 |

See `.env.example`. Invalid values stop the server at start with a clear message. Secrets never go in
environment files: the master key is a Docker secret (from M5).

## Type specimen (development page)

```sh
ECHO_PORT=18790 pnpm dev        # then open <vite url>/specimen.html   (F: Mona Sans ↔ Geologica, P: palette)
```

It opens on Mona Sans, ECHO's typeface, and keeps Geologica for comparison. The production image is
built without it (`ECHO_SPECIMEN=0`), so neither the page nor Geologica ships. Decision record:
[`docs/reviews/M1-type.md`](docs/reviews/M1-type.md).

## Component gallery (development page)

`/__ui` (with `pnpm dev`, or the built client from `pnpm build && pnpm start`) shows every UI
component in every state. Like the specimen, it is compiled out of the production image
(`ECHO_SPECIMEN=0`), where `/__ui` is "Page not found". Visual baselines:
`pnpm test:e2e --project=chromium ui.visual` (update with `-u` after review).

## Container

```sh
docker build -t echo:local .
docker run --rm echo:local node scripts/verify-hardware.ts      # native modules + Argon2 timing
```

Deployment uses `compose.example.yaml` (no published ports, read-only rootfs, non-root,
`cap_drop: ALL`) and `Caddyfile.example` (TLS, unbuffered streaming, query strings never logged):

```sh
cp compose.example.yaml compose.yaml        # edit domain and networks
mkdir -p secrets && openssl rand -base64 32 > secrets/echo_master_key && chmod 600 secrets/echo_master_key
docker compose up -d
docker compose ps                             # STATUS shows (healthy) once /api/v1/health answers
```

Add the site block from `Caddyfile.example` to your Caddy configuration. If Caddy runs on the host
rather than in Docker, use the loopback `ports:` line in the compose file and point Caddy at it.

## Checks

```sh
pnpm check                 # typecheck (TS 7) + Biome + Vitest + production build
pnpm test:e2e              # Playwright on Chromium and Firefox (first run: pnpm exec playwright install chromium firefox)
scripts/e2e-container.sh   # the same suite as CI runs it: Playwright's Ubuntu image under Xvfb (Docker)
pnpm audit --prod
git config core.hooksPath .githooks          # gitleaks on every commit
```

Headless Firefox has WebGL 2 only with a display, so on a machine without one its Stage tests skip;
the container script (and CI) run them under Xvfb.

CI (`.github/workflows/ci.yml`) runs all of the above, plus gitleaks over history and a Trivy scan of
the image: fixable high/critical findings fail, and all findings are checked against the SEC-10
exception with `scripts/sec10-exception-check.sh <trivy-json>`.
