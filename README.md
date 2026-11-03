# ECHO

An immersive, self-hosted music player for Navidrome: a floating, word-synchronised
lyric field in an audio-reactive room lit by the album cover.

## What it does

- **Navidrome:** your own library through ECHO's proxy (raw or transcoded streams, gapless playback,
  crossfade, ReplayGain, scrobbling), with audio-reactive visuals (Reverb).
- **Lyrics:** the best synchronised source wins (your Navidrome files, Spicy Lyrics, NetEase,
  LRCLIB), word-timed where available, with a shared cache, credits on the Stage, per-track timing
  offsets and a static sheet when untimed.
- **Colour:** the palette is extracted on the server from each cover and drives the Stage, the
  web client's Fluent 2 accent and its Mica glow (the Android app keeps Material 3); a contrast
  solver keeps every lyric line readable.
- **Accounts:** an admin and invited users, Argon2id + TOTP (mandatory for admins), sessions and
  device tokens, and per-user preferences that follow you across devices.
- **Motion:** in the web client everything that appears, leaves, moves or changes springs into
  place (menus and dialogs play their exits, the side panel slides, covers fly to their page and
  into the lyrics view, queue rows glide); Settings → Motion tones it down or turns it off.

Typefaces (web): **Segoe UI** where installed, otherwise **Selawik**, its open fallback, shipped
for everything, lyrics included (the Android app's are in `docs/ANDROID_CLIENT.md`). Licence:
[AGPL-3.0](LICENSE). Fonts: SIL OFL 1.1 (`src/client/fonts/OFL-*.txt`).

The design, plan and acceptance criteria live in [`docs/`](docs/README.md), the source of truth;
each milestone's record, including what is still open, is in [`docs/reviews/`](docs/reviews/).

## Requirements

- Node **24.22** (`.node-version`; `fnm use` picks it up)
- pnpm **12.11.2** via corepack: `corepack enable`
- Docker with Compose v2, for the container

## Android

A native Android client lives in `Android/` (Kotlin, Compose, Media3): `cd Android && ./gradlew
assembleRelease`. See [docs/ANDROID_CLIENT.md](docs/ANDROID_CLIENT.md).

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
| `ECHO_LRCLIB_URL`, `ECHO_SPICY_URL`, `ECHO_NETEASE_URL`, `ECHO_LISTENBRAINZ_URL`, `ECHO_MUSICBRAINZ_URL` | the public services | Overridable for tests (the E2E mocks) |
| `ECHO_DEV_FIXTURES`, `ECHO_CSP_REPORT_FILE` | unset | E2E only |

See `.env.example`. Invalid values stop the server at start with a clear message. Secrets never go in
environment files: the master key is a Docker secret, and the Spicy Lyrics key is set in Settings →
Admin.

## Development pages

- **Component gallery:** `/__ui`, every UI component in every state. Visual baselines:
  `pnpm test:e2e --project=chromium ui.visual` (update with `-u` after review).

It is compiled out of the production image (`ECHO_DEV_PAGES=0`), with the fixture library.

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
docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts reset-password <username>  # forgotten password
```

The server also backs the database up daily to `/data/backups/echo-auto-<date>.db` and keeps
seven. Those sit on the same volume, so copy `/data/backups` off the box for disk-loss protection.
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
