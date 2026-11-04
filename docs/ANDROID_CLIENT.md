# ECHO — Android client

Status: **v0.1 built** (2026-10-29), tested on an Android 17 emulator against a local server · Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §2.2 · [Visualizer](VISUALIZER_SPEC.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Design system](DESIGN_SYSTEM.md)

The other native apps (2026-11-04: `Linux/`, `Windows/`, `macOS/`, `iOS/`) are baselines on the
same API; this one is the full app. Each folder's README says what it has
(`ACCEPTANCE_CRITERIA.md` §10e).

A native Android app (Kotlin, Jetpack Compose, Media3) for the owner's ECHO at
`https://echo.folk3s.com`. Owner decisions (2026-10-29): **full parity** with the web player (the
library, playback, the Stage with its room, Reverb and word-synced lyrics; liquid glass was later dropped for Material 3's surfaces), **Kotlin +
Compose**, the server **fixed** to echo.folk3s.com, **Navidrome only** (Spotify's Web Playback SDK
could not run in a third-party Android app; the web dropped Spotify too on 2026-11-03).

## Architecture

| Web (`src/client`) | Android (`Android/app/src/main/kotlin/com/folk3s/echo`) |
|---|---|
| `api.ts`, session cookie | `api/Api.kt`: OkHttp with a **device token** (`POST /api/v1/auth/device`, `Authorization: Bearer echo_dt_…`; the Origin check exempts it), kept encrypted by an Android Keystore key |
| `library-navidrome.ts` | `library/Library.kt`: the same Subsonic calls through `/api/v1/navidrome/rest/*` |
| `playback/*` (an `<audio>` element) | `playback/`: a Media3 `MediaSessionService` (ExoPlayer, background playback, notification and lock-screen controls), streams from `/navidrome/stream/{id}` with the bearer header |
| `playback/analyser.ts` (Web Audio) | `playback/Features.kt`: the same FFT features from a `TeeAudioProcessor` tap |
| `stage/*` (three.js, WebGL 2) | `stage/`: OpenGL ES 3.0 with the same GLSL ES 3.00 shaders (room, energy, composite, probe), the governor and Reverb ported as is |
| `stage/lyrics/*` | `stage/lyrics/`: timing, springs, beat and the field model ported as is; layout and drawing in Compose |
| `palette/m3.ts` | MaterialKolor's `SchemeContent` from the album accent |
| `tokens.css` M3 surfaces | `ui/Theme.kt`: `Chamber`'s names alias the scheme's roles; sheets, dialogs, the snackbar and the navigation bar are M3 surfaces |

The pure modules keep their names and structure so a change to one is easy to carry to the other.

## Build

`cd Android && ./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`, copied
to `Android/ECHO.apk` (not in git). Release builds are minified (R8) and signed with the local
debug key, which is fine for sideloading and for updates over it; a Play release needs its own key.
Needs JDK 17+ and the Android SDK with platform 37.2 (current AndroidX requires compile SDK 37);
minimum Android 10 (API 29), target API 36.

Shader assets come from the web's `src/client/stage/shaders.ts`: after changing a shader, run
`node scripts/android-shaders.ts` (`android-shaders.test.ts` fails until you do). JVM tests of the
ported logic: `./gradlew testDebugUnitTest`.

**Testing against a local server.** Debug and `qa` builds (the release build, minified the same
way) take `-Pecho.devUrl=http://10.0.2.2:<port>` and allow plain HTTP; release never does. A
throwaway ECHO with the E2E mock Navidrome (`node scripts/mock-subsonic.ts <port>`, user
`ada` / `navidrome-pass`, `ECHO_NAVIDROME_URL` and the lyric sources pointed at it) gives a library
with covers, WAV streams and timed lyrics.

## As built (v0.1)

- **Sign-in** with username, password and, with two-factor on, the code; the device appears in
  Sessions & devices as "ECHO for Android (…)". A revoked token signs the device out; signing out
  stops playback and clears the queue (REL-05).
- **Library**: albums (four sorts), artists, playlists, starred, album and artist pages, search
  (what is loaded at once, search3 a moment later), Play next and Add to queue.
- **Playback**: background play, notification, lock screen and headset controls, shuffle,
  repeat, the queue sheet (move, remove, clear), the queue saved to and restored from the server
  (the device that is playing wins a conflict), scrobbles at half or 4 minutes.
- **The Stage**: the room on the blurred cover, the album palette crossfaded in OKLab, Reverb from
  the audio itself, brightness, Lyrics / Visual / Cover views, full screen, chrome that hides after
  3 s of play, the governor's tiers, Still under reduced motion (the system's Remove animations).
- **Lyrics**: word-synced sweep, glow, depth, emphasis, backing vocals, duets, interlude dots,
  line-timed washes, unsynced text, the credit, the global timing offset.
- **Material 3 surfaces** (2026-10-29, replacing liquid glass for performance): the album-seeded
  dark content scheme (MaterialKolor, animated over 1200 ms), an M3 navigation bar, the mini player
  in the album's tone, modal bottom sheets and dialogs over a 32% scrim, an M3 snackbar, and tonal
  icon buttons and a floating toolbar over the Stage.

**Not in v0.1** (the web keeps them): account and admin settings, Navidrome connection, the
lyric source menu and per-track lyric nudges, streaming quality and ReplayGain, the contrast
solver that darkens the lyric zone behind bright covers.

**Needs the server's 2026-10-29 palette fix** (commit 07e10fb): before it, the palette route refused
device tokens, so album colours fall back to Sodium until echo.folk3s.com is redeployed.

## Milestones

1. Scaffold, sign-in, library (albums, artists, playlists, starred, album, artist, search), theme.
2. Playback: the media service, dock, queue sheet, shuffle and repeat, the saved queue.
3. The Stage: room, palette, cover, brightness, modes, chrome auto-hide, governor, Reverb features.
4. Lyrics: the column with the sweep, glow, depth, dots, attribution and offsets.
5. Liquid glass: Stage (GL) and Shell (Compose), fallbacks by API level.
6. Settings (visuals, motion, lyrics size and timing, scrobbling, sign out), tests, the APK.
