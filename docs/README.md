# ECHO — Documentation

ECHO is a premium, immersive music player for **Navidrome** and **Spotify**. Its signature feature
is a floating, word-synchronised lyric field in an audio-reactive environment lit by the album
cover. Design direction: **Reverb Chamber**, a dark acoustic room where sound arrives as light,
peaks and decays.

**Project status (2026-10-23):** M1 (foundation) **closed** with one explicit exception: scaffold,
container (Debian 13 base), hardware verification on the OptiPlex, and the typeface decision
(**Mona Sans**). **SEC-10 is an accepted exception, not a pass** (43 unfixed HIGH base-image
findings, time-boxed to M9: [reviews/M1-SEC-10-exception.md](reviews/M1-SEC-10-exception.md)).
Remote CI has not run yet (no repository URL). Status of every M1 criterion:
[reviews/M1.md](reviews/M1.md). **M2 (main player shell and visual system) is in progress.**

These documents are the **source of truth**. When implementation and docs disagree, fix one of them
in the same change. Never leave them diverged.

---

## Reading order

| # | Document | Read it for | Audience |
|---|---|---|---|
| 1 | [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Vision, users, features (F1–F12), screens (S0–S7), journeys, MVP scope, non-goals | everyone |
| 2 | [DESIGN_RESEARCH.md](DESIGN_RESEARCH.md) | Skills used, principles, references, sources for every technical claim, **open questions** | everyone |
| 3 | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Two zones (Stage/Shell), tokens, type, colour roles, components, motion, accessibility | UI work |
| 4 | [LYRICS_EXPERIENCE.md](LYRICS_EXPERIENCE.md) | **The signature feature**: time-as-depth model, word sweep, springs, background field, every edge case | Stage work |
| 5 | [VISUALIZER_SPEC.md](VISUALIZER_SPEC.md) | What may be analysed per provider, feature extraction, visual modes, render passes, palette extraction, quality tiers | Stage work |
| 6 | [PLAYBACK_ARCHITECTURE.md](PLAYBACK_ARCHITECTURE.md) | Provider interface, Spotify and Navidrome adapters, Spotify policy compliance and gates, queue | playback work |
| 7 | [LYRICS_INTEGRATION.md](LYRICS_INTEGRATION.md) | Lyric sources (Navidrome, Spicy Lyrics, LRCLIB), matching, `LyricsDoc` schema, caching, attribution | lyrics work |
| 8 | [SETTINGS_AND_SECURITY.md](SETTINGS_AND_SECURITY.md) | Threat model, secrets, OAuth/PKCE, local server hardening, settings, disconnecting | server work |
| 9 | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Delivery shape, exact stack versions, components, data flow, stores, backend, testing, packaging | everyone building |
| 10 | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Milestones M1–M9 with tasks, dependencies and completion criteria | everyone building |
| 11 | [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) | Testable checklist (IDs referenced by the plan) | review, QA |

A coding agent starting work should read 1, 3, 9 and 10 fully, then the spec(s) for the milestone at
hand.

## Decisions at a glance

| Topic | Decision | Where |
|---|---|---|
| Delivery | **Self-hosted web service:** ECHO server in Docker Compose on the owner's OptiPlex next to Navidrome, behind Caddy, reachable from the public internet. MVP client = browser (Chrome, Chromium, Firefox). Desktop and mobile clients later, on the same `/api/v1` | TECHNICAL_ARCHITECTURE §2 |
| Accounts | Admin + invited users. Argon2id + TOTP (mandatory for admin). Per-user Navidrome and Spotify connections. Secrets encrypted at rest with a master key | SETTINGS_AND_SECURITY §2–§4 |
| Stack | TypeScript, React 19 (shell only), three.js (imperative Stage), DOM lyrics, Zustand, TanStack Query. Hono on Node 24, SQLite, sharp | TECHNICAL_ARCHITECTURE §3 |
| Audio-reactive visuals | Navidrome only (Web Audio in the client on same-origin streams). Spotify has no PCM access, so its visuals are Ambient. Default intensity **Expressive** | VISUALIZER_SPEC §2, §7.4 |
| Spotify | One admin-owned Spotify app (Development Mode: ≤ 5 Spotify users). Per-user PKCE. Web Playback SDK. Strict artwork and attribution rules. Gates G1 (cover colours) and G2 (synced lyrics) **on** by owner decision, with admin kill switches | PLAYBACK_ARCHITECTURE §4 |
| Lyrics | Best sync level wins: user's own files (Navidrome) > Spicy Lyrics (owner's key, server-side, Spotify ID) > LRCLIB. Shared server cache | LYRICS_INTEGRATION §4 |
| Typeface | **Mona Sans** (Latin only), chosen from the M1 specimen. Geologica kept in the specimen for comparison, not shipped | DESIGN_SYSTEM §4, reviews/M1-type.md |
| Palette | Extracted on the server (sharp + material quantiser), roles constrained in OKLCH, interpolated in OKLab, contrast solved against the brightest room pixels | VISUALIZER_SPEC §6, DESIGN_SYSTEM §3 |
| Licence | AGPL-3.0 | TECHNICAL_ARCHITECTURE §9 |

## Product-owner decisions

All decisions from the 2026-10-22 clarifying round are logged in
[DESIGN_RESEARCH.md §7.1](DESIGN_RESEARCH.md#71-product-owner-decisions-2026-10-22). Two items stay
open until M1: the **typeface** (decided by eye from the specimen) and the **reference laptop
model** (recorded in M9).

## Conventions

- Claim labels: **[C]** confirmed (primary source), **[R]** reported, **[A]** assumption to verify in
  a named milestone, **[U]** unverified.
- Cross-references use `FILE.md §n`. Acceptance IDs look like `LYR-07`. Feature IDs `F1`–`F12`.
  Screen IDs `S0`–`S7`. Milestones `M1`–`M9`.
- Review write-ups produced during implementation go in `docs/reviews/M<n>.md`.
