# ECHO

An immersive, self-hosted music player for Navidrome: a floating, word-synchronised
lyric field in an audio-reactive room lit by the album cover.

## What it does

- **Navidrome:** your own library through ECHO's proxy (raw or transcoded streams, gapless playback,
  crossfade, ReplayGain, scrobbling), with audio-reactive visuals (Reverb).
- **Lyrics:** the best synchronised source wins (your Navidrome files, Spicy Lyrics, NetEase,
  LRCLIB), word-timed where available, with a shared cache, credits on the Stage, per-track timing
  offsets and a static sheet when untimed.
- **Wanted:** one list for everyone on the server of music that isn't in Navidrome yet. Add to it
  on Your Library → Wanted or from a search that finds nothing (which also links to the same
  search on YouTube Music); ECHO marks what the library gets, and plays it.
- **YouTube Music (web):** a switch in the top bar turns ECHO into a YouTube Music app: its
  Today, Explore, search and Your shelf (sign in by pasting a cookie in Settings → Account), in
  its own magazine look, "Liner notes": paper and ink (and a night edition, from the moon in the
  masthead or the device's dark setting), serif titles, numbered tracklists, an ink strip along
  the bottom and a paper full-screen player with Up next, Lyrics and Related, all on ECHO's
  springs. Its
  Lyrics tab is ECHO's own lyrics view printed on paper, word by word from Spicy Lyrics and the
  other word-synced sources (YouTube songs get Spotify ids through ListenBrainz). Songs play
  through ECHO's own player: the server fetches each song's audio with yt-dlp (anonymously, never
  with your cookie) and streams it like a Navidrome song; the songs on the page you open are
  looked up ahead and start at once, any other in about 2.5 s. That breaks YouTube's terms; an admin
  can turn the mode off for everyone. yt-dlp updates itself daily in the data volume.
- **Colour:** the palette is extracted on the server from each cover and drives the Stage, the
  web client's Fluent 2 accent and its Mica glow (the Android app keeps Material 3); a contrast
  solver keeps every lyric line readable.
- **Accounts:** an admin and invited users, Argon2id + TOTP (mandatory for admins), sessions and
  device tokens, and per-user preferences that follow you across devices.
- **Motion:** in the web client everything that appears, leaves, moves or changes springs into
  place (menus and dialogs play their exits, the side panel slides, covers fly to their page and
  into the lyrics view, queue rows glide); Settings → Motion tones it down or turns it off.
- **Performance mode:** one switch in Settings → Visuals for a slower computer, on that device
  only: smaller animations everywhere and a Listen room that holds still, in Navidrome and YouTube
  Music mode alike; the lyrics still move word by word.

Typefaces (web): **Segoe UI** where installed, otherwise **Selawik**, its open fallback, shipped
for everything, lyrics included, and **Fraunces** with **Instrument Sans** in YouTube Music mode
(the Android app's are in `docs/ANDROID_CLIENT.md`). Licence: [AGPL-3.0](LICENSE). Fonts: SIL
OFL 1.1 (`src/client/fonts/OFL-*.txt`).

The design, plan and acceptance criteria live in [`docs/`](docs/README.md), the source of truth;
each milestone's record, including what is still open, is in [`docs/reviews/`](docs/reviews/).

## Requirements

- Node **24.22** (`.node-version`; `fnm use` picks it up)
- pnpm **12.11.2** via corepack: `corepack enable`
- Docker with Compose v2, for the container

## Native apps

A native client per platform, each on its own toolkit, all against the same API (device tokens,
the Subsonic proxy, signed stream URLs):

| Folder | Platform | Built with | Build |
|---|---|---|---|
| `Android/` | Android | Kotlin, Compose, Media3 | `./gradlew assembleRelease` ([docs/ANDROID_CLIENT.md](docs/ANDROID_CLIENT.md)) |
| `Linux/` | Linux | Rust, GTK 4, GStreamer, libsecret | `cargo run --release` |
| `Windows/` | Windows 10/11 | C#, WPF on .NET 10 (Fluent theme) | `dotnet run` |
| `macOS/` | macOS 14+ | Swift, SwiftUI, AVPlayer | `xcodegen && open ECHO.xcodeproj` |
| `iOS/` | iPhone, iPad (iOS 17+) | Swift, SwiftUI, AVPlayer | `xcodegen && open ECHO.xcodeproj` |

macOS and iOS share their code in `Apple/Shared`. Android is the full app (Stage, lyrics, mixes);
the other four are baselines (sign in, albums, an album's songs, a player that goes on through
the album), each folder's README says what each has and has been checked with.

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
seven. Those sit on the same volume, so copy them off the box for disk-loss protection:
`scripts/offsite-backup.sh` sends the newest to an rclone remote (use a `crypt` one) and keeps 30
days there, e.g. daily from a systemd timer with `ECHO_OFFSITE_REMOTE=echo-crypt:backups`.
Back the master key up **apart from** the backups (a password manager, with the crypt password).
The owner's live setup (Caddy on the host,
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
