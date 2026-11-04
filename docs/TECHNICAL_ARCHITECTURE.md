# ECHO — Technical Architecture

> **Navidrome only since 2026-11-03.** Spotify was removed (`824eeb9`, `8f2c1b2`; why:
> [reviews/2026-11-03-spotify-outage.md](reviews/2026-11-03-spotify-outage.md)). What it
> needed (Widevine, PKCE, the Web Playback SDK, Spotify's hosts) is gone from this document; the
> earlier text is in git before those commits.

Status: **Draft 2** (revised after product-owner decisions, 2026-10-22) · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Playback](PLAYBACK_ARCHITECTURE.md) · [Lyrics integration](LYRICS_INTEGRATION.md) · [Settings & security](SETTINGS_AND_SECURITY.md) · [Visualizer](VISUALIZER_SPEC.md) · [Implementation plan](IMPLEMENTATION_PLAN.md)

Claim labels: **[C]** confirmed in an official/primary source (`DESIGN_RESEARCH.md` §5), **[R]**
reported, **[A]** an assumption ECHO will verify in the milestone named.

---

## 1. Decision summary

| Area | Decision |
|---|---|
| Delivery shape | **Self-hosted web service + clients.** The ECHO server runs in Docker Compose on the owner's home server (Dell OptiPlex 7010, i7-3770, 24 GB) next to Navidrome, behind **Caddy** (HTTPS), reachable **from the public internet**. The MVP client is the **browser web app**. Desktop and mobile clients are post-MVP and use the same versioned API. |
| Users | Built-in accounts: one **admin** plus invited users ("mainly me, maybe some others"). Each user connects their own Navidrome account. |
| Language | TypeScript everywhere (server, web client, shared types) |
| Web UI | React 19 for the shell **only**. The Stage (environment + lyric field) is an imperative engine that React mounts once. |
| Rendering | three.js `WebGLRenderer` (WebGL2) used directly. **DOM** for lyrics, composited above the canvas. |
| State (web) | Zustand vanilla stores; server data through small purpose-built loaders (`library-*.ts`, `lyrics/loader.ts`). TanStack Query and `postprocessing` were planned and removed unused in M9 |
| Audio analysis | **On the client**, where the audio plays: Web Audio `AnalyserNode` on Navidrome streams (same-origin via ECHO). |
| Palette extraction | **On the server**, once per album, shared by every client and user (`VISUALIZER_SPEC.md` §6) |
| Lyrics resolution | On the server, cached and shared (`LYRICS_INTEGRATION.md`) |
| Backend | Node 24 LTS + Hono. **SQLite** database. Secrets encrypted at rest (AES-256-GCM) with a master key supplied as a Docker secret. |
| API | `/api/v1`, documented with an OpenAPI file. Cookie sessions for the web client, revocable **device tokens** (bearer) for native clients |
| Tests | Vitest, plus Playwright on **Chromium and Firefox** |
| Licence | **AGPL-3.0** |

---

## 2. Delivery shape

### 2.1 Why a self-hosted web service

The deciding constraints are:

1. **Where the owner runs things:** the backend lives on an always-on home server, and clients run on
   whatever device the owner uses (laptop, gaming PC, later desktop/mobile apps). ECHO is therefore a
   network service, not a local app.
2. **HTTPS off loopback:** the server is public and its session cookie is `__Host-` (Secure).
   Caddy, which the owner already runs, provides it. (Until 2026-11-03, Spotify's Widevine and
   OAuth redirect needed it too.)

```
                 Internet
                    │ HTTPS (Caddy, automatic certs)
┌───────────────────▼──────────────────── OptiPlex 7010 (Docker Compose) ──────────────────┐
│  caddy ── reverse_proxy ──► echo:8080 (Hono, Node 24)  ──► navidrome:4533 (compose net)  │
│                              │ SQLite /data/echo.db                                       │
│                              │ cache /data/cache                                          │
│                              │ master key /run/secrets/echo_master_key                    │
└──────────────────────────────┼────────────────────────────────────────────────────────────┘
                               │ outbound HTTPS: api.spicylyrics.org, lrclib.net, music.163.com,
                               │                 labs.api.listenbrainz.org, musicbrainz.org
        ┌──────────────────────┴───────────────┐
   Browser client (laptop, gaming PC)     Future: desktop app, mobile app
                                           (same /api/v1, device tokens)
```

- ECHO's container **publishes no host port**. Only Caddy reaches it, over the compose network.
- ECHO reaches Navidrome over the compose network (`http://navidrome:4533`). That traffic never
  leaves the host.
- Public origin example: `https://echo.example.com` (configured as `ECHO_PUBLIC_ORIGIN`).

### 2.2 Client support matrix (MVP)

| Client | Support | Notes |
|---|---|---|
| Google Chrome (Linux/macOS/Windows) | ✅ | Reference for visual baselines |
| Chromium (Arch) | ✅ | **First-class** |
| Firefox | ✅ | **First-class.** E2E suite runs on Firefox too |
| Edge, Brave | likely (Chromium) | Not tested in CI |
| Safari | ⚠️ untested | |
| Android app (`Android/`, 2026-10-29) | ✅ native client of `/api/v1`, device token (`docs/ANDROID_CLIENT.md`) | Kotlin, Compose, Media3; the Stage on OpenGL ES with the web's shaders |
| Linux app (`Linux/`, 2026-11-04) | ✅ baseline: sign in, albums, an album, playback | Rust, GTK 4, GStreamer, libsecret; built and run against a test server |
| Windows app (`Windows/`, 2026-11-04) | ⚠️ baseline, builds; the window has not run | C#, WPF on .NET 10 with the Fluent theme, DPAPI for the token |
| macOS and iOS apps (`macOS/`, `iOS/`, 2026-11-04) | ⚠️ baselines, not yet run (need a Mac) | Swift, SwiftUI, AVPlayer, the Keychain; code shared in `Apple/Shared` |

### 2.3 Server hardware notes

The CPU is an **i7-3770** (Ivy Bridge, 4 cores / 8 threads, AVX but **no AVX2/FMA/BMI2**). Earlier
drafts said "i3-3770, 4 threads"; M1 read the real box (DMI `Dell Inc. OptiPlex 7010`, `/proc/cpuinfo`,
23 GiB RAM) and corrected it. It is ample for ECHO's server role: proxying, SQLite, lyric lookups, and
palette extraction (one 128×128 image per album).

**Verified on the box in M1 [C: `docs/reviews/M1.md`]**, inside the production image with the
compose hardening (read-only rootfs, `cap_drop: ALL`, uid 1000), via `scripts/verify-hardware.ts`:

| Check | Result |
|---|---|
| `better-sqlite3` 13.0.3 | loads, SQLite 3.53.4 |
| `sharp` 0.35.5 (libvips 8.18.7, x86-64-v2 prebuilt) | loads; 1000² JPEG → 128² raw in ~13 ms median |
| `node:crypto` Argon2id, `m=64 MiB, t=3, p=1` | **183 ms** median (t=2: 128 ms, t=4: 240 ms). Inside 150–250 ms, so t=3 stays |
| `@node-rs/argon2` 2.2.2 (fallback, throwaway container) | loads; t=3 126 ms. Not used |
| `node:sqlite` | loads, but stability **1.2 Release candidate** in Node 24.22 docs, so not adopted |
Navidrome's own transcoding (ffmpeg → Opus) for remote listeners is the main CPU consumer and is
Navidrome's job, not ECHO's.

---

## 3. Stack and exact versions

Pinned **exactly** in `package.json`. Versions are the newest at least two weeks old on 2026-10-22
[C: npm registry]. The packages marked "pin at M1" got their exact version in M1 with the same rule,
which pnpm now enforces itself (`minimumReleaseAge: 20160` in `pnpm-workspace.yaml`). Client-only
packages are `devDependencies` (Vite bundles them), so the production image carries only server
dependencies.

| Package | Version | Why it's here | Why not something smaller |
|---|---|---|---|
| node (build `node:24.22.0-trixie`; runtime `gcr.io/distroless/nodejs24-debian13` since M9; both pinned by digest) | 24.22 | Server, tooling | Debian 13 since M1 (`docs/reviews/M1.md`). The distroless runtime has no shell, package manager, util-linux, ncurses or perl: 0 HIGH/CRITICAL findings, so SEC-10 passes (`docs/reviews/M9.md`) |
| typescript | 7.0.2 | Types | **Gate (M1):** fall back to 5.9.x if tooling breaks |
| vite | 8.3.3 | Dev server, build | — |
| react, react-dom | 19.3.0 | Web shell | Forms, lists, sheets, focus management |
| three | 0.186.1 | WebGL2 renderer, render targets | Raw WebGL2 means rewriting context-loss, resize and RT plumbing |
| zustand | 5.0.15 | Vanilla stores readable from rAF loops | — |
| hono | 4.13.13 | HTTP server | — |
| @hono/node-server | 2.1.3 | Node adapter | — |
| @material/material-color-utilities | 0.4.0 | `QuantizerCelebi` + `Score` (Apache-2.0, AGPL-compatible) | node-vibrant lacks UI-tuned scoring |
| better-sqlite3 | 13.0.3 | Synchronous, fast SQLite with prebuilt binaries | `node:sqlite` is stability 1.2 (release candidate) in Node 24.22 [C: M1]. Re-check when it reaches Stable |
| sharp | 0.35.5 | Decode and resize cover art server-side for palette extraction | No pure-JS decoder handles JPEG/PNG/WebP robustly at this speed |
| ~~@node-rs/argon2~~ → `node:crypto` `argon2()` | built in (Node ≥ 24.7) | Argon2id password hashing | **M1 decision:** `crypto.argon2` is present, inherits `node:crypto`'s Stable status, runs with no warning, and hashes in 183 ms on the OptiPlex, so per the rule above the package is not added. `@node-rs/argon2` 2.2.2 was verified to load as a fallback |
| vitest | 5.0.3 | Unit tests | — |
| @playwright/test | 1.64.0 | E2E + visual (Chromium, Firefox) | — |
| @biomejs/biome | 2.5.15 | Lint and format | — |
| pnpm (`packageManager`) | 12.11.2 | Installs with lockfile, build-script allow-list, release-age gate | — |
| @types/node, @types/react, @types/react-dom, @types/better-sqlite3, @types/three | 24.19.1, 19.3.0, 19.3.0, 9.6.0, 0.186.0 | Types only. `@types/three` added in M2 (three ships no types); 0.186.0 is the only release for the 0.186 line | — |

**Not used** (considered and rejected):

| Not used | Reason |
|---|---|
| @react-three/fiber, drei, @react-three/postprocessing | The environment is ~3 full-screen passes, not a scene graph. An imperative `StageRenderer` is smaller and keeps the frame loop out of React. |
| motion / framer-motion | Lyric motion is a custom spring integrator on the song clock. Shell transitions are CSS. |
| A router library | ~6 top-level views. A small history-aware view store handles deep links. |
| culori | OKLab/OKLCH ↔ sRGB is ~40 lines of published math, tested |
| Meyda / essentia.js | ECHO needs a few band energies plus flux onsets. essentia.js is AGPL (compatible now, but a large WASM payload for little gain). Meyda is unmaintained since 2024-07 [C] |
| An ORM | ~8 tables, plain SQL migrations in `src/server/db/migrations/*.sql` |
| A TOTP library | RFC 6238 is ~30 lines on `node:crypto` HMAC-SHA1, tested against the RFC vectors |
| `@napi-rs/keyring` | The server is headless in Docker with no Secret Service. Replaced by encryption at rest (`SETTINGS_AND_SECURITY.md` §3) |
| Redis / queues | Single-node, few users. In-process caches and timers. |

---

## 4. System components

```
┌──────────────────────────── Browser client ────────────────────────────────────────────┐
│  React shell (Library, Search, Queue, Settings, Account, Admin, Dock)                   │
│  Zustand stores: player · queue · palette · lyrics · settings · view · connection       │
│  PlaybackController ── NavidromeProvider (<audio>×2 → Web Audio → AnalyserNode)         │
│  SongClock                                                                              │
│  Stage engine (one rAF loop): FeatureSource · PaletteAnimator · LyricField · Renderer   │
└──────────────▲──────────────────────────────────────────────────────────────────────────┘
               │ HTTPS via Caddy · cookie session · /api/v1 · audio streams · covers
┌──────────────┴────────────── ECHO server (Node 24, Hono, container) ─────────────────────┐
│  auth/       login, TOTP, sessions, device tokens, invites, rate limiting                │
│  users/      per-user settings, per-user connections                                     │
│  navidrome/  per-user Subsonic signing, allow-listed proxy, streaming (Range), covers     │
│  lyrics/     resolver + sources + parsers + shared cache                                 │
│  palette/    sharp decode → material quantiser → roles → shared cache                    │
│  admin/      server settings (public origin, Spicy key, matching), users                 │
│  crypto/     master-key envelope encryption for secrets in SQLite                        │
│  db/         better-sqlite3, migrations                                                  │
└──────┬────────────────────┬────────────────────────┬─────────────────────────────────────┘
       ▼                    ▼                        ▼
  navidrome:4533     ListenBrainz/MusicBrainz   api.spicylyrics.org · lrclib.net · music.163.com
```

### 4.1 Why the stage is not React

At 60 fps, a lyric field with ~60 line elements and ~400 word spans, plus uniforms, changes every
frame. Rule:

- `LyricField.mount(container, doc)` creates the lyric DOM imperatively. React never reconciles it.
- Per-frame work writes only `transform`, `opacity`, `filter` and custom properties on existing nodes,
  plus three.js uniforms.
- The loop reads stores via `getState()`. No React subscription to per-frame values.

### 4.2 The frame (client)

1. `t = songClock.now()`
2. `f = featureSource.sample(t, dt)` (`VISUALIZER_SPEC.md` §3)
3. `paletteAnimator.step(dt)` → CSS vars (only when changed) + uniforms
4. `lyricField.update(t, dt, f)` (`LYRICS_EXPERIENCE.md` §6)
5. `stageRenderer.render(t, dt, f, palette)`
6. `perfGovernor.record(frameTime)` (`VISUALIZER_SPEC.md` §8)

The loop stops on `visibilitychange` → hidden. Audio continues.

---

## 5. Data model and data flow

### 5.1 Shared types (`src/shared/types.ts`)

```ts
type ProviderId = 'navidrome';

interface Track {
  key: string;                 // `${provider}:${providerTrackId}`
  provider: ProviderId;
  id: string;
  title: string;
  artists: { id?: string; name: string }[];
  album: { id?: string; title: string; key: string };   // album key for palette cache
  durationMs: number;
  artwork: { url: string; width?: number; height?: number }[];
  isrc?: string;
  replayGain?: { trackGain?: number; albumGain?: number; trackPeak?: number; albumPeak?: number };
}

interface PlaybackState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  track: Track | null;
  positionMs: number;
  positionAt: number;          // performance.now() at observation
  volume: number;              // 0..1 UI value
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  capabilities: ProviderCapabilities;   // PLAYBACK_ARCHITECTURE.md §2
  error?: AppError;
}
// LyricsDoc: LYRICS_INTEGRATION.md §5 (normative)
```

### 5.2 Song clock

- `now()` = `positionMs + (performance.now() − positionAt)` while playing, frozen while paused, minus
  `latencyMs`, plus the user's lyric offset (lyrics only).
- **Navidrome:** re-anchor each frame from `audio.currentTime`. `latencyMs` comes from
  `audioContext.outputLatency` (else `baseLatency`). Errors < 80 ms are slewed at 10% per frame; larger
  errors snap.
- **Seek:** optimistic re-anchor, with the clock marked *seeking* until the provider confirms.

### 5.3 Track change flow

```
provider emits track change
  → playerStore.track = T (loading)
  → in parallel:
     ├─ palette: GET /api/v1/palette/:albumKey      (server computes on miss; VISUALIZER §6)
     ├─ lyrics:  GET /api/v1/lyrics?trackKey=…       (LYRICS_INTEGRATION §4)
     └─ features: featureSource.attach(T)            (Navidrome only)
  → paletteAnimator.transitionTo(palette, 1200 ms)
  → lyricField.swap(doc)                              (LYRICS_EXPERIENCE §9.7)
```

### 5.4 Client stores

| Store | Holds | Written by | Read by |
|---|---|---|---|
| `playerStore` | `PlaybackState` | PlaybackController | Dock, Stage loop |
| `queueStore` | queue (`PLAYBACK_ARCHITECTURE.md` §6) | Controller, Queue UI | Queue sheet |
| `paletteStore` | current/target palette, transition | PaletteAnimator | Stage, Dock |
| `lyricsStore` | `{ status, doc?, error? }` per track | Lyrics loader | Stage, transcript |
| `settingsStore` | the user's preferences (mirrors `/api/v1/me/settings`) | Settings UI | everyone |
| `viewStore` | view + params, history | navigation | shell |
| `connectionStore` | per-provider status | providers, health | Dock, Settings |

### 5.5 Database (SQLite, `/data/echo.db`)

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, username, password_hash (Argon2id), role (`admin`/`user`), totp_secret_enc, totp_enabled, created_at, disabled | `SETTINGS_AND_SECURITY.md` §4 |
| `recovery_codes` | user_id, code_hash, used_at | TOTP recovery |
| `sessions` | id_hash, user_id, kind (`web`/`device`), name, created_at, last_seen_at, expires_at, ip_hint | device tokens are `kind=device` |
| `invites` | token_hash, created_by, expires_at, used_by | single-use |
| `connections` | user_id, provider, config_json (non-secret), secret_enc, status, updated_at | per-user Navidrome |
| `user_settings` | user_id, json, version | preferences (`SETTINGS_AND_SECURITY.md` §7) |
| `server_settings` | key, value_json, secret_enc | admin: public origin, Spicy key, matching switch |
| `track_overrides` | user_id, track_key, offset_ms, pinned_source | lyric offset and pin |
| `queue_state` | user_id, json, updated_at | per-user queue, so it follows the user across clients |
| `wanted` | text, norm (unique words), added_by, added_at, found_json, checked_at | the shared Wanted list (2026-11-03) |
| `audit_log` | at, user_id, event, detail | logins, failures, connection changes, admin actions |

Caches live as files, not in the database (§7.3). Shared caches (palette, lyrics) are keyed by
content (album or track key), not by user.

---

## 6. Backend

### 6.1 Responsibilities

The server **does:** authenticate users, hold and encrypt secrets, sign Navidrome requests per user,
stream audio and covers same-origin (which also keeps Web Audio untainted), resolve and cache lyrics, extract and cache palettes, and store per-user settings and queue.

The server **does not:** transcode audio (Navidrome does), analyse audio (the client does), or play
audio itself.

### 6.2 API surface (`/api/v1`, JSON unless noted; OpenAPI in `docs/api/openapi.yaml`, written in M5)

| Method & path | Purpose |
|---|---|
| `GET /health` · `GET /session` · `POST /csp-report` | Liveness, who-am-I (never 401), CSP reports (unauthenticated) |
| `GET/POST /setup` · `POST /setup/totp` | One-time admin creation with mandatory TOTP |
| `POST /auth/login` → `{ totpRequired, challenge }` · `POST /auth/totp` · `POST /auth/logout` | Web login (cookie) |
| `POST /auth/device` | Native-client login: credentials + TOTP in one request → device token (bearer) |
| `GET /invite` · `POST /invite` · `POST /invite/totp` | Redeem an invite (TOTP enrolment when "require TOTP for all" is on) |
| `GET /me` · `GET /me/account` · `DELETE /me` | Who am I, account facts, account deletion (password + code) |
| `POST /me/password` · `POST /me/totp/start` · `POST /me/totp/enable` · `POST /me/totp/disable` · `POST /me/recovery-codes` | Account security (re-authentication is rate limited) |
| `GET /me/sessions` · `DELETE /me/sessions/:id` · `POST /me/sessions/revoke-others` | Sessions and devices |
| `GET/PUT /me/settings` | Preferences that follow the user (§7.1 of SETTINGS_AND_SECURITY) |
| `GET/PUT/DELETE /me/connections/navidrome` · `POST /me/connections/navidrome/test` | The user's own Navidrome account |
| `GET/POST /navidrome/rest/:method` | Allow-listed Subsonic proxy, signed with the user's credentials (writes POST-only) |
| `GET /navidrome/stream/:id` · `GET /navidrome/stream-url/:id` · `GET /navidrome/cover/:id` | Streams (Range) and covers. Cookie, bearer, or a **signed URL** (§6.5) |
| `GET /lyrics?trackKey=&title=&artist=&album=&durationMs=&isrc=` | Resolved `LyricsDoc` (provider ids come from the track key) |
| `GET/PUT /me/tracks/:trackKey/override` | Lyric offset and pin |
| `GET /palette/:albumKey` | Palette (computed on miss) |
| `GET/PUT /me/queue` | Queue persistence (compare-and-set) |
| `GET/POST /wanted` · `DELETE /wanted/:id` | The Wanted list: one for everyone on the server; items marked found only by the server's own Navidrome (`src/server/wanted.ts`) |
| `GET/PUT /admin/settings` · `GET /admin/users` · `PATCH/DELETE /admin/users/:id` · `POST /admin/users/:id/unlock` · `GET/POST /admin/invites` · `DELETE /admin/invites/:id` · `GET /admin/audit` | Admin only |

Versioning: breaking changes go to `/api/v2`. `/api/v1` stays until every first-party client has
moved.

### 6.3 Configuration and storage (container)

| What | Where |
|---|---|
| Public origin, listen port, log level | env: `ECHO_PUBLIC_ORIGIN=https://echo.example.com`, `ECHO_PORT=8080`, `ECHO_LOG=info` |
| Navidrome internal URL default | env: `ECHO_NAVIDROME_URL=http://navidrome:4533` (users can override per connection) |
| Master key | Docker secret file `/run/secrets/echo_master_key` (32 random bytes, base64). **Required:** the server refuses to start without it |
| Database | volume `/data/echo.db` (WAL mode) |
| Caches | volume `/data/cache/{lyrics,palette}` |
| Logs | stdout (Docker), redacted (`SETTINGS_AND_SECURITY.md` §9) |
| Backups | back up `/data` **and** the master key, stored separately (`SETTINGS_AND_SECURITY.md` §11). Daily `echo-auto-<date>.db` in `/data/backups` (seven kept); `scripts/offsite-backup.sh` copies the newest off the box (rclone) |

### 6.4 Compose and Caddy (reference config; finalised in M5)

**M1 finding [C]:** on the owner's OptiPlex, Caddy runs as a **host systemd service**, not a
container, and host port 8080 is already taken (Nextcloud). The `echo:8080` upstream below assumes a
Caddy container on a shared `web` network. For a host Caddy, ECHO publishes on loopback only
(`127.0.0.1:<free port>:8080`) and Caddy proxies to that. Both variants are in `compose.example.yaml`
and `Caddyfile.example`; M5 picks one when deploying.

```yaml
# compose.yaml (excerpt)
services:
  echo:
    image: ghcr.io/<owner>/echo:<version>      # or build: .
    restart: unless-stopped
    environment:
      ECHO_PUBLIC_ORIGIN: https://echo.example.com
      ECHO_NAVIDROME_URL: http://navidrome:4533
    secrets: [echo_master_key]
    volumes: [echo-data:/data]
    networks: [web, music]                     # no "ports:", reachable only via Caddy
    read_only: true
    tmpfs: [/tmp]
    user: "1000:1000"
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
  navidrome:
    # existing service; must be on the "music" network
secrets:
  echo_master_key:
    file: ./secrets/echo_master_key            # chmod 600, not in git
volumes: { echo-data: {} }
```

```caddyfile
echo.example.com {
    encode zstd gzip
    reverse_proxy echo:8080 {
        flush_interval -1          # stream audio without buffering
    }
}
```

ECHO trusts `X-Forwarded-For`/`X-Forwarded-Proto` **only** from the Caddy container's address
(`ECHO_TRUSTED_PROXY`: a comma-separated list of addresses or IPv4 CIDRs; **empty by default**, so
nothing is trusted until the operator names Caddy's address, as built in M5).

**The owner's live setup (2026-11-04):** a host Caddy behind a Cloudflare tunnel fills
`X-Forwarded-For` from `Cf-Connecting-Ip`, so its ECHO site block answers only the tunnel (loopback,
`SETTINGS_AND_SECURITY.md` §5.1). The live compose carries the example's limits too
(`mem_limit: 768m`, `pids_limit: 256`, `cpus: 2`; peak measured with yt-dlp in the container:
565 MB, 23 processes).

**Running TypeScript on the server (M1):** the server's `.ts` files run directly on Node 24's
built-in type stripping (`node src/server/index.ts`), so the server has no build step. tsconfig sets
`erasableSyntaxOnly` and `allowImportingTsExtensions` so this stays possible. Only the web client is
built (Vite).

### 6.5 Streaming URLs for every kind of client

- **Web client:** `<audio src="/api/v1/navidrome/stream/:id">` with the session cookie (same-origin).
- **Native clients** (players that can't set headers): `GET /api/v1/navidrome/stream/:id?uid=…&exp=…&sig=…`.
  The signature is HMAC-SHA256 over `userId|createdAt|id|exp`, keyed by a server key derived from the
  master key. TTL 6 h (long enough for a track plus pause). Bound to one account and one track: the
  account's creation time is in it because user ids are reused after a delete (2026-10-28).
- The signature parameters are redacted from logs (`SETTINGS_AND_SECURITY.md` §9).
- Bandwidth: off-LAN clients request Navidrome transcoding (`format=opus&maxBitRate=…`), chosen by a
  per-client quality setting: Auto (raw when the client reports a LAN/fast connection via a
  throughput probe, else 192 kbps Opus), Raw, 320, 192, 128.

### 6.6 YouTube Music mode (2026-11-03)

Design: `docs/superpowers/specs/2026-11-03-youtube-music-design.md`, and for its look
`docs/superpowers/specs/2026-11-03-youtube-liner-notes-design.md`; plans beside them in
`docs/superpowers/plans/`.

- **Server** (`src/server/youtube/`): `catalogue.ts` maps youtubei.js (InnerTube, the API the
  YouTube Music website uses: no key, no quota) into `src/shared/youtube.ts`'s `YtPage`s;
  `ytdlp.ts` resolves audio URLs with the standalone yt-dlp binary (Node as its JavaScript runtime,
  never the user's cookie) and keeps it updated; `proxy.ts` streams audio (Range → googlevideo's
  `range` parameter, 206 answers) and thumbnails; `routes.ts` is the API; `fake.ts` is the fixed
  catalogue development and E2E use (`ECHO_DEV_FIXTURES=1`), its audio from the mock Subsonic's
  `/videoplayback`.
- **Client** (`src/client/youtube/`): a separate frame (`YtFrame.tsx`, its own "Liner notes" look:
  paper and ink, tokens `--ln-*`, Fraunces and Instrument Sans) under `/yt/...` routes; the switch is
  per device (`localStorage` `echo.mode`). The full-screen player's Lyrics tab mounts ECHO's Stage
  with `room={false}` (no WebGL room, contrast solver or depth blur) inside the `.ln-lyrics` scope,
  which recolours the lyric field for paper. YouTube songs get Spotify ids for Spicy Lyrics from
  ListenBrainz (`spotify_matches` scope `youtube`), the details always from the catalogue
  (`LYRICS_INTEGRATION.md` §4.3). The night edition (`edition.ts`) is per device too
  (`echo.ytEdition`, else the device's dark setting): `.yt[data-edition="night"]` swaps the `--ln-*`
  colours in `tokens.css`. Motion is ECHO's own (`ui/motion.ts`, `DESIGN_SYSTEM.md` §11, §14).
  YouTube songs are ordinary `Track`s (`provider: 'youtube'`) played by the same `<audio>` provider
  (`navidrome.ts` picks `/api/v1/youtube/stream/:id` for them), so the queue, Media Session and
  lyrics carry on when the switch flips. A queue holding YouTube songs is saved to
  `/me/queue/youtube`, which the Android app never reads.
- **Looking up ahead** (`/youtube/prepare`): a page's first six songs as it opens, a tap, a hover
  or focus, and the next songs in the queue are resolved before they are asked for; a resolved
  URL is reused for about 5.5 h.
- **Measured** (OptiPlex, 2026-11-04): yt-dlp's default clients (`tv_samsung`, `visionos`) take
  3.4–4 s and their format 140 is refused for 4–5 s more (`available_at`: a cold start of 8–14 s
  in production); asked as `visionos` alone, format 140 comes in ~2 s and plays at once, so ECHO
  asks that way first and falls back to the defaults. Other clients need a GVS PO token.
  `PLAYBACK_ARCHITECTURE.md` §11.

---

## 7. Repository layout (single package, AGPL-3.0)

As built (2026-11-04):

```
echo/
├── LICENSE                     ← AGPL-3.0
├── docs/                       ← source of truth (incl. docs/api/openapi.yaml)
├── Dockerfile · compose.example.yaml · Caddyfile.example
├── package.json · vite.config.ts · playwright.config.ts · biome.json
├── src/
│   ├── shared/                 ← types (LyricsDoc…), oklab.ts, youtube.ts
│   ├── server/
│   │   ├── index.ts            ← the app: hardening, routes, static files, the daily jobs
│   │   ├── http.ts  log.ts  config.ts  crypto.ts  audit.ts  account.ts  admin.ts  admin-cli.ts
│   │   ├── auth/  db/ (migrations in db.ts)  navidrome/ (proxy, URL rules, the mock server)
│   │   ├── lyrics/             ← sources, resolve, parse, cache, routes, spotifyMatch
│   │   ├── palette/            ← decode (sharp), extract, service, covers
│   │   ├── youtube/            ← catalogue (youtubei.js), ytdlp, proxy, routes
│   │   └── plays.ts  queue.ts  settings.ts  wanted.ts
│   └── client/
│       ├── main.tsx  prefs.ts  api.ts  tokens.css  main.css  fonts/  fixtures/
│       ├── playback/  palette/  lyrics/
│       ├── stage/ (engine, renderer, shaders, governor) · stage/lyrics/ (field, model, layout, springs, timing, lyricsConfig)
│       ├── shell/ (pages, dock, panels, settings, account, admin; page-transition)
│       ├── youtube/            ← YouTube Music mode (Liner notes)
│       └── ui/ (components; motion.ts: the spring, exits, glides, arrivals, still copies)
├── scripts/                    ← verify-hardware, e2e-container.sh, mock-subsonic, offsite-backup.sh…
├── tests/                      ← e2e/ (Playwright) · unit-setup.ts (Vitest: each run's temp folders)
├── Android/                    ← native: Kotlin, Compose, Media3 (the full app)
├── Linux/                      ← native: Rust, GTK 4, GStreamer, libsecret (baseline)
├── Windows/                    ← native: C#, WPF on .NET 10 (baseline)
├── macOS/  iOS/                ← native: Swift, SwiftUI, AVPlayer (baselines; XcodeGen project.yml)
└── Apple/Shared/               ← the code macOS/ and iOS/ share
```

`oklab.ts` lives in `src/shared` (the server uses it for extraction, the client for interpolation).

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Timing & lyrics | Vitest | parsers, `activeIndexAt`, depth/stack maths, springs at 30/60/144 Hz |
| Clock | Vitest | anchoring, slew, seek, pause |
| Palette | Vitest (server) | OKLab vs reference values; roles on 30 fixture covers; sharp decode |
| Features | Vitest | envelopes, onsets on synthetic patterns, normalisation |
| Auth & security | Vitest + `app.request()` | login, rate limits, TOTP (RFC 6238 vectors), sessions, device tokens, signed URLs, **user isolation**, proxy trust, CSRF/Origin, encryption round-trip |
| E2E | Playwright **Chromium + Firefox** | first run, admin setup, invite, login + TOTP, connect a mock Navidrome, play, queue, search, settings, keyboard |
| Visual | Playwright Chromium snapshots, deterministic `?frame&seed&fixture&tier`, SwiftShader flags `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` [C] | Stage and tokens. Firefox gets functional E2E, not pixel baselines |
| Deployment | a compose-based smoke test (`compose.test.yaml`: Caddy with internal TLS + ECHO + mock Subsonic) | HTTPS, proxy trust, streaming through Caddy, `flush_interval` |
| Manual | checklist | real Navidrome on the OptiPlex, GPU tiers on the laptop and the gaming PC, screen reader |

---

## 9. Cross-cutting rules

- **Errors** are typed: `AppError { code, provider?, retriable, userMessage, detail? }`.
- **Logging:** structured JSON to stdout, redacted (`SETTINGS_AND_SECURITY.md` §9).
- **User isolation:** every data access is scoped by `userId` at the query level (helper
  `forUser(userId)`). A test suite attempts cross-user access on every route (SEC-11).
- **AGPL-3.0 network clause:** the web client's About screen links to the exact source of the
  running version (`ECHO_SOURCE_URL` + commit). Required because remote users interact with it over
  a network.
- **Strings:** English, in `strings.ts`.

---

## 10. Packaging, deployment, updates

| Stage | How |
|---|---|
| Development | `pnpm dev` (Vite + server, HMR) on a workstation, against the mock Subsonic server or the real Navidrome on the OptiPlex |
| MVP deployment | Multi-stage `Dockerfile` (build on `node:24-trixie`, run on distroless `nodejs24-debian13` (M9; Debian 13 since M1), uid 1000, read-only rootfs). Admin commands: `docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts backup \| verify \| rotate-master-key`. Built locally or by CI and pushed to GHCR. `docker compose pull && docker compose up -d` |
| Migrations | Run automatically at start inside a transaction. The server refuses to start on a failed migration and keeps the old schema |
| Updates | Tagged images (`echo:0.x.y`). Release notes list migrations. No auto-update |
| First start | The server prints a one-time **setup URL** (`https://echo.example.com/setup#<token>`, 30 min TTL) to the container log. Opening it creates the admin account (password + mandatory TOTP) |
| Web client caching | Vite's hashed files under `/assets/` are `Cache-Control: public, max-age=31536000, immutable`; the page and every other file `no-cache`, so a deploy reaches every browser. A tab opened before a deploy asks for chunks the new image lacks (the Stage's engine): when one fails to load, the page asks `/` whether it still names its build and reloads into the new one only when it does not, so an offline tab or a navigation cutting a request off never reloads (2026-11-04, `tests/e2e/deploy.spec.ts`) |
| Native clients | In this repository: `Android/` (the full app), `Linux/`, `Windows/`, `macOS/` and `iOS/` (baselines, 2026-11-04; each folder's README), all on `/api/v1` with device tokens and signed stream URLs (§6.5) |

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Public exposure | Account takeover, data leaks | Argon2id, TOTP (mandatory for admin), rate limiting and lockout, secure cookies, CSP, minimal unauthenticated surface, audit log (`SETTINGS_AND_SECURITY.md`) |
| Ivy Bridge compatibility of native modules | Server won't start | **Verified in M1** on the real box (§2.3): all native modules load in the production image. Pure-JS fallbacks remain available for palette decode (jpeg-js/pngjs) if a future version drops x86-64-v2 |
| Losing the master key | Stored secrets unrecoverable | Documented backup procedure. Users can re-enter credentials; nothing else is lost |
| Integrated-GPU clients | Jank | Quality tiers + governor |
| Fresh majors (TS 7, Vite 8, Vitest 5) | Tooling friction | Exact pins. **TS 7 gate passed in M1** (`tsc --noEmit`, Vite build, Vitest all on 7.0.2), so no 5.9 fallback |
