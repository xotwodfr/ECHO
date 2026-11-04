# ECHO — Documentation

ECHO is a premium, immersive music player for **Navidrome**. Its signature feature
is a floating, word-synchronised lyric field in an audio-reactive environment lit by the album
cover. Design direction: **Reverb Chamber**, a dark acoustic room where sound arrives as light,
peaks and decays.

**Project status (2026-11-04):** milestones **M1–M9 are built and tested**, and ECHO is
**deployed** at https://echo.folk3s.com (M5 task 12). Since then: the Material 3 shell (2026-10-25),
NetEase lyrics and Spotify matching, daily backups, and an overnight audit and fix pass
([OVERNIGHT_ENGINEERING_PLAN.md](OVERNIGHT_ENGINEERING_PLAN.md): findings, fixes, evidence, what is
deferred). Since 2026-10-29:

- **Spotify redesign** (2026-10-29, web and Android; [spec](superpowers/specs/2026-10-29-spotify-redesign-design.md)):
  Spotify's layout and features, with play-history mixes. Liquid glass was tried and dropped the
  same day for performance.
- **Fluent 2 with Mica** (2026-10-30, web; [spec](superpowers/specs/2026-10-29-fluent-web-design.md),
  [plan](superpowers/plans/2026-10-30-fluent-web.md), `DESIGN_SYSTEM.md` Draft 6): Fluent surfaces,
  icons and controls, with the playing album's glow behind the frame. The Android app keeps
  Material 3.
- **Library source switch** (2026-11-02; [spec](superpowers/specs/2026-11-02-source-switch-design.md)):
  Navidrome or Spotify, one library at a time. Removed with Spotify the next day.
- **Page colours** (2026-11-02): every page header takes the playing song's colour and fades into
  its glow (`DESIGN_SYSTEM.md` §3.2).
- **Forgotten password** (2026-11-02): `admin-cli.ts reset-password <username>`, for whoever holds
  the master key (`SETTINGS_AND_SECURITY.md` §11).
- **Spring motion** (2026-11-02, web; [spec](superpowers/specs/2026-11-02-spring-motion-design.md),
  [plan](superpowers/plans/2026-11-02-spring-motion.md), `DESIGN_SYSTEM.md` §11): everything that
  appears, leaves, moves or changes animates on the owner's spring; menus, dialogs and panels play
  their exits.

- **Spotify removed** (2026-11-03; [why](reviews/2026-11-03-spotify-outage.md)): Development Mode's
  quota ran out and almost nothing the owner plays is missing from Navidrome. ECHO is Navidrome-only;
  an empty search links to YouTube Music. Matching Navidrome tracks to Spotify ids for Spicy Lyrics
  stays (no Spotify account involved). The deploy's migration deleted the stored Spotify
  connections and app credentials.
- **Wanted list** (2026-11-03): Your Library → Wanted, one list for everyone on the server of music
  that isn't in Navidrome yet; added there or from a search that finds nothing, marked and playable
  once the server's own library has it (`ACCEPTANCE_CRITERIA.md` WNT-01).
- **YouTube Music mode** (2026-11-03; [spec](superpowers/specs/2026-11-03-youtube-music-design.md)):
  a switch in the top bar opens a separate UI for whole listening sessions: YouTube Music's own
  catalogue, search and (with a pasted cookie) your library and likes; the server fetches each
  song's audio with yt-dlp, anonymously, and streams it through ECHO's player
  (`TECHNICAL_ARCHITECTURE.md` §6.6, `PLAYBACK_ARCHITECTURE.md` §11, `ACCEPTANCE_CRITERIA.md` §10d).
- **Liner notes** (2026-11-03; [spec](superpowers/specs/2026-11-03-youtube-liner-notes-design.md)):
  YouTube Music mode in its own magazine look, paper and ink; ECHO's lyrics printed on paper in its
  full-screen player; YouTube songs get Spicy Lyrics' word timing (`LYRICS_INTEGRATION.md` §4.3).
- **Night edition and springs** (2026-11-04): the moon in the masthead (or the device's dark setting)
  turns the paper dark; YouTube Music mode moves on ECHO's springs (`DESIGN_SYSTEM.md` §14).
- **YouTube songs start at once** (2026-11-04): a page's first songs are looked up as it opens, and
  yt-dlp asks as YouTube's visionOS app, whose links play without YouTube's 4–5 s wait: a song
  nobody looked up starts in ~2.5 s instead of 8–14 s (`PLAYBACK_ARCHITECTURE.md` §11.1, YT-09).
- **Review and fixes** (2026-11-04; [record](reviews/2026-11-04-review.md)): web sessions that slide
  in the browser too (ACC-04), deploys that never leave an open tab with a blank Stage (REL-07),
  YouTube thumbnails outside the API budget (YT-10), the §10 clean-ups (ACC-05), unit tests that
  clean up after themselves, the Caddy block answering only the tunnel, the live compose's resource
  limits, and an off-box backup script (DEP-05, the remote still to set up). What is still open is
  in the record.
- **Performance mode** (2026-11-04, F16, PERF-07): one switch in Settings → Visuals for a slower
  computer, on that device: smaller animations and a still Listen room, lyrics still moving word by
  word. Measured on a throttled browser: Listen 7 → 60 fps, page changes 40 → 57.
- **Native apps** (2026-11-04, F14, `ACCEPTANCE_CRITERIA.md` §10e): baselines beside the Android
  app in `Linux/` (GTK 4, run here), `Windows/` (WPF, builds), `macOS/` and `iOS/` (SwiftUI, need a
  Mac): sign in, albums, an album, playback.

**Live** at echo.folk3s.com: all of the above, `main` `b3968ee` since 2026-11-04 13:34 UTC (the
native apps that follow it change nothing on the server).
**Known failing:** Firefox LYR-17 (a scrubber click half a second ahead in the lyrics view, from
the Selawik commit on, cause not found); `listen-frame-390` flips between two renders in full
visual runs; the Home screenshots (`shell.visual`, paused player) fail whenever the masked
greeting's box differs in width from the baseline's ("Good morning", "Good evening"), so they
depend on the time of day; settings ACC-03 fails when run together with other specs and passes
alone; Firefox Made For You and "a menu animates out" fail in some full runs and pass alone
(`reviews/2026-11-04-review.md`). SEC-10 passes strictly (distroless runtime). Still open, all
needing the owner, people or real devices: the off-box backup's remote (DEP-05), the Windows and
Apple apps on their platforms (NAT-03 to NAT-05), the TLS grade A (Cloudflare minimum TLS 1.2) and the cookie flags checked in DevTools
(SEC-19; the on-box backup drill passed on 2026-10-24), the reference-client tuning and PERF-01, the 8 h soak
(REL-06), the Orca pass, the five-second test (DS-05), and the 10-bit capture (VIS-09). Per-milestone records: [reviews/](reviews/) (M1–M9, plus
[M8-security.md](reviews/M8-security.md) for the pre-share security review).

These documents are the **source of truth**. When implementation and docs disagree, fix one of them
in the same change. Never leave them diverged.

---

## Reading order

| # | Document | Read it for | Audience |
|---|---|---|---|
| 1 | [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Vision, users, features (F1–F16), screens (S0–S7), journeys, MVP scope, non-goals | everyone |
| 2 | [DESIGN_RESEARCH.md](DESIGN_RESEARCH.md) | Skills used, principles, references, sources for every technical claim, **open questions** | everyone |
| 3 | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Two zones (Stage/Shell), tokens, type, colour roles, components, motion, accessibility | UI work |
| 4 | [LYRICS_EXPERIENCE.md](LYRICS_EXPERIENCE.md) | **The signature feature**: time-as-depth model, word sweep, springs, background field, every edge case | Stage work |
| 5 | [VISUALIZER_SPEC.md](VISUALIZER_SPEC.md) | What may be analysed per provider, feature extraction, visual modes, render passes, palette extraction, quality tiers | Stage work |
| 6 | [PLAYBACK_ARCHITECTURE.md](PLAYBACK_ARCHITECTURE.md) | Provider interface, the Navidrome adapter, queue (the Spotify adapter's sections are stubs since 2026-11-03) | playback work |
| 7 | [LYRICS_INTEGRATION.md](LYRICS_INTEGRATION.md) | Lyric sources (Navidrome, Spicy Lyrics, NetEase, LRCLIB), Spotify matching, `LyricsDoc` schema, caching, attribution | lyrics work |
| 7a | [SYNCED_LYRICS_RESEARCH.md](SYNCED_LYRICS_RESEARCH.md) | How AMLL, Spicy Lyrics, Beautiful Lyrics and YouLy+ do word sync and where they get it; what ECHO took | lyrics rendering |
| 8 | [SETTINGS_AND_SECURITY.md](SETTINGS_AND_SECURITY.md) | Threat model, secrets, OAuth/PKCE, local server hardening, settings, disconnecting | server work |
| 9 | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Delivery shape, exact stack versions, components, data flow, stores, backend, testing, packaging | everyone building |
| 10 | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Milestones M1–M9 with tasks, dependencies, completion criteria and progress | everyone building |
| — | [api/openapi.yaml](api/openapi.yaml) | Every `/api/v1` route (contract-tested) | client and server work |
| 11 | [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) | Testable checklist (IDs referenced by the plan) | review, QA |

A coding agent starting work should read 1, 3, 9 and 10 fully, then the spec(s) for the milestone at
hand.

## Decisions at a glance

| Topic | Decision | Where |
|---|---|---|
| Delivery | **Self-hosted web service:** ECHO server in Docker Compose on the owner's OptiPlex next to Navidrome, behind Caddy and a Cloudflare tunnel (https://echo.folk3s.com). MVP client = browser (Chrome, Chromium, Firefox). Native apps on the same `/api/v1`: Android (the full app), and Linux, Windows, macOS and iOS baselines (2026-11-04), each on its platform's toolkit | TECHNICAL_ARCHITECTURE §2 |
| Accounts | Admin + invited users. Argon2id + TOTP (mandatory for admin). Per-user Navidrome connections. Secrets encrypted at rest with a master key | SETTINGS_AND_SECURITY §2–§4 |
| Stack | TypeScript, React 19 (shell only), three.js (imperative Stage), DOM lyrics, Zustand. Hono on Node 24, SQLite, sharp | TECHNICAL_ARCHITECTURE §3 |
| Audio-reactive visuals | Navidrome only (Web Audio in the client on same-origin streams). Ambient when no analysis exists. Default intensity **Expressive** | VISUALIZER_SPEC §2, §7.4 |
| Spotify | Removed 2026-11-03 (Development Mode's quota). Music not in Navidrome: YouTube Music mode, and a YouTube Music link on an empty search | `reviews/2026-11-03-spotify-outage.md` |
| YouTube Music | A separate mode (per device), web only. Browsing through InnerTube (youtubei.js), the user's cookie only for their library and likes; audio resolved by yt-dlp on the server, never with a cookie, streamed through ECHO. Breaks YouTube's terms: an admin switch turns it off for everyone | TECHNICAL_ARCHITECTURE §6.6 |
| Lyrics | Best sync level wins: user's own files (Navidrome) > Spicy Lyrics (owner's key, server-side, Spotify ID; Navidrome tracks matched in the background) > NetEase > LRCLIB. Shared server cache | LYRICS_INTEGRATION §4 |
| Typeface | Web (Draft 6, `fluent-web`): **Segoe UI** where installed, **Selawik** (Microsoft's open Segoe fallback) shipped, lyrics included. Before it: Figtree (Spotify redesign, 2026-10-29), Roboto Flex under Material 3 (2026-10-25), Mona Sans from the M1 specimen. YouTube Music mode: **Fraunces** and **Instrument Sans** (Liner notes) | DESIGN_SYSTEM §4, §14, reviews/M1-type.md |
| Palette | Extracted on the server (sharp + material quantiser), roles constrained in OKLCH, interpolated in OKLab, contrast solved against the brightest room pixels | VISUALIZER_SPEC §6, DESIGN_SYSTEM §3 |
| Licence | AGPL-3.0 | TECHNICAL_ARCHITECTURE §9 |

## Product-owner decisions

All decisions from the 2026-10-22 clarifying round are logged in
[DESIGN_RESEARCH.md §7.1](DESIGN_RESEARCH.md#71-product-owner-decisions-2026-10-22). Later
decisions are recorded in the milestone reviews. The typeface was decided in M1 (Mona Sans); the
**reference laptop model** is still to be recorded by the owner (M9 task 1, `reviews/M9.md`).

## Conventions

- Claim labels: **[C]** confirmed (primary source), **[R]** reported, **[A]** assumption to verify in
  a named milestone, **[U]** unverified.
- Cross-references use `FILE.md §n`. Acceptance IDs look like `LYR-07`. Feature IDs `F1`–`F16`.
  Screen IDs `S0`–`S7`. Milestones `M1`–`M9`.
- Review write-ups produced during implementation go in `docs/reviews/M<n>.md`.
