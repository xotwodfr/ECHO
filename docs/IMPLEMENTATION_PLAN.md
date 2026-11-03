# ECHO — Implementation Plan

> **Spotify was removed on 2026-11-03** (commits `824eeb9` web client, `8f2c1b2` server). Parts of
> this document that describe Spotify playback, its connection, the policy gates or the library
> source switch are kept as a record of what was built and why it went; the code is in git before
> those commits. Music that is not in Navidrome is found on YouTube Music by a link in the search
> page. What stays: matching Navidrome tracks to Spotify **ids** so Spicy Lyrics can serve them
> ([LYRICS_INTEGRATION.md](LYRICS_INTEGRATION.md) §4.3), which needs no Spotify account or app.

Status: **Draft 2**, with progress through M9 and the deployment · Last reviewed 2026-10-24
Related: [Acceptance criteria](ACCEPTANCE_CRITERIA.md) (IDs referenced below) · [Technical architecture](TECHNICAL_ARCHITECTURE.md) · [Product spec](PRODUCT_SPEC.md) §10 (MVP releases)

The plan gets **one visually exceptional listening experience** working first, served from the real
OptiPlex behind Caddy (Navidrome + lyrics + environment + accounts: MVP-α = M1–M6). Spotify,
account management and hardening follow (MVP-β = M7–M9).

---

## 0. Changes to the suggested milestone order, and why

The brief's nine milestones are kept, with four adjustments:

1. **The public-facing security foundation moves into M5** (from M8): database, encrypted secrets,
   admin setup, login with TOTP, sessions, host/proxy/Origin checks. ECHO is reachable from the
   internet and holds Navidrome passwords from M5 on, so it must not be deployable without them. M8
   keeps invites, device management, account deletion, the isolation suite, signed stream URLs and the
   pre-share security review.
2. **M3 runs on recorded feature fixtures, not live audio analysis.** The lyric field is built and
   tested on deterministic `Features` recordings and synthetic guide audio, independent of any
   provider. Live extraction arrives with real audio in M5.
3. **Real deployment happens in M5.** The first real listening session runs on the OptiPlex behind
   Caddy, so streaming through the proxy, TLS, the secure context for EME and Ivy Bridge
   compatibility are proven early, not in M9.
4. **A real-song tuning pass ends M6.** Lyric constants are tuned on fixtures in M3, then re-tuned on
   real word-timed songs.

```
M1 ─► M2 ─► M3 ─────────► M5 ─► M6 ─► M7 ─► M8 ─► M9
        └─► M4 ──────────┘▲
                          (M3 and M4 can run in parallel after M2; M5 needs M2+M4; M6 needs M3+M5)
```

Rough effort for one developer, for planning only: M1 1 wk · M2 1.5 wk · M3 2.5 wk · M4 1 wk ·
M5 3 wk · M6 1.5 wk · M7 1.5 wk · M8 1.5 wk · M9 2 wk ≈ **15.5 weeks**.

---

## M1 — Design foundation and project scaffold

**Deliverables:** the repository skeleton (`TECHNICAL_ARCHITECTURE.md` §7) under **AGPL-3.0**, the
pinned toolchain, `tokens.css`, the **typeface decision**, a container image that serves the empty
client, hardware verification on the OptiPlex, and CI.

**Dependencies:** none.

**Tasks:**
1. `git init`, `LICENSE` (AGPL-3.0), `.gitignore` (`secrets/`, `.env*`, `*.local.*`,
   `.taste-skill/`), gitleaks pre-commit, Biome (exact version ≥ 2 weeks old), `pnpm` with exact
   versions (`TECHNICAL_ARCHITECTURE.md` §3, plus the "pin at M1" packages) and
   `onlyBuiltDependencies`.
2. **TypeScript 7 gate:** `tsc --noEmit`, Vite build, Vitest with TS 7.0.2. Fall back to the last
   5.9.x if the toolchain breaks, and record it.
3. Vite client entry. Hono server entry on `ECHO_PORT` serving static files and `GET /api/v1/health`.
   `pnpm dev`.
4. `Dockerfile` (multi-stage, non-root, read-only), `compose.example.yaml`, `Caddyfile.example`
   (with `flush_interval -1` and the stream-URL log filter), per `TECHNICAL_ARCHITECTURE.md` §6.4.
5. **OptiPlex verification** (Ivy Bridge, no AVX2): run the image on the real box. Confirm
   `better-sqlite3`, `sharp` and `@node-rs/argon2` load. Measure Argon2id at `m=64 MiB, t=3, p=1`
   and tune to 150–250 ms. Check whether `node:crypto` Argon2 and `node:sqlite` are usable in Node 24
   LTS (prefer built-ins if so). Record results in `TECHNICAL_ARCHITECTURE.md`.
6. `tokens.css` verbatim from `DESIGN_SYSTEM.md` §13.
7. **Type specimen and decision:** self-host Geologica and Mona Sans (Latin + Latin-Ext woff2). Build
   a static Stage specimen page (active + 3 upcoming + background lines from fixture lyrics, lit
   word with glow, dock with timecodes, three palettes, 1440×900 and 1024×640). Check `tnum` for
   both (Q-DS-1). The owner chooses. Write `docs/reviews/M1-type.md`, update `DESIGN_SYSTEM.md` §4
   and `--font`, and remove the unused face.
8. CI: typecheck, Biome, Vitest, Playwright smoke on **Chromium and Firefox**, `pnpm audit --prod`,
   gitleaks, Trivy image scan.

**Tests and verification:** CI green. The container answers `/api/v1/health` on the OptiPlex. The
specimen is reviewed.

**Completion:** DS-03, DS-10, SEC-10, DEP-04 (hardware part) pass.

---

## M2 — Main player shell and visual system

**Deliverables:** the shell frame (sidebar, dock, view store, sheets), every component from
`DESIGN_SYSTEM.md` §9 on a `/__ui` page, the Stage engine skeleton (rAF loop, `StageRenderer` with
the room in **Ambient** and **Still** modes on the fallback palette), deterministic mode, and the CSS
fallback room.

**Dependencies:** M1.

**Progress:** tasks 1–12 done (2026-10-24; record in `docs/reviews/M3.md`). The tuning (task 11)
was a first pass on fixtures by Claude; the owner's look in motion, the listening test and the Orca
pass remain, and the V baselines are taken after them. Motion = Off moved to M9 with A11Y-06.

**Tasks:**
1. Write the fixture `LyricsDoc`s (original text; `LYRICS_EXPERIENCE.md` §16, with
   `accents-word.json` as the typographic target) and a generator script that synthesises a
   **guide-tone audio file** per fixture: a soft sine "voice" per word and a click per line start.
2. Hand-author `Features` fixture tracks (calm ballad, steady 4/4 pop, 140 BPM techno stress,
   silence). Real recordings replace them in M5.
3. `FixtureProvider`: guide audio through the real `<audio>` → Web Audio path, so `SongClock` and
   latency correction are exercised early.
4. `timing.ts`: `activeIndexAt`, `handoverAt`, coalescing, ranks, stack positions, drift. **Vitest
   tables first** (LYR-01, -04, -05, -20).
5. `springs.ts`: closed-form integrator, stable at 30/60/144 Hz, dt clamp.
6. `layout.ts`: one measurement per doc and resize, wrapping, shrink (and the Mona Sans per-line `wdth`,
   decided in M1), pooled elements, RTL/CJK robustness, grapheme splitting for emphasis.
7. `field.ts`: depth functions, word sweep (`@property --p`), glow, emphasis, decay, background field,
   entering the zone, interlude dots, pause, scrub, seek, resize, document swap.
8. Beat terms from recorded features with caps, and the intensity multipliers
   (`LYRICS_EXPERIENCE.md` §12).
9. Reduced motion and Motion = Off.
10. Accessibility transcript and opt-in announcements.
11. `lyricsConfig.ts` tuning session. Values are written back into `LYRICS_EXPERIENCE.md` §15.
12. Design review with fixture screenshots at 5 moments each. Write-up in `docs/reviews/M3.md`, top
    3 fixes applied.

**Tests and verification:** U for timing and depth. V at fixed frames per fixture. E for pause,
scrub, resize and reduced motion (Chromium + Firefox). **Listening test** with guide audio.

**Completion:** LYR-01–14, LYR-17, LYR-18, LYR-20–24, LYR-27 and A11Y-05 (lyric part) pass.

---

## M4 — Artwork colour extraction and transitions

**Deliverables:** **server-side** palette extraction (sharp + material quantiser), role constraints,
the shared palette cache and endpoint, OKLab interpolation in the client, and the contrast solver with
the probe pass. Colour is wired into the shell, dock, lyric field and environment.

**Dependencies:** M2. It can run alongside M3. Lyric-field integration needs M3.

**Progress:** tasks 1–6 done (2026-10-24; record in `docs/reviews/M4.md`). VIS-02 and VIS-04 pass.
Open: the +3 contrast floor (an owner decision), VIS-03's client timing and VIS-05's stress-fixture
moment (both need M5).

**Tasks:**
1. `src/shared/oklab.ts` plus tests against reference values.
2. `src/server/palette/`: fetch → sharp 128² raw → border drop → `QuantizerCelebi` + `Score` → roles
   → constraints → gamut mapping. Special cases: achromatic, near-white, neon
   (`VISUALIZER_SPEC.md` §6.2). Concurrent-request de-duplication.
3. `GET /api/v1/palette/:albumKey` with the file cache and `palette.version` invalidation (a
   temporary unauthenticated dev mode until M5).
4. The 30 fixture covers (generated or drawn for ECHO, plus local-only covers from the owner's
   library, not committed).
5. `PaletteAnimator`: OKLab interpolation, mid-transition retarget, CSS variables and uniforms,
   prefetch of the next track's palette.
6. Probe pass and contrast solver (`DESIGN_SYSTEM.md` §3.4; `VISUALIZER_SPEC.md` §5.4).

**Tests and verification:** U for roles and constraints on all covers. U for interpolation
continuity. P for extraction time on the OptiPlex. V contrast frames per cover and mode.

**Completion:** VIS-02, VIS-03, VIS-04, VIS-05 pass.

---

## M5 — Navidrome, audio analysis, accounts and deployment

**Deliverables:** the secure multi-user server foundation, real playback from Navidrome per user,
library, search, queue that follows the user, live feature extraction, Reverb mode, and a running
deployment on the OptiPlex behind Caddy. **This is the first real listening experience.**

**Dependencies:** M2, M4 (M3 for the full stage).

**Progress:** tasks 1–11, 13 and 14 built and tested (2026-10-24; record in `docs/reviews/M5.md`).
Task 12 **done**: deployed at https://echo.folk3s.com (2026-10-24, `docs/reviews/M5.md`). Since built:
gapless A/B (PLAY-04), Media Session next/previous, the server-backed Playlists and Starred tabs,
album sorts, server search (`search3`) and queue reorder. Open parts (re-checked 2026-10-28):
**crossfade** (the setting is shown disabled) and **Artists as a server list** (derived from the
loaded albums today). Artist pages (S6) are built (2026-10-28): every artist name with an id (the
Artists tab, an album's header, the dock) links to the artist's albums, from Navidrome's
`getArtist`.

**Tasks:**
1. **Database:** better-sqlite3 (M1 finding: `node:sqlite` is not yet stable), the migrations runner, the
   tables in `TECHNICAL_ARCHITECTURE.md` §5.5.
2. **Crypto:** master-key loading (refuse to start without it), AES-256-GCM with AAD, HKDF-derived
   subkeys (`SETTINGS_AND_SECURITY.md` §3.2).
3. **Auth:** setup URL flow with mandatory admin TOTP and recovery codes, login + TOTP challenge,
   Argon2id, rate limiting and lockout, web sessions (`__Host-` cookie), logout, audit log
   (`SETTINGS_AND_SECURITY.md` §4).
4. **HTTP hardening:** trusted-proxy handling, Host check, Origin check, security headers + CSP,
   body limits, the unauthenticated-surface allow-list (§5).
5. **Per-user Navidrome connection:** connect/test/disconnect with SSRF URL rules, encrypted secret,
   signing (token+salt; apiKey when advertised), method allow-list, stream passthrough with Range,
   cover proxy.
6. **Mock Subsonic server** for E2E with fault injection (down, slow, 401, stream errors).
7. `NavidromeProvider`: A/B audio, ReplayGain, raw vs transcode by per-device quality and
   throughput probe, `timeOffset` seeking, gapless preload, optional crossfade, scrobbling, Media
   Session.
8. Library (Albums with sorts, Artists, Playlists, Starred, Detail) and search (purpose-built loaders; TanStack Query was not needed).
   Virtualised grid.
9. Queue model and sheet. **Server-side per-user queue persistence** (`/api/v1/me/queue`) with the
   "changed on another device" notice.
10. `AnalyserFeatures` (bands, envelopes, flux onsets, p95 normalisation, latency ring buffer, silence
    detection). Re-record the M3 feature fixtures from real audio.
11. Reverb mode: energy feedback, wavefront rings, bass breathing, bloom, halation, the luminance slew
    limiter, and **intensity settings with Expressive as default** (`VISUALIZER_SPEC.md` §7.4).
12. **Deployment:** compose service next to Navidrome on the OptiPlex, Caddy site block, master key
    as a Docker secret, volume. Verify HTTPS, `isSecureContext`, streaming through Caddy without
    buffering, and seeking over the internet (a phone hotspot test).
13. Start `docs/api/openapi.yaml` for every route built so far.
14. Reconnection and backoff, stream error recovery, the "ECHO server unreachable" client state.

**Tests and verification:** U for crypto, auth, rate limits, TOTP (RFC vectors), session, host,
Origin, proxy trust, allow-list and SSRF rules. E against the mock server (Chromium + Firefox) for
library, queue, transport and faults. A compose smoke test (`compose.test.yaml`). P for feature cost
and server palette time. A11Y-08 photosensitivity script on the stress fixture, at **Expressive**.
M on the real OptiPlex.

**Completion:** PLAY-01–07, QUE-01, QUE-02, QUE-05, LIB-01, LIB-03, SRCH-01, VIS-01, VIS-06, VIS-08,
VIS-10, SEC-01, SEC-02, SEC-05, SEC-12, SEC-13, SEC-15, SEC-17, SEC-18, ACC-01, MU-01, DEP-01, DEP-02,
REL-01, REL-02, A11Y-08 (first pass), BRW-01 pass.

---

## M6 — Spicy Lyrics, lyric sources and synchronisation

**Deliverables:** the lyric resolver with all sources, parsers, the shared cache, attribution,
per-user offsets and late-arrival behaviour, plus the real-song tuning pass.

**Dependencies:** M3, M5.

**Progress:** tasks 1–6 done (2026-10-24; record in `docs/reviews/M6.md`). All M6 criteria pass on
the mock sources. Task 7 (real-song tuning) waits for the owner's library and machines.

**Tasks:**
1. Parsers: OpenSubsonic structured (+ `cueLine`), LRC, enhanced LRC, Spicy `Syllable`/`Line`/
   `Static`. Validation and repair. Vitest on captured sample responses.
2. Sources S1, S3, S4. S2 (Spicy) using the **admin's key**, entered in Admin → Server → Lyrics
   (encrypted). Re-check the live API docs and response envelope before writing the parser.
3. Resolver: parallel lookups, timeouts, retries, circuit breaker, selection, pins, late
   improvement.
4. Shared file cache with TTLs, daily sweep, size cap, negative caching.
5. Client: debounce, stale-drop, prefetch, the state timeline (`LYRICS_EXPERIENCE.md` §9.5),
   per-user offsets (`[`/`]` → `/api/v1/me/tracks/:trackKey/override`), the attribution line, the ⓘ
   source menu, the scrubber lyric preview.
6. Check whether Navidrome fills `cueLine` from enhanced LRC/TTML, and whether it exposes `isrc`
   (Q-LI-4).
7. **Real-song tuning pass:** 10 real songs across genres from the owner's library, tuned on the
   laptop and the gaming PC. Update `LYRICS_EXPERIENCE.md`. Write-up in `docs/reviews/M6.md`.

**Tests and verification:** U for parsers, selection, validation, timeouts and cache TTL. E with mock
sources (delays, errors, 429). E network log for LI-07.

**Completion:** LYR-15, LYR-16, LYR-19, LYR-25, PLAY-10, LI-01–07, REL-03 pass. **MVP-α is
reached.**

---

## M7 — Spotify within confirmed capabilities

> **Removed 2026-11-03.** ECHO no longer talks to Spotify; this section records what was built.

**Deliverables:** the server-level Spotify app configuration with seat count, per-user Spotify
connection (PKCE), the SDK device, Web API control, the Spotify library subset, compliance, gates
G1/G2 (**on** by owner decision, with admin kill switches), and the Spotify-ID lookup for Spicy.

**Dependencies:** M5, M6.

**Progress:** tasks 1–8 built and tested against a fake SDK, a fake Web API and a mock accounts
service (2026-10-24; record in `docs/reviews/M7.md`). The manual checklist (PLAY-08/09 and the M
parts of SP-01, SRCH-02, REL-04, BRW-02) needs a Spotify app, a Premium account, and deployment
behind HTTPS (deployed 2026-10-24: https://echo.folk3s.com).

**Tasks:**
1. **Re-verify** against live Spotify docs: player endpoints for new Development Mode apps,
   `/me/library` paths, whether `streaming` alone suffices, CSP hosts for the SDK. Update
   `PLAYBACK_ARCHITECTURE.md`.
2. Admin → Server → Spotify: Client ID, seats (n / 5), gate switches G1/G2 (default on).
3. Per-user PKCE flow, token endpoint, refresh, expiry and "not on the app's user list" handling
   (`SETTINGS_AND_SECURITY.md` §6.2).
4. `SpotifyProvider`: lazy SDK load, device lifecycle, transfer, state mapping, 1 s polling, remote
   state, error mapping. Widevine probe with **specific guidance for Chromium (Arch) and Firefox**.
5. Web API: transport, queue read/add, playlists, saved albums, search (limit 10).
6. Compliance: always-visible art and metadata, the official Spotify logo, links back, no disk cache
   except the derived palette, one-provider queue, no crossfade, Ambient-only environment.
7. G1: server-side palette extraction for `i.scdn.co` covers (in-memory image, 30-day palette TTL).
   G2: full lyric timing for Spotify tracks.
8. Per-user opt-in Spotify-ID resolution for Navidrome tracks.

**Tests and verification:** E with a fake Spotify provider for every UI state, including both gates
switched off. U for PKCE, state binding to the session user, seats and the queue rule. **M checklist**
on a Premium account in Chrome, Chromium (with Widevine) and Firefox (DRM on), on the laptop and the
gaming PC.

**Completion:** PLAY-08, PLAY-09, QUE-03, QUE-04, SRCH-02, LI-08, SEC-07, REL-04, SP-01–06, DS-08
(Spotify), BRW-02 pass.

---

## M8 — Settings, accounts, security and credential management

**Deliverables:** complete Preferences, Account and Admin screens, invites, sessions and devices,
device tokens and signed stream URLs for future clients, account deletion and disconnects, the
isolation suite, redaction tests, every block's states, backups, the completed OpenAPI document, and
the **pre-share security review**.

**Dependencies:** M5–M7.

**Progress:** tasks 1–11 built and tested (2026-10-24; record in `docs/reviews/M8.md`, review in
`docs/reviews/M8-security.md`). Open: the live half of the pre-share review (SEC-19) and the on-box
backup drill (DEP-03). Deployed 2026-10-24: the live checks pass except the TLS grade (B until
Cloudflare's minimum TLS is 1.2); cookie flags and the drill follow the first sign-in. The domain is
not to be shared before SEC-19 passes. The Settings `blank-gap` deferral from M2 is closed (0 FAIL).

**Tasks:**
1. Preferences views (`SETTINGS_AND_SECURITY.md` §7.1), with per-device keys in `localStorage`.
   Then re-run `inspect.mjs --app` on every Settings view: this closes the Settings `blank-gap`
   FAIL deferred from M2 task 7.
2. Account: password change (revokes other sessions), TOTP enable/disable, recovery codes regenerate,
   Sessions & devices with revocation, connections status rows and tests.
3. Admin: users (invite, disable, delete, unlock, promote), audit log viewer, server settings.
4. Invites (single-use, 72 h). Optional "require TOTP for all".
5. **Device tokens** (`POST /api/v1/auth/device`) and **signed stream URLs** (HMAC, 6 h, user+track
   bound) for future native clients. Contract tests against `docs/api/openapi.yaml`, completed for
   all routes.
6. Disconnect flows, account deletion, admin deletion. Verify that no rows or ciphertext remain.
7. Redaction test across all log paths. Bundle and storage secret scans.
8. **Isolation suite:** user B attacks every route with user A's identifiers.
9. Loading/empty/error/offline states for every block (`DESIGN_SYSTEM.md` §10).
10. Backup and restore drill (DB + master key) and master-key rotation command.
11. **Pre-share security review:** walk `SETTINGS_AND_SECURITY.md` §1 threat by threat against the
    deployed instance (TLS config, headers, unauthenticated surface, rate limits, cookie flags,
    container hardening). Run an external scan (e.g. testssl.sh, securityheaders) and record it in
    `docs/reviews/M8-security.md`.

**Tests and verification:** U/E for each SEC/ACC/API item. V for every state. The review document.

**Completion:** SEC-03, SEC-04, SEC-06, SEC-08, SEC-09, SEC-11, SEC-14, SEC-16, SEC-19, ACC-02,
ACC-03, API-01, API-02, DEP-03, DS-07, REL-05 pass. **Only after SEC-19 may the domain be shared with
anyone else.**

---

## M9 — Accessibility, performance, testing and final polish

**Deliverables:** tiers and governor tuned on the real clients, the full accessibility pass, the
performance pass, the soak test, the final design critique and polish.

**Dependencies:** M1–M8.

**Progress:** all code-side work done (2026-10-24; record in `docs/reviews/M9.md`): governor and
first-run tier, perf probes, windowed library, accessibility suite, critique fixes, docs. SEC-10
passes strictly on a distroless runtime. Open: the reference-client tuning, Orca, the five-second
test, the 8 h soak and the on-box DEP-04 run under real transcoding, all needing the owner's
machines or people (the deployment is done).

**Tasks:**
1. Record the reference clients (Q-AC-1): **the owner's everyday laptop** (performance floor) and
   **the gaming PC** (T0 ceiling). Profile both. Tune tier thresholds, the first-run tier heuristic
   and per-device memory (`VISUALIZER_SPEC.md` §8).
2. Lyric layer performance: style-write counts, layer promotion, bucket blur costs.
3. Bundle splitting (three.js with the Stage), cold start.
4. Keyboard and focus audit, axe scan, Orca pass, 200% zoom, target sizes, Motion = Off.
5. Photosensitivity script, final pass (Expressive default).
6. 8 h soak on the laptop against the OptiPlex, heap snapshots across 20 track changes, server memory.
7. Final critique: taste-skill `inspect.mjs --app` on shell screens, the design-critique format for
   Listen/Library/Settings, top 3 fixes, the five-second test. Write-up in `docs/reviews/M9.md`.
8. Update every doc in `docs/` to match what was built.

**Tests and verification:** P traces on both clients, the a11y suite, the soak log, review documents.

**Completion:** every remaining criterion in `ACCEPTANCE_CRITERIA.md` passes (LIB-02, PERF-01–06,
LYR-26, A11Y-01–09, DS-01/02/04 re-check, DS-05, DS-09, SEC-10, REL-06, DEP-04). **MVP-β is
reached.**

---

## Post-MVP candidates (not scheduled)

Native **desktop client** (Electron ECS for in-app Spotify; `TECHNICAL_ARCHITECTURE.md` §2.2) ·
native **mobile client** (Spotify as Connect remote; `PLAYBACK_ARCHITECTURE.md` §4.7) · passkeys ·
offline beat-grid pre-analysis · ListenBrainz/Last.fm scrobbling · WebGPU/TSL port · lyric
translations · keyboard remapping.
