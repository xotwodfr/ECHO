# ECHO — Product Specification

> **Navidrome only since 2026-11-03.** Spotify was removed (`824eeb9`, `8f2c1b2`; why:
> [reviews/2026-11-03-spotify-outage.md](reviews/2026-11-03-spotify-outage.md)). Music that
> is not in Navidrome is found on YouTube Music through a link on an empty search, and since the
> evening of 2026-11-03 played in **YouTube Music mode** (F15), a separate UI beside the Navidrome
> one. The MVP history in §10 still names Spotify, as it was built then.

Status: **Draft 2 — source of truth for scope** · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Design system](DESIGN_SYSTEM.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Acceptance criteria](ACCEPTANCE_CRITERIA.md) · [Implementation plan](IMPLEMENTATION_PLAN.md)

This document says **what** ECHO is and **what it must do**. How it looks is in `DESIGN_SYSTEM.md`, how
it moves in `LYRICS_EXPERIENCE.md` and `VISUALIZER_SPEC.md`, and how it is built in
`TECHNICAL_ARCHITECTURE.md`.

---

## 1. Vision

ECHO is a listening room, not a catalogue. You open it to *hear one song well*. When a song plays,
the screen becomes a dark room lit by the song itself: its words hang in the air and come toward you
as they are about to be sung, and the line being sung lights up word by word in the colours of the
album cover. Sung lines fade like reverb. Browsing, search and settings are quiet, precise tools that
get out of the way.

**The idea, in one sentence** (taste-skill step 4, "something that belongs to the subject becomes the device"):

> In ECHO, **the physics of an echo** — a sound arriving, peaking, and decaying in a room —
> becomes **the life cycle of every lyric line**: lines approach as an incoming wavefront, peak in
> focus when sung, and decay into the room like a reverb tail.

Competitor test: Apple Music scrolls a column of lines; Spotify highlights a list; Spicy Lyrics
animates a list. None of them treat *time* as *depth*. In ECHO, time until a line is sung maps to
distance from the listener. That mapping is the product.

### 1.1 Product principles

1. **One song, fully.** The Listen screen is the product. Everything else is a route back to it.
2. **Time is depth.** Positions come from timestamps, not from layout slots
   (`LYRICS_EXPERIENCE.md` §3).
3. **Light comes from the cover.** Colour in the room comes from the current artwork. The shell is
   neutral, so the cover is the only source of colour.
4. **Honest reactivity.** Visuals react to audio only where ECHO can legitimately analyse that audio
   (Navidrome streams). Where it cannot, ECHO says so and uses a non-reactive ambient mode. It never fakes beat sync. (`VISUALIZER_SPEC.md` §2)
5. **Readable first.** No effect may reduce lyric legibility below the contrast targets in
   `DESIGN_SYSTEM.md` §3.4. Motion is capped by the music's intensity and by the user's motion
   preference.
6. **Quiet tools.** Library, queue, search and settings follow the taste-skill app-screen rules: true
   neutral darks, no glow, colour only on the one thing that matters. Their floating surfaces
   (sidebar, dock, sheets, dialogs) are liquid glass (owner, 2026-10-28; `DESIGN_SYSTEM.md` §7.11).

---

## 2. Users

| Persona | Context | What they need from ECHO |
|---|---|---|
| **The self-hoster** (primary; the owner and admin) | Runs Navidrome and ECHO on a home server (OptiPlex, Docker, Caddy) with a curated library. Listens on a laptop, a gaming PC, and later native desktop/mobile apps, at home and away. Technically capable. | A player worthy of their library on every device: real synced lyrics, visuals that truly respond to the audio, fast browsing, a queue that follows them between devices, and no third-party cloud for core play. |
| **The invited listener** (secondary) | A friend or family member the admin invited. Has their own Navidrome account on the same server. | Sign in, connect their own Navidrome account, and get the same experience, without seeing anyone else's data. |
| **The display user** (tertiary) | Puts ECHO full-screen on a TV or second monitor during a party or while working. | Long unattended sessions, nothing that burns in, readable from 3 m away, keyboard or remote-friendly controls. |

**Multi-user, small scale:** one admin plus a few invited users ("mainly me, maybe some others").
Each user has their own login, connections, settings and queue. No social features.

---

## 3. Platform

ECHO is a **self-hosted web service**. The ECHO server runs in Docker Compose on the owner's home
server, next to Navidrome, behind Caddy (HTTPS), and is **reachable from the public internet** at a
domain such as `https://echo.example.com`. The MVP client is the **browser web app** on desktop
browsers: **Google Chrome, Chromium and Firefox are all first-class**. Native clients use the same
versioned API (`/api/v1`): the **Android** app (2026-10-29) is the full app, and **Linux, Windows,
macOS and iOS** have baselines since 2026-11-04 (sign in, albums, an album, playback), each on its
platform's own toolkit. The reasons are in `TECHNICAL_ARCHITECTURE.md` §2.

Minimum supported viewport: **1024×640** for the full experience. A **compact layout** (≥ 360px wide)
must stay usable for controlling playback and reading lyrics, but the phone is not a primary target.

---

## 4. Features

IDs are referenced by the implementation plan and acceptance criteria.

| ID | Feature | Summary | Spec |
|---|---|---|---|
| **F1** | Listen stage | Full-window immersive Now Playing: visual environment, lyric field, artwork, transport. Default screen whenever something plays. | §6.1, `DESIGN_SYSTEM.md` §6 |
| **F2** | Floating lyrics | Time-as-depth lyric field with word-by-word illumination. The signature feature. | `LYRICS_EXPERIENCE.md` |
| **F3** | Visual environment | WebGL atmosphere driven by artwork palette, plus audio features when available. Ships with three modes. | `VISUALIZER_SPEC.md` |
| **F4** | Artwork colour identity | Per-track palette (dominant, accent, highlight + derived roles) with contrast guarantees and smooth cross-track interpolation. | `VISUALIZER_SPEC.md` §6, `DESIGN_SYSTEM.md` §3.3 |
| **F5** | Transport | Play/pause, previous/next, seek with scrubbing, volume, shuffle, repeat, provider/device indicator. | `PLAYBACK_ARCHITECTURE.md` §3 |
| **F6** | Queue | View, reorder, remove, clear, "play next", "add to queue". Provider-aware (see constraints). | `PLAYBACK_ARCHITECTURE.md` §6 |
| **F7** | Library | Navidrome: artists, albums, album detail, playlists, recently added, starred. | §6.3 |
| **F8** | Search | One search field over the library, results as tracks, albums, artists, keyboard-first; with nothing found, a link to the same search on YouTube Music. | §6.4 |
| **F8c** | Wanted list | One list for everyone on the server of music that isn't in Navidrome yet: added on Your Library → Wanted or from a search that finds nothing; ECHO marks what the library gets (daily and when the list opens) and plays it; until then each item links to YouTube Music. | `ACCEPTANCE_CRITERIA.md` WNT-01 |
| **F8b** | Library source switch | Removed 2026-11-03 with Spotify (it chose between the Navidrome and Spotify libraries). | — |
| **F9** | Connections & settings | Each user connects, tests and disconnects their own Navidrome account and sets appearance, motion, audio and lyrics preferences. The admin configures the Spicy Lyrics key, library matching and the two-factor policy. | `SETTINGS_AND_SECURITY.md` §6–§8 |
| **F10** | Keyboard control | Full operation without a pointer; global shortcuts inside the app; a shortcut sheet. | §7 |
| **F11** | States & resilience | Designed loading, empty, offline, reconnecting, and error states for every block; no blank screens. | §8 |
| **F12** | Lyrics sourcing | Spicy Lyrics (when configured and allowed), OpenSubsonic/Navidrome lyrics, LRCLIB, embedded tags, with a precedence order and caching. | `LYRICS_INTEGRATION.md` |
| **F13** | Accounts & devices | Admin setup, invites, sign-in with password + TOTP (mandatory for the admin), sessions and devices list, account deletion. The queue and preferences follow the user across devices. | `SETTINGS_AND_SECURITY.md` §2, §4 |
| **F14** | Client API and native apps | Versioned, documented `/api/v1` (OpenAPI) with device tokens and signed stream URLs; the native apps on it: Android (the full app), and Linux, Windows, macOS and iOS baselines (2026-11-04) | `TECHNICAL_ARCHITECTURE.md` §2.2, §6.2, §6.5; `ACCEPTANCE_CRITERIA.md` §10e |
| **F15** | YouTube Music mode (web, 2026-11-03) | A switch turns ECHO into a YouTube Music player for whole listening sessions: Today, Explore, search, Your shelf (your library, with a pasted cookie), albums, artists, playlists, radio on a tap, likes. Its own look ("Liner notes": paper and ink, a night edition), ECHO's lyrics on paper, ECHO's player and queue underneath. An admin switch turns it off for everyone. | `ACCEPTANCE_CRITERIA.md` §10d, `TECHNICAL_ARCHITECTURE.md` §6.6 |
| **F16** | Performance mode (web, 2026-11-04) | One switch in Settings → Visuals for a slower computer, on that device only: the smaller animations everywhere and a Listen room that holds still, in Navidrome and YouTube Music mode alike; the lyrics keep moving word by word. The saved choices come back when it is off. | `SETTINGS_AND_SECURITY.md` §7.1, `ACCEPTANCE_CRITERIA.md` PERF-07 |

---

## 5. Screens

```
┌─ App frame ─────────────────────────────────────────────────────────────────────┐
│  S1 Listen (stage)  ←→  S2 Library  ·  S3 Search  ·  S5 Settings              │
│        │                    │              │                                    │
│        └── S4 Queue (side sheet over any screen)                                │
│  S8 Sign in · setup · invite (before any of the above)                         │
│  S0 First run (only until the user has connected a provider)                   │
│  S6 Album / Artist / Playlist detail (inside Library)                           │
│  S7 Shortcut sheet (overlay, `?`)                                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| ID | Screen | One question it answers (taste-skill §2.2) | Biggest thing on it |
|---|---|---|---|
| S0 | First run | "How do I start listening?" | Connect Navidrome, with what it gives you |
| S1 | Listen | "What is being sung right now?" | The active lyric line |
| S2 | Library | "What do I want to hear?" | The album grid (cover art at size) |
| S3 | Search | "Where is that song?" | The first result group |
| S4 | Queue | "What plays next?" | The next track |
| S5 | Settings | "Is everything connected and set the way I like it?" | Connection status rows |
| S6 | Detail | "What's on this album / by this artist?" | The cover and the track list |
| S7 | Shortcuts | "How do I do X with the keyboard?" | The shortcut table |
| S8 | Sign in / Setup / Invite | "Who am I on this server?" | The ECHO wordmark and one form (username, password, then a TOTP step). A 360px column on `--ground`, with no environment rendering before sign-in |

### 6.1 S1 Listen — layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◂ Library                                              ⌕   ≡ Queue   ⚙       │  ← chrome, fades after 3 s idle
│                                                                              │
│      (far lines drift at depth, blurred)        (past line dissolving ↑)     │
│                                                                              │
│          ██ So I call your name into the dark ██        ← ACTIVE (40%)       │
│                                                                              │
│                 every sound comes back to me     ↑      ← upcoming +1        │
│                    I hear it in the static now   ↑      ← upcoming +2        │
│                         and the night turns over ↑      ← upcoming +3        │
│     (far lines drift at depth, blurred)                                      │
│ ┌────┐  Song title                                                           │
│ │ art│  Artist — Album                      ◂◂   ▶❙❙   ▸▸        ⟲  ⤨   ◔ vol │
│ └────┘  1:42 ━━━━━━━━━━━━━━●──────────────────────────── 4:05     Navidrome  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The **transport dock** is at the bottom. The active line sits at the optical centre of the stage:
  40% of the stage height from the top, slightly above the geometric centre so the three upcoming
  lines have room beneath it. Upcoming lines approach **from below and from depth**: they float
  upward *and* toward the viewer as their time nears, rise into focus, then continue upward and
  decay. This reading of "float upward toward the player" satisfies both interpretations, upward on
  screen and nearer to the listener. Full geometry is in `LYRICS_EXPERIENCE.md` §3.
- Artwork appears in the dock at 64px. A **Cover mode** (`C`) replaces the lyric field with the
  artwork at up to 60vh for songs without lyrics or by preference.
- Chrome (top bar and dock controls except progress) fades to 0 after **3 s** without pointer or
  keyboard input while playing. Any input restores it in 160 ms. Progress stays at 40% opacity.
- The stage has three **view modes**: `Lyrics` (default when lyrics exist), `Cover`, and `Visual`
  (environment only, lyrics hidden). Cycle with `V`.

### 6.2 S4 Queue

A 400px right side sheet over the current screen (full-width below 720px). Sections: *Now playing*,
*Next up* (user-added), *Then* (context: album/playlist remainder). Drag or `Alt+↑/↓` to reorder.

### 6.3 S2 Library and S6 Detail

- Tabs: **Albums** (default; grid of covers, 168px min tile, sort: recently added / A–Z / year /
  most played), **Artists** (list with avatar/cover), **Playlists**, **Starred**.
- Album detail (S6): object header (cover 240px, title, artist, year, track count, total duration,
  Play / Shuffle / Add to queue), then a track table (number, title, duration, lyrics-availability
  glyph once known, ⋯ menu).
- Lists virtualise beyond 200 items. Cover images lazy-load with the album's dominant colour as the
  placeholder fill (when cached) or `--surface-1`.

### 6.4 S3 Search

- Opens over the current screen with `/` or `Ctrl/⌘+K`. Results update 200 ms after typing stops.
- Groups: Top result, Tracks (6), Albums (6), Artists (6), each with "Show all".
- `Enter` plays the highlighted track. `Shift+Enter` adds it to the queue. `→` opens the album.
- Results from each provider carry a small provider mark. Navidrome results come first when both
  providers match.

### 6.5 S5 Settings

Sections (each its own view, taste-skill app rules §8.2):
- **Preferences:** Playback (crossfade, ReplayGain, stream
  quality per device), Lyrics (size, global offset, unsynced display, announcements), Visuals (mode, intensity (default Expressive), quality per device, motion, grain),
  Keyboard, About (version, licences, attributions, **link to source code** (AGPL-3.0)).
- **Account:** profile, password, two-factor, sessions & devices, connections (the user's own
  Navidrome).
- **Admin** (admins only): server (Spicy Lyrics key, library matching, require TOTP for all), users
  & invites, audit log.

Details are in `SETTINGS_AND_SECURITY.md` §7.

**As built (M8):** Preferences is one view with five groups; crossfade, film grain and pointer
parallax are shown disabled ("Arrives in a later version"); About has no source-code link yet (no public repository URL). The
admin also sets "require TOTP for all" in Server.

---

## 7. Keyboard map (F10)

| Key | Action |
|---|---|
| `Space` | Play / pause (when focus is not in a text field) |
| `←` / `→` | Seek −5 s / +5 s (`Shift`: −/+15 s) |
| `Ctrl/⌘+←` / `Ctrl/⌘+→` | Previous / next track |
| `↑` / `↓` | Volume +5% / −5% |
| `M` | Mute |
| `L` | Toggle lyrics view |
| `V` | Cycle stage view: Lyrics → Cover → Visual |
| `C` | Cover mode |
| `Q` | Toggle queue sheet |
| `/` or `Ctrl/⌘+K` | Search |
| `G` then `L` / `S` / `P` | Go to Library / Settings / Listen (Play) |
| `F` | Full screen (Fullscreen API) |
| `[` / `]` | Lyric timing offset −50 ms / +50 ms (shown as a toast, saved per track) |
| `S` | Toggle shuffle · `R` cycle repeat |
| `?` | Shortcut sheet |
| `Esc` | Close the top overlay, or exit full screen |

Shortcuts never fire while an `<input>`, `<textarea>` or `[contenteditable]` has focus, except `Esc`.

---

## 8. States (F11)

Every data block has five designed states: **loading, ready, empty, error, offline**. Rules are in
`DESIGN_SYSTEM.md` §10, and per-provider recovery is in `PLAYBACK_ARCHITECTURE.md` §8. Product-level
requirements:

- The app never shows a blank screen. On cold start the frame and the last-known track (from the
  user's server-side queue, cached in the client) paint at once.
- If the ECHO server is unreachable from a client, the dock says so and retries. Audio already
  buffered keeps playing.
- Losing a provider connection never stops a track that is already buffered, where the provider
  allows it. A "Reconnecting…" status appears in the dock with an elapsed counter. Reconnection uses
  exponential backoff (`PLAYBACK_ARCHITECTURE.md` §8).
- A missing lyric is a designed moment (the stage switches to Cover mode with a quiet "No lyrics
  found" line and a source note), not an error.
- Error copy says what failed and what to do, in the interface's voice, without apology
  (frontend-design skill, "More on writing in design").

---

## 9. User journeys

**J0 — Server setup (admin, once).** `docker compose up -d` → the container log prints a one-time
setup URL → open it → create the admin account → scan the TOTP QR code, confirm a code, save the
recovery codes → Admin → Server: paste the Spicy Lyrics key → done.

**J1 — First run with Navidrome (primary).** Sign in (password + TOTP) → S0 → "Connect Navidrome"
→ the URL is prefilled with the internal Navidrome address → enter your Navidrome username and
password → "Test connection" shows server version and track count → Save → land on Library (Albums)
→ pick an album → Play → the stage opens, the room takes the cover's colours within 600 ms, and
lyrics appear (or Cover mode with "No lyrics found").

**J2 — First run with Spotify.** Removed 2026-11-03 with Spotify.

**J3 — Focused listening.** Playing → pointer idles 3 s → chrome fades → lines float in, word
illumination tracks the voice → the user presses `[` twice because the lyrics feel early → offset
−100 ms saved for this track.

**J4 — Seek and skip.** Drag the scrubber → lyric field scrubs live: lines reposition by timestamp,
no animation backlog → release → playback resumes, field settles in ≤ 300 ms. Press `Ctrl+→` →
the palette crossfades over 1.2 s and the old song's lines recede while the new song's lines arrive.

**J5 — Library hunt.** `/` → type "ocean" → arrow down → `→` opens the album → `Shift+Enter` on three
tracks to queue them → `Q` shows them under "Next up".

**J7 — Invite a listener.** Admin → Users → "Invite" → copy the link and send it → the invitee
opens it, picks a username and password (TOTP optional) → connects their own Navidrome account →
listens. They see none of the admin's data.

**J8 — Switch devices.** Listening on the laptop → pause → open ECHO on the gaming PC → the same
queue and position are there (paused) → Play. The gaming PC starts at its own remembered quality
tier.

**J6 — Something breaks.** Navidrome server goes down mid-song → the current buffered audio continues;
the dock shows "Navidrome unreachable — retrying in 4 s"; Library blocks show their error state with
Retry → server returns → status clears and nothing else changes.

---

## 10. MVP scope

The MVP is milestones **M1–M9** in `IMPLEMENTATION_PLAN.md`. It is reached in two releases:

**MVP-α "One song, fully" (M1–M6):** the deployed server with accounts and TOTP, Navidrome playback, the full Listen stage with floating lyrics,
audio-reactive environment, artwork palettes, queue, library, search (Navidrome), and lyrics from
the user's own files (OpenSubsonic) and LRCLIB. The Spicy Lyrics source is built in M6, but it is
keyed by Spotify track ID, so it serves Navidrome tracks only once the opt-in Spotify ID lookup
exists (M7; `LYRICS_INTEGRATION.md` §4.3).

**MVP-β "Two sources" (M7–M9):** Spotify playback within confirmed capabilities, the settings and
security hardening, accessibility and performance passes, and final polish. (Spotify playback was
removed on 2026-11-03; the rest stands.)

### 10.1 Non-goals (MVP)

- **Native desktop and mobile clients** (post-MVP. The MVP ships the API they will use, F14).
- Social or sharing features. Public sign-up (users only join by invite).
- Capturing system or tab audio to analyse it (`VISUALIZER_SPEC.md` §2.3).
- Editing tags, managing the Navidrome library, uploading music.
- Lyric editing or community lyric contributions.
- Equaliser or DSP effects beyond volume, ReplayGain and an optional Navidrome crossfade.
- Chromecast/AirPlay casting.
- Last.fm/ListenBrainz scrobbling (Navidrome scrobble calls are in scope; external scrobblers are a
  post-MVP candidate).

---

## 11. Success measures (qualitative MVP gates)

- A first-time viewer, shown the Listen screen for 5 seconds, can say "it's a music player showing
  the lyrics of the song" (taste-skill five-second test).
- Lyrics remain readable from 3 m on a 27" display at default size.
- On the reference client (the owner's everyday laptop, `ACCEPTANCE_CRITERIA.md` §0), the stage
  holds 60 fps at its native resolution in the governor's chosen tier, and at T0 on the gaming PC.
- No secret ever appears in any client, local storage, logs, the database in plaintext, or the
  repository (`SETTINGS_AND_SECURITY.md` §3).
- A security review of the public deployment (`ACCEPTANCE_CRITERIA.md` §10) passes before the
  domain is shared with anyone.

Testable acceptance criteria for each feature live in `ACCEPTANCE_CRITERIA.md`.
