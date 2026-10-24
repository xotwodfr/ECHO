# ECHO

An immersive, self-hosted music player for Navidrome and Spotify, with a floating, word-synchronised
lyric field in an audio-reactive room lit by the album cover.

**Status (2026-10-24):** M1–M9 are built and tested, and ECHO is deployed on the owner's OptiPlex at
**https://echo.folk3s.com** (behind Caddy and a Cloudflare tunnel). Open items: the TLS grade (B
until Cloudflare's minimum TLS version is raised to 1.2), the first sign-in checks and on-box backup
drill, and the owner-side checks on the reference laptop and gaming PC (tier tuning, 8 h soak, Orca,
five-second test). Each milestone's record is in [`docs/reviews/`](docs/reviews/); the design and
plan live in [`docs/`](docs/README.md), which is the source of truth. Typeface: **Mona Sans**.

Licence: [AGPL-3.0](LICENSE). Fonts: SIL OFL 1.1 (`src/client/fonts/OFL-*.txt`).

## What it does

- **Navidrome:** your own library through ECHO's proxy (raw or transcoded streams, ReplayGain,
  scrobbling), with audio-reactive visuals (Reverb).
- **Spotify:** each user connects their own account to the server's Spotify app (PKCE); playback
  through the Web Playback SDK, with Spotify's attribution rules and two admin policy switches.
- **Lyrics:** the best synchronised source wins (your Navidrome files, Spicy Lyrics, LRCLIB), with a
  shared cache, credits on the Stage, per-track timing offsets and a static sheet when untimed.
- **Accounts:** an admin and invited users, Argon2id + TOTP (mandatory for admins), sessions and
  device tokens, per-user preferences that follow you across devices.

## Requirements

- Node **24.22** (`.node-version`; `fnm use` picks it up)
- pnpm **12.11.2** via corepack: `corepack enable`
- Docker with Compose v2, for the container

## Develop

```sh
pnpm install
pnpm dev            # Vite (client, HMR) + the server with --watch
```

The server listens on `ECHO_PORT` (default 8080) and Vite proxies `/api` to it. If 8080 is taken on
your machine, run `ECHO_PORT=8787 pnpm dev` instead. Without a signed-in session, development builds
play the invented fixture albums silently ("Guide Tones" plays synthetic tones with the lyric
fixtures; any fixture at any moment: `/?fixture=ballad-word&frame=60000`).

| Variable | Default | Meaning |
|---|---|---|
| `ECHO_PORT` | `8080` | Listen port |
| `ECHO_LOG` | `info` | `debug`, `info`, `warn` or `error` (JSON lines on stdout, redacted) |
| `ECHO_PUBLIC_ORIGIN` | unset | `https://echo.example.com`. Set in production: Host, https and Origin are checked against it |
| `ECHO_TRUSTED_PROXY` | empty | Addresses or IPv4 CIDRs whose `X-Forwarded-*` headers are honoured (Caddy) |
| `ECHO_DATA_DIR` | `./data` | Database and caches (`/data` in the container) |
| `ECHO_MASTER_KEY_FILE` | `/run/secrets/echo_master_key` | The Docker secret; the server refuses to start without it |
| `ECHO_NAVIDROME_URL` | unset | The default Navidrome URL, always allowed (e.g. `http://navidrome:4533` on a shared Docker network) |
| `ECHO_LRCLIB_URL`, `ECHO_SPICY_URL`, `ECHO_NETEASE_URL`, `ECHO_SPOTIFY_ACCOUNTS_URL`, `ECHO_SPOTIFY_API_URL`, `ECHO_SPOTIFY_IMAGE_URL` | the public services | Overridable for tests (the E2E mocks) |
| `ECHO_DEV_FIXTURES`, `ECHO_CSP_REPORT_FILE` | unset | E2E only |

See `.env.example`. Invalid values stop the server at start with a clear message. Secrets never go in
environment files: the master key is a Docker secret, and the Spotify Client ID and Spicy Lyrics key
are set in Settings → Admin.

## Development pages

- **Type specimen:** `<vite url>/specimen.html` (F: Mona Sans ↔ Geologica, P: palette). Decision
  record: [`docs/reviews/M1-type.md`](docs/reviews/M1-type.md).
- **Component gallery:** `/__ui`, every UI component in every state. Visual baselines:
  `pnpm test:e2e --project=chromium ui.visual` (update with `-u` after review).

Both are compiled out of the production image (`ECHO_SPECIMEN=0`).

## Container and deployment

The image builds on `node:24.22.0-trixie` and runs on distroless `nodejs24-debian13` (no shell, uid
1000, digest-pinned; 0 high/critical scanner findings).

```sh
docker build -t echo:local .
docker run --rm echo:local scripts/verify-hardware.ts      # native modules + Argon2 timing
```

Deployment uses `compose.example.yaml` (loopback or no published ports, read-only rootfs, non-root,
`cap_drop: ALL`, no-new-privileges, the master key as a Docker secret) and `Caddyfile.example`
(unbuffered streaming, query strings never logged):

```sh
cp compose.example.yaml compose.yaml        # edit domain, networks, ECHO_TRUSTED_PROXY
mkdir -p secrets && openssl rand -base64 32 > secrets/echo_master_key && chmod 600 secrets/echo_master_key
docker compose up -d
docker compose logs echo | grep setup       # the one-time admin setup link (30 min)
```

Admin commands run inside the container (the image has no shell):

```sh
docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts backup             # VACUUM INTO /data/backups/
docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts verify             # do sealed values open?
docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts rotate-master-key --new-key-file <f>
```

Back the master key up **apart from** the data volume. The owner's live setup (Caddy on the host,
Cloudflare tunnel) is described in [`docs/reviews/M5.md`](docs/reviews/M5.md) ("Task 12").

## Checks

```sh
pnpm check                 # typecheck (TS 7) + Biome + Vitest + production build
pnpm test:e2e              # Playwright: Chromium, Firefox, then the isolated project (first run: pnpm exec playwright install chromium firefox)
scripts/e2e-container.sh   # the same suite as CI runs it: Playwright's Ubuntu image under Xvfb (Docker)
pnpm audit --prod
git config core.hooksPath .githooks          # gitleaks on every commit
```

The suites cover accessibility (axe, keyboard, focus, target sizes), performance (5,000-album
library, cold start, heap), security (isolation between users, log redaction, secret scans, CSP
violations, contract tests against `docs/api/openapi.yaml`) and the backup/restore drill. Headless
Firefox has WebGL 2 only with a display, so on a machine without one its Stage tests skip; the
container script (and CI) run them under Xvfb.

CI (`.github/workflows/ci.yml`) runs all of the above, plus gitleaks over history and a Trivy scan of
the image (high/critical findings fail the build).
