# ECHO — Acceptance Criteria

Status: **Draft 2** (criteria unchanged; status below) · Last reviewed 2026-10-28
Every criterion is testable. **Method:** U = Vitest unit, E = Playwright E2E, V = Playwright visual
snapshot (deterministic mode), M = manual checklist, I = inspection (code/config review or a script),
P = performance trace. **MS** = the milestone that must pass it (`IMPLEMENTATION_PLAN.md`). A milestone
is not done until all of its criteria pass.

## Status at 2026-10-28

Every criterion that a test on this machine can decide has a test, and the suites pass on the
2026-10-28 tree:
- Vitest 1277.
- Playwright on the host: 367 passed, 0 failed, 90 skipped.
- Playwright in CI's own image under Xvfb (`scripts/e2e-container.sh`): 381 passed, 0 failed, 78
  skipped, Firefox with WebGL included.

Evidence per criterion is in `docs/reviews/M1.md` … `M9.md` and `M8-security.md`. The overnight
audit's findings and fixes are in `docs/OVERNIGHT_ENGINEERING_PLAN.md`. ECHO is deployed at
https://echo.folk3s.com. **Still open**, grouped by what they wait for:

| Waiting for | Criteria |
|---|---|
| **The owner's Cloudflare setting and a DevTools look** | SEC-19 (TLS grade B → A with minimum TLS 1.2; the cookie flags, check 4 of `reviews/M8-security.md`). DEP-03's on-box drill passed on 2026-10-24 (check 8) |
| **A Spotify app and Premium account** (manual checklist, `reviews/M7.md`) | PLAY-08, PLAY-09, the M parts of SP-01, SRCH-02, REL-04, BRW-02 |
| **The owner's laptop and gaming PC** | PERF-01, the reference runs of PERF-03 and LYR-26 (measured here: 0.7 ms frame, 0.2 ms lyrics), REL-06 (8 h soak), DEP-04 under real Navidrome transcoding, VIS-03 client timing on real covers |
| **People** | DS-05 (five-second test), A11Y-04 M (Orca), A11Y-09 M (200 % zoom by eye; E passes) |
| **A 10-bit capture setup** | VIS-09 M (the dither test passes; the criterion asks for a 10-bit capture, which Playwright cannot make) |
| **The owner's look in motion** (then V baselines, `reviews/M3.md`) | the V parts of LYR-02, LYR-03, LYR-05, LYR-07, LYR-08, LYR-11, LYR-20, LYR-21; M6 task 7 real-song tuning |
| **A hosted CI run** (no remote, by the owner's choice) | None of the criteria themselves: DS-06's baselines and VIS-07's Firefox context loss pass in CI's own image locally (`scripts/e2e-container.sh`, 2026-10-28). Only the GitHub Actions run itself is unproven |

---

## 0. Test conditions

- **Reference clients (performance):** (1) **the owner's everyday laptop**, the performance floor:
  its iGPU and native resolution, to be recorded by the owner (Q-AC-1, `reviews/M9.md`); (2) **the owner's
  gaming PC**, which must reach tier T0. Browsers: Google Chrome stable (visual baselines), Chromium
  (Arch) and Firefox stable (functional parity).
- **Reference server:** the owner's **Dell OptiPlex 7010 (i7-3770, 24 GB)** (CPU corrected in M1 from the real box) running ECHO and Navidrome
  in Docker Compose behind Caddy.
- **Viewports:** 1440×900 (primary), 2560×1440, 1024×640 (minimum full), 390×844 (compact).
- **Fixtures:** `fixtures/lyrics/*` (`LYRICS_EXPERIENCE.md` §16), the mock Subsonic server, 30 fixture
  covers (incl. greyscale, near-white, neon, bordered, text-heavy), `compose.test.yaml` (Caddy with an
  internal CA + ECHO + mock Subsonic).
- **Manual-only areas:** real Spotify (Premium + Widevine in each browser), the real deployment over
  the internet (phone hotspot), screen readers (Orca).

## 1. Playback & transport (F5)

| ID | Criterion | Method | MS |
|---|---|---|---|
| PLAY-01 | Playing a Navidrome album track starts audio within 1.5 s on LAN and within 3 s over the internet (time from click to `playing`) | E (mock) + M | M5 |
| PLAY-02 | Play/pause, previous (restart if > 3 s), next, seek, volume, shuffle and repeat behave per `PLAYBACK_ARCHITECTURE.md` §3 | E | M5 |
| PLAY-03 | Seeking a raw stream lands within ±250 ms of the target. A transcoded stream with `transcodeOffset` lands within ±1 s. Without it, seek is disabled with the documented tooltip | E (mock) + M | M5 |
| PLAY-04 | Gapless: the gap between consecutive album tracks is < 50 ms (measured from `ended` to next `playing`) when crossfade is 0 | M (with a gapless test album) | M5 |
| PLAY-05 | ReplayGain `auto` applies album gain in album context and track gain otherwise. The peak prevents clipping | U + M | M5 |
| PLAY-06 | Scrobble: `submission=false` at start, `submission=true` at min(50%, 4 min), once per play | E (mock records calls) | M5 |
| PLAY-07 | Media Session metadata and actions work (OS media keys play/pause/next/previous) | M | M5 |
| PLAY-08 | Spotify: ECHO appears as device "ECHO". Transfer, play context, pause, seek, next/previous, volume, shuffle and repeat work | M | M7 |
| PLAY-09 | Spotify remote state (playback moved to another device) shows "Playing on …" and "Play here" works | M | M7 |
| PLAY-10 | The scrubber shows the lyric line at the hovered or dragged time | E | M6 |

## 2. Queue (F6)

| ID | Criterion | Method | MS |
|---|---|---|---|
| QUE-01 | Play next / Add to queue / reorder (drag and `Alt+↑/↓`) / remove / clear work for Navidrome. The UI matches `queueStore` after each operation | E | M5 |
| QUE-02 | Shuffle shuffles `context` only, preserves `nextUp` order, and toggling off restores the original context order | U | M5 |
| QUE-03 | A queue never contains tracks from two providers. Starting the other provider prompts "Replace the queue?" | E | M7 |
| QUE-04 | Spotify queue is read-only except Add. Reorder/remove/clear controls are absent and the explanation is shown | E (fake provider) + M | M7 |
| QUE-05 | Queue and position persist across reload (server-side, per user) and restore paused | E | M5 |

## 3. Library & search (F7, F8)

| ID | Criterion | Method | MS |
|---|---|---|---|
| LIB-01 | Albums grid with 4 sorts, Artists, Playlists, Starred and Album detail render from the mock server. Grid edges land on both gutters at 1024, 1440 and 2560 widths | E + V | M5 |
| LIB-02 | A library of 5,000 albums scrolls at ≥ 55 fps (virtualised, ≤ 150 album tiles in the DOM) | P | M9 |
| LIB-03 | Covers show the cached dominant colour (or `--surface-2`) until loaded, with no layout shift (CLS 0) | E | M5 |
| SRCH-01 | `/` and `Ctrl/⌘+K` open search. Results appear ≤ 200 ms after typing stops on the mock server. Arrow keys move the highlight, `Enter` plays, `Shift+Enter` queues, `→` opens the album | E | M5 |
| SRCH-02 | With both providers connected, results are grouped with a provider mark and Navidrome first. Spotify results respect limit ≤ 10 per page | E (fake) + M | M7 |

## 4. Floating lyrics (F2), the signature

| ID | Criterion | Method | MS |
|---|---|---|---|
| LYR-01 | For every fixture and 50 sample times each, `activeIndexAt(t)`, `handoverAt` and rank assignment match the expected tables | U | M3 |
| LYR-02 | The active line's centre is at `0.40 H ± 2 px` once settled. Its centre does not move more than 2 px (beats included) while active, and the beat scale pulse stays ≤ 1.5% | U (layout) + V | M3 |
| LYR-03 | Upcoming +1…+3 are below the active line, increase in opacity and clarity toward it (opacity +1 > +2 > +3, blur +1 < +2 < +3), and never overlap the active line's box | V + U | M3 |
| LYR-04 | Gap between upcoming lines grows with their time gap (`LYRICS_EXPERIENCE.md` §4.3), checked on a fixture with known gaps | U | M3 |
| LYR-05 | Approach drift: on the ballad fixture, +1's `y` decreases monotonically during the active line (sampled every 100 ms) and stays clear of the active box by ≥ 0.02 H | U | M3 |
| LYR-06 | Hand-over has no hard cut: across a hand-over, no line's rendered position changes by more than 0.08 H between consecutive 60 Hz frames (except after a seek) | U (frame simulation) | M3 |
| LYR-07 | Word sweep: at time `t` inside word `w`, `--p` equals `(t − w.start)/(w.end − w.start)` ± 1%. Words before are fully lit and words after unlit | U + V | M3 |
| LYR-08 | Glow appears only on the sweeping word (and the previous one fading out), within the alpha and radius caps | U + V | M3 |
| LYR-09 | Emphasis triggers only for words ≥ 1000 ms with 2–7 graphemes (CJK: duration only), never for words < 150 ms, and swell ≤ 8% | U | M3 |
| LYR-10 | Past lines decay (opacity follows `e^{−Δt/520 ms}` ± 5%), at most 2 are visible, and they are removed below 0.02 opacity | U | M3 |
| LYR-11 | Background field: ≤ 24 lines (T0), seeded placement identical across runs for the same track, nothing inside the reading corridor above z 0.85 / opacity 0.10. Each line's drift stays within its amplitude | U + V | M3 |
| LYR-12 | A background line entering +3 travels from its home position (no pop-in). Its opacity is continuous across the transition | U | M3 |
| LYR-13 | Line-timed fixture: no per-word sweep. The whole-line wash runs 420 ms at line start | U + V | M3 |
| LYR-14 | Untimed fixture: static sheet, scrollable by keyboard and wheel, with the "not time-synced" note and attribution | E | M3 |
| LYR-15 | Missing lyrics → Cover mode with "No lyrics found" and the sources tried | E | M6 |
| LYR-16 | Delayed response: dots appear at 600 ms (± 50), "Finding lyrics…" at 1.5 s, Cover mode at 6 s. A late arrival follows `LYRICS_EXPERIENCE.md` §9.5 | E (mock delays) | M6 |
| LYR-17 | Pause freezes `t`. The glow dims to 60% over 600 ms and the background drifts at 25%. Resume restores within 300 ms | U + E | M3 |
| LYR-18 | Scrub drag: lines follow the scrub time with no springs or stagger. After release they settle with the slow spring in ≤ 900 ms | E | M3 |
| LYR-19 | Rapid skipping (5 track changes in 3 s) never shows another track's lyrics, and the final track's lyrics appear within 1 s of its cache hit | E (mock) | M6 |
| LYR-20 | Coalescing: on the rap fixture, no line is shown active for less than 350 ms of visual dwell, and each line's words still sweep at their times | U | M3 |
| LYR-21 | Interlude dots appear for gaps ≥ 7 s (including the intro) and leave 500 ms before the next hand-over | U + V | M3 |
| LYR-22 | Resize (1440 → 1024 → 2560) re-lays out within 120 ms of the last resize event without springs, and no line overflows the stage | E + V | M3 |
| LYR-23 | Duet fixture: agents stay on their sides for the whole song. Background vocals render under their lead line at 0.62× | V | M3 |
| LYR-24 | RTL fixture sweeps right-to-left. CJK fixture sweeps per character with no tracking | V | M3 |
| LYR-25 | Timing offset `[`/`]` shifts the lyric clock by ±50 ms per press, shows a toast, persists per track, and does not shift visual features | E + U | M6 |
| LYR-26 | Lyric layer `update()` ≤ 2.5 ms per frame at T0 on the reference machine with the ballad fixture | P | M9 |
| LYR-27 | Long-line fixture: no line exceeds 3 rows at 1024×640, and the transition zone overflow rule keeps +3 above 0.86 H | V + U | M3 |

## 5. Lyrics integration (F12)

| ID | Criterion | Method | MS |
|---|---|---|---|
| LI-01 | Parsers produce valid `LyricsDoc`s for: Spicy `Syllable`/`Line`/`Static` samples, LRC, enhanced LRC, OpenSubsonic structured (with and without `cueLine`). Invalid inputs are repaired or rejected per `LYRICS_INTEGRATION.md` §5 | U | M6 |
| LI-02 | Selection picks the highest sync level, then precedence S1 > S2 > S3 > S4, and a pin overrides both | U | M6 |
| LI-03 | Match validation rejects candidates with duration off by > 3 s or title similarity < 0.85 (metadata sources) | U | M6 |
| LI-04 | Timeouts and retries per source, circuit breaker after 5 failures (10 min), `Retry-After` honoured, overall answer ≤ 4.5 s | U (fake clock) | M6 |
| LI-05 | Attribution is rendered for every source per `LYRICS_INTEGRATION.md` §8 and cannot be disabled | E + I | M6 |
| LI-06 | Spicy entries are deleted after 30 days and never served stale. Negative caching follows the TTL table | U | M6 |
| LI-07 | The Spicy key is used server-side only: no request from the browser to `api.spicylyrics.org`, and the key never appears in any client-visible response | E (network log) + I | M6 |
| LI-08 | Navidrome tracks get Spotify IDs from Navidrome's own metadata (never the request): stored per track, manual corrections win, the sweep is resumable and can be switched off (rebuilt 2026-10-24, `LYRICS_INTEGRATION.md` §4.3) | U, E2E | M7 |

## 6. Visual environment & palette (F3, F4)

| ID | Criterion | Method | MS |
|---|---|---|---|
| VIS-01 | Reverb, Ambient and Still modes render per `VISUALIZER_SPEC.md` §4. `Auto` picks Reverb for Navidrome and Ambient for Spotify | V + E | M5 |
| VIS-02 | Palette roles satisfy their OKLCH boxes for all 30 fixture covers. Achromatic covers produce the Sodium fallback with no invented hue. Near-white covers produce a dark room | U | M4 |
| VIS-03 | Palette is ready ≤ 150 ms after track change when cached, ≤ 600 ms uncached (local server) | E | M4 |
| VIS-04 | Track change interpolates all roles in OKLab over 1200 ms with no frame-to-frame ΔE_ok jump > 0.02. A mid-transition retarget is continuous | U | M4 |
| VIS-05 | Lyric contrast floors (`DESIGN_SYSTEM.md` §3.4) hold for all fixture covers in every mode, at the brightest moment of the stress fixture, measured from deterministic frames | V + script | M4 |
| VIS-06 | Onsets spawn ≤ 3 rings. Bass breathing ≤ ±10% exposure. No spectrum bars, waveforms or particles anywhere | V + I | M5 |
| VIS-07 | WebGL context loss shows the CSS room and fully recovers on restore. No WebGL2 → CSS room with the notice | E | M2 |
| VIS-08 | Feature extraction ≤ 0.6 ms per frame. Silent-analyser detection switches to Ambient within 3 s | P + E | M5 |
| VIS-10 | Intensity setting: Subtle/Balanced/Expressive apply `VISUALIZER_SPEC.md` §7.4. **Expressive is the default.** The active line and transition zone behave identically at all three | U + V | M5 |
| VIS-09 | Dither is present (no visible banding in a 10-bit-captured dark gradient frame, checked on a 4× zoomed screenshot) | V + M | M2 |

## 7. Design quality (DESIGN_SYSTEM.md)

| ID | Criterion | Method | MS |
|---|---|---|---|
| DS-01 | No raw colour, size, duration or easing values in component code. Everything references tokens (`grep` script for hex/px/ms literals outside `tokens.css` and `lyricsConfig.ts`, with an allow-list) | I | M2, M9 |
| DS-02 | Shell screens: no gradients, glows, backdrop blur, monospace, transformed capitals, emoji or icon-in-tinted-square; letter-spacing only from the M3 tracking tokens, shadows only from the M3 elevation tokens on floating surfaces. *(2026-10-25: the ≤ 3% coloured-pixel budget is retired with Material 3, whose surfaces take the album's tone by design; DESIGN_SYSTEM.md §3.2)* | I + script on the stylesheets | M2, M9 |
| DS-03 | Mona Sans (the M1 typeface decision) actually renders, verified via `document.fonts` and computed style. `tnum` changes digit widths (or the `system-ui` numeral fallback of `DESIGN_SYSTEM.md` §4.1 is applied). *Wording aligned with the decision in M1: it previously named the pending candidate and Noto fallbacks, which §4.1 excludes* | E | M1 |
| DS-04 | Squint test: a 16 px Gaussian-blurred 1440×900 Listen screenshot shows exactly three dominant masses (active line, dock, room) | V + M review | M2, M9 |
| DS-05 | Five-second test: 3 of 3 people (or 3 independent model reviews of the screenshot) can say "a music player showing the song's lyrics" | M | M9 |
| DS-06 | Every component in `DESIGN_SYSTEM.md` §9 has default/hover/pressed/focus-visible/disabled states (plus loading where relevant), shown on an internal `/__ui` page and snapshotted | V | M2 |
| DS-07 | Every block has designed loading/empty/error/offline states (`DESIGN_SYSTEM.md` §10) with no layout shift between loading and ready | V | M8 |
| DS-08 | Artwork is never cropped, overlaid, scaled or animated. Radii are 4 or 8 px only | I + V | M2, M7 |
| DS-10 | Typeface decision recorded in `docs/reviews/M1-type.md`. `DESIGN_SYSTEM.md` §4 and `--font` name exactly one family. The unused face is not shipped | I | M1 |
| DS-09 | Critique record: a written design critique (design-critique format + taste-skill app-screen questions) for Listen, Library and Settings, with its top 3 fixes applied | M | M9 |

## 8. Performance

| ID | Criterion | Method | MS |
|---|---|---|---|
| PERF-01 | Listen stage at T0, 2560×1440, reference machine: ≥ 58 fps median, p95 frame ≤ 20 ms over 60 s of the ballad fixture | P | M9 |
| PERF-02 | The governor steps down within 1.5 s of sustained overload (simulated GPU load) and never oscillates more than once per 20 s | U + P | M9 |
| PERF-03 | Stage main-thread work ≤ 4 ms per frame (lyrics ≤ 2.5, features ≤ 0.6) at T0 | P | M9 |
| PERF-04 | Hidden tab: 0 rAF callbacks and analyser polling stops. Audio continues | E | M2 |
| PERF-05 | Cold start to interactive shell ≤ 1.5 s on LAN, ≤ 3 s over the internet (cached assets: ≤ 1 s). JS bundle for the shell ≤ 350 KB gzip, three.js chunk loaded with the Stage | P + I | M9 |
| PERF-06 | No memory growth > 20 MB across 20 consecutive track changes (heap snapshot) | P | M9 |

## 9. Accessibility

| ID | Criterion | Method | MS |
|---|---|---|---|
| A11Y-01 | Every function in `PRODUCT_SPEC.md` §7 works by keyboard alone. Shortcuts don't fire in text fields | E | M9 |
| A11Y-02 | Visible focus on every control (2 px `--focus` + offset), never obscured by the dock or sheets | V + E | M9 |
| A11Y-03 | Shell text and UI contrast per `DESIGN_SYSTEM.md` §3.1 (automated axe scan: 0 serious/critical) | E (axe) | M9 |
| A11Y-04 | Hidden lyric transcript has `aria-current` on the active line. Opt-in announcements are coalesced to ≤ 1 per 1.5 s | E + M (Orca) | M9 |
| A11Y-05 | Reduced motion: every Stage behaviour matches `LYRICS_EXPERIENCE.md` §10 and `VISUALIZER_SPEC.md` (Still). The palette still interpolates | V + E (`emulateMedia({ reducedMotion: 'reduce' })`) | M3, M9 |
| A11Y-06 | Motion = Off gives a static sheet and a frozen environment while music continues (WCAG 2.2.2) | E | M9 |
| A11Y-07 | Target sizes ≥ 24×24 everywhere, transport ≥ 40 px | I + script | M9 |
| A11Y-08 | Photosensitivity: over 10 s of the stress fixture at 30 fps, no 4×4 region's mean relative luminance changes by > 0.08 within any 333 ms window. No saturated-red flashes | Script on recorded frames | M5, M9 |
| A11Y-09 | Shell at 200% zoom: no loss of content or function at 1440×900 | M | M9 |
| A11Y-10 | Scrubber is a `role="slider"` with spoken `aria-valuetext`. Arrow, Shift+Arrow, Home and End work | E | M2 |

## 10. Security (public deployment)

| ID | Criterion | Method | MS |
|---|---|---|---|
| SEC-01 | Wrong `Host` → 421. Cookie-authenticated unsafe method without the matching `Origin` → 403. No CORS headers on any response | U (`app.request`) | M5 |
| SEC-02 | Every route outside the documented unauthenticated surface (`SETTINGS_AND_SECURITY.md` §5.5) returns 401 without a valid session or device token (route table enumerated in the test) | U | M5 |
| SEC-03 | No secret appears in any client bundle, `localStorage`/IndexedDB, any API response, the DB in plaintext (dump + grep for fixture secrets), or the repo (gitleaks clean) | I + E | M8 |
| SEC-04 | Redaction: every secret type through every log path (incl. Caddy log filter for signed URLs), with no substring present | U + I | M8 |
| SEC-05 | Subsonic proxy rejects non-allow-listed methods with 403 | U | M5 |
| SEC-06 | After each disconnect or account deletion, no row or ciphertext for that connection or user remains. Shared caches contain no user data | U + M | M8 |
| SEC-07 | Spotify PKCE: `state` is single-use, bound to the session user, and validated in constant time. The verifier never reaches a client. Refresh tokens never leave the server | U + I | M7 |
| SEC-08 | Security headers and CSP as specified (`SETTINGS_AND_SECURITY.md` §5.4), with no CSP violations during the full E2E run | E + M | M8 |
| SEC-09 | Container runs non-root, read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, no published ports | I (compose + `docker inspect`) | M8 |
| SEC-10 | `pnpm audit --prod` and Trivy show no high or critical findings. Install scripts restricted per `SETTINGS_AND_SECURITY.md` §12. *M1 closed on an owner-accepted, time-boxed exception for 43 unfixed HIGH base-image findings (`reviews/M1-SEC-10-exception.md`, expires at the M9 re-check). An exception lets a milestone close but is recorded as an exception, never as a pass; this criterion is unchanged* | I (CI) | M1, M9 |
| SEC-11 | **Isolation:** user B cannot read or modify user A's connections, settings, queue, overrides, sessions or streams (incl. signed URLs) through any route | U (suite) | M8 |
| SEC-12 | Login: generic errors with equal timing for unknown users. Per-IP and per-account limits and lockout behave as specified (`SETTINGS_AND_SECURITY.md` §4.4). Lockouts are audited | U | M5 |
| SEC-13 | TOTP: RFC 6238 test vectors pass. ±1 step tolerance. Replay of a used step is rejected. Admin cannot exist or log in without TOTP. Recovery codes are single-use | U + E | M5 |
| SEC-14 | Sessions and device tokens are stored hashed, expire per the table, are revocable individually and all-at-once, and a password change revokes all others | U + E | M8 |
| SEC-15 | Secrets are AES-256-GCM encrypted with AAD (a ciphertext moved to another row fails to decrypt). Server refuses to start without a valid master key. Rotation re-encrypts all values | U | M5 |
| SEC-16 | Signed stream URLs expire after 6 h, are bound to user + track, and fail when tampered with | U | M8 |
| SEC-17 | Navidrome URL SSRF rules: private, loopback, link-local and metadata targets rejected for non-admin URLs; DNS-rebinding pin works | U | M5 |
| SEC-18 | `X-Forwarded-*` trusted only from the configured proxy. Spoofed headers from elsewhere don't change the client IP used by rate limits | U | M5 |
| SEC-19 | **Pre-share security review** completed on the live deployment (`IMPLEMENTATION_PLAN.md` M8 task 11): TLS (testssl.sh grade A or better), headers, unauthenticated surface, cookie flags (`__Host-`, Secure, HttpOnly, Lax) | M (document) | M8 |

## 10a. Accounts, devices and API

| ID | Criterion | Method | MS |
|---|---|---|---|
| ACC-01 | First start prints a setup URL (30 min TTL, regenerated per restart). Setup creates the admin with mandatory TOTP and shows recovery codes. `/setup` is 404 afterwards | E | M5 |
| ACC-02 | Invites are single-use, expire after 72 h, and create a user who sees none of the admin's data | E | M8 |
| ACC-03 | Account deletion requires password + TOTP and removes the user's data. The last admin cannot delete themselves | E + U | M8 |
| MU-01 | The queue and position follow the user between two browsers or devices. Simultaneous play shows the "changed on another device" notice | E (two contexts) | M5 |
| API-01 | `docs/api/openapi.yaml` describes every `/api/v1` route. Contract tests validate responses against it | U | M8 |
| API-02 | A non-browser client can log in via `POST /api/v1/auth/device` (with TOTP), use the bearer token, stream via a signed URL, and be revoked | E (scripted HTTP client) | M8 |

## 10b. Deployment

| ID | Criterion | Method | MS |
|---|---|---|---|
| DEP-01 | `docker compose up -d` on the OptiPlex with the example compose and Caddyfile yields a working HTTPS instance. `isSecureContext` is true in the client | M + compose smoke | M5 |
| DEP-02 | Audio streams through Caddy without buffering (first audio byte ≤ 300 ms after Navidrome's), Range seeking works through the proxy, and transcoded seeking works via `timeOffset` | E (compose smoke) + M | M5 |
| DEP-03 | Backup and restore drill: restore DB + master key on a fresh container, and all users and connections work. Restore without the key → connections need re-entry, nothing else breaks | M | M8 |
| DEP-04 | On the OptiPlex (i7-3770): native modules load. Argon2id 150–250 ms. Palette extraction ≤ 150 ms per cover. Server RSS ≤ 300 MB with 3 concurrent listeners. 3 concurrent remote streams with Navidrome transcoding don't stutter | P + M | M1, M9 |

## 10c. Browsers

| ID | Criterion | Method | MS |
|---|---|---|---|
| BRW-01 | The full E2E suite passes on **Chromium and Firefox** | E | M5 (and every later milestone) |
| BRW-02 | Spotify connect in Chromium without Widevine and in Firefox with DRM disabled each show their specific fix-it guidance. With them fixed, playback works (manual) | E (stubbed EME) + M | M7 |

## 11. Reliability

| ID | Criterion | Method | MS |
|---|---|---|---|
| REL-01 | Navidrome server stopped mid-song: buffered audio continues, the dock shows "unreachable" with backoff, and recovery is automatic within one backoff interval after the server returns | E (mock kill/restart) | M5 |
| REL-02 | Stream error → up to 3 reloads at position, then skip with a toast | E (mock faults) | M5 |
| REL-03 | Lyric sources failing (timeouts, 500s, 429s) never block playback or palette | E (mock) | M6 |
| REL-04 | Spotify `not_ready` / auth expiry / Premium missing each produce their documented UI state | M + E (fake) | M7 |
| REL-05 | ECHO server unreachable while a client is open → the dock status with retry. Buffered audio continues. A 401 (expired session) → the login sheet returns to the same screen | E | M8 |
| REL-06 | 8 h soak test (continuous album playback at T0): no crash, no memory growth > 50 MB, no audio dropouts attributable to ECHO | M + P | M9 |

## 12. Spotify compliance

| ID | Criterion | Method | MS |
|---|---|---|---|
| SP-01 | Artwork, title, artist and the Spotify logo (≥ 70 px wide) are visible whenever Spotify audio plays, in every view mode and with chrome hidden | V (fake) + M | M7 |
| SP-02 | Spotify metadata links to `open.spotify.com` | E | M7 |
| SP-03 | No disk caching of Spotify artwork, metadata or audio. Only derived palettes are cached (30-day TTL), and source images are never written to disk | I + U | M7 |
| SP-04 | Gates G1 and G2 default **on** (owner decision 2026-10-22): Spotify tracks get art-derived colour and synced lyrics. Switching either off in Admin takes effect on the next track (fallback palette / untimed sheet) without a restart | E (fake) | M7 |
| SP-05 | No Audio Features/Analysis/Recommendations calls, no audio capture APIs (`getDisplayMedia`, `getUserMedia`) anywhere in the code | I (grep) | M7 |
| SP-06 | No crossfade, mixing or mixed-provider queue with Spotify | U + E | M7 |
