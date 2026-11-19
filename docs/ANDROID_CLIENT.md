# ECHO — Android client

Status: **v0.3 built** (2026-11-18: themes, lyric styles, motion; v0.2 2026-11-17; v0.1 2026-10-29), tested on an Android 17 emulator against a local server · Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §2.2 · [Visualizer](VISUALIZER_SPEC.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Design system](DESIGN_SYSTEM.md)

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
| `playback/*` (an `<audio>` element) | `playback/`: a Media3 `MediaLibraryService` (ExoPlayer, Android Auto's browse tree, background playback, notification and lock-screen controls), streams from `/navidrome/stream/{id}` with the bearer header |
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

## v0.8: Android Auto and the widget

**Android Auto.** `PlaybackService` is a Media3 `MediaLibraryService` (the manifest's
`com.google.android.gms.car.application` → `res/xml/automotive_app_desc.xml`, and the
`MediaLibraryService` / `MediaSessionService` / `android.media.browse.MediaBrowserService` intent
filters), so the car browses the library and plays from it. The tree (`playback/CarTree.kt`, pure
and tested in `CarTreeTest`): *Recently played* (`getAlbumList2` recent), *Made for you* (the mixes),
*Playlists*, *New albums* (newest) and *Liked songs*; a car whose root hint allows fewer rows
(Android Auto: 4 tabs) gets the first three and a *More* folder. Albums, playlists and mixes open
to their songs; a song plays **its whole list from there**, as in the app, and the history learns
the context (`Playback.playingFrom`). Search (`onSearch`, Subsonic `search3`) lists songs, then
albums; voice ("play … on ECHO") plays the songs found, else the first album, and with nothing said,
Liked songs. Signed out, every list is an *authentication expired* error that says to sign in on the
phone. No lyrics and no Stage on the car screen.

`playback/CarLibrary.kt` is the session callback. Items from the app's own `MediaController` carry
their stream URIs and pass straight through; the browser's ids (`song/<track>/<list>`) are resolved
there to the same items the app plays (`/api/v1/navidrome/stream/{id}?format=raw`, the bearer header
through the service's OkHttp data source). Songs the session queued are put in `KnownTracks`, so the
in-app player shows them too. Starting the service (the car, the widget) brings up the app's player
model as well, so scrobbles, the history and the saved queue work without opening the app.

Covers: the car loads artwork URIs itself and cannot send the device token, so every artwork URI the
session hands out (browse items and the queue's, the app's included) is a `content://<app>.artwork/`
URI served by `playback/ArtworkProvider.kt`: fetched through the authed client and cached in
`cacheDir/artwork`. It serves `/api/v1/navidrome/cover/…` only, nothing else of the API. The session's
bitmap loader reads both (a `DefaultDataSource` over the OkHttp one).

**Widget.** `widget/NowPlayingWidget.kt` (classic `RemoteViews`, `res/layout/widget_now_playing.xml`,
`res/xml/widget_now_playing_info.xml`, 4×1 and resizable; the layout is also its picker preview):
the cover, the song and artist, previous / play-pause / next; a tap elsewhere opens the app. The
service's player listener pushes every change of song or play state (the cover loaded once per song
through the session's bitmap loader, scaled to 256 px); when the service stops it shows the last song,
paused. The buttons are broadcasts to the widget's receiver, which calls the app's `Playback`
(`previous` / `toggle` / `next`): it connects to the service, starting it if need be.

**Trying it.** Android Auto: enable developer mode in the Android Auto app (tap the version ten times),
"Start head unit server", then run the Desktop Head Unit (`$ANDROID_HOME/extras/google/auto/desktop-head-unit`,
after `adb forward tcp:5277 tcp:5277`); sideloaded apps also need *Unknown sources* on in Android
Auto's developer settings. The Media Controller Test app (androidx/media's `session-test`) browses the
same tree on a phone. The widget: long-press the home screen → Widgets → ECHO.

## v0.3: themes, lyric styles, motion (2026-11-18)

Owner decisions (2026-11-17): the UI should feel less bland (springy motion, depth and glass,
richer colour, haptics); full-look themes; the lyric styles researched and offered as options
(Apple Music style the default), the visualizer optional with drifting album colours instead.

- **Themes** (`ui/Theme.kt`, `ThemePreset`, Settings → Appearance): ECHO, Apple Music style,
  Spotify style, SoundCloud style, Deezer style, Qobuz style, Tidal style, YouTube Music style,
  Material You (wallpaper, Android 12+) and Monochrome. Each sets an accent (exact, on its own
  ground), a light/dark default (`Prefs.darkMode` can override), a face (Figtree, or Inter
  subset to Latin, Greek and Cyrillic, OFL) and title weight, and shapes (`Look`: art, row art,
  featured card, buttons, mini player, circle art, the tab pill). The names are labels only.
- **Motion** (`ui/Motion.kt`): `Modifier.bouncy` (a spring squish and a haptic on press), covers
  that fly from the tapped card to the page (`SharedTransitionLayout` in the Shell; only the
  tapped card takes part, by a saved token), pages that spring in from the side they come from.
  All of it is off under reduced motion.
- **Glass**: the mini player and the tab bar blur the page behind them (Haze 1.7; a translucent
  tint before Android 12).
- **Colour**: album, playlist and mix pages washed in the cover's colour (`AlbumWash`); on the
  ECHO theme their accent is the album's (`AlbumAccent`, MaterialKolor's content scheme).
- **Haptics** (`Haptics`, Settings → Appearance): play/pause, likes, tabs, seeking, game answers.
- **Lyric styles** (`stage/lyrics/Styled.kt`, the **Aa** button on the lyrics view and Settings →
  Lyrics): Apple Music style, Spicy Lyrics style, Cinema, Colour block, Kinetic, Karaoke, and
  ECHO classic (`LyricsField.kt`, unchanged). The column styles draw each line from the clock
  while drawing (no recomposition per frame), glide to keep the active line at the style's anchor
  with a per-line stagger, blur by distance on Android 12+, show breathing dots in gaps of 5 s or
  more, take a tap to play from a line and a drag to look ahead. Kinetic shows one line, its
  words popping in. The visualizer room (`StageView`) runs only for ECHO classic or with
  **Visualizer behind the lyrics** on; otherwise the album's colours drift (`AlbumMesh`).

## v0.2: the redesign (2026-11-17)

Owner decisions (2026-11-17): a modern look in the spirit of Apple Music, built with Material 3
components; light or dark **with the system**; the accent **from the playing album**; four tabs.

- **Frame**: Home, Mixes, Library, Search in an M3 navigation bar; a floating rounded mini player
  (play/pause, next, a hairline of progress in the accent) above it. The window theme and system
  bars follow light/dark; Now Playing and the lyrics view are always dark, with light bar icons.
- **Type**: large bold titles (Figtree 800, `displaySmall` 34 sp) on each tab, bold headings.
- **Home**: a featured card (today's first mix, or a recent album) with its own play button, then
  shelves of rounded (16 dp) covers.
- **Mixes** (new tab): today's mixes and this year's Wrapped as a two-column grid, Jump back in.
- **Library**: Playlists, Artists, Albums and Liked Songs as a list (`Route.LibraryList`), then
  Recently added as a grid; Albums keeps the four sorts as chips.
- **Pages** (album, playlist, Liked Songs, mix): a centred 260 dp cover with a soft shadow, the
  title, the artist or owner in the accent, facts in small caps, Play and Shuffle as pill buttons;
  albums list numbered tracks with hairlines and the total running time.
- **Search**: a rounded filled field, "Browse by genre" as rounded gradient cards.
- **Now Playing**: the album's colours drifting behind a big 24 dp-rounded cover that sits back
  (84%) while paused; the song with heart and menu in translucent circles; a wavy seek bar while
  playing (flat when paused or under reduced motion) with the time left counting down; a play
  button that morphs from circle to rounded square; Lyrics and Up next pills; the lyrics card.

- **Games** (new tab, `games/Games.kt`, `ui/Games.kt`): Song Guesser (a 2 s clip, longer clips
  of 5 and 10 s cost a quarter of the points each), Finish the Lyric (a synced line cut before its
  last 2–3 words, the clip stopping where they start), Cover Reveal (the cover from 16 px blocks to
  sharp, a step every 2.5 s), Timeline (which of two albums came out first). Ten questions a round,
  15 s each, 50 points for a right answer plus up to 50 for speed. Clips play on the games' own
  ExoPlayer, which takes audio focus. Each game's record (best round, best streak, rounds) is kept
  on the account in `/me/settings` → `games`, cached on the phone, and uploaded by the next sync
  when the server is older than that section.
- **Tabs**: reorder them in Settings → Tabs (`Prefs.tabs`); the first opens at start.

## Releases

Pushing a tag `vX.Y.Z` runs `.github/workflows/android-release.yml`: it builds the APK, runs the
unit tests and publishes a GitHub release with `ECHO-vX.Y.Z.apk`, its SHA-256 and the notes in
`.github/release-notes/vX.Y.Z.md`. With the secrets `ECHO_KEYSTORE_B64` (the keystore, base64),
`ECHO_KEYSTORE_PASSWORD`, `ECHO_KEY_ALIAS` and `ECHO_KEY_PASSWORD` set, it signs with that key, so
every release installs over the last; without them it uses the runner's debug key (a fresh one each
run: uninstall before updating).

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

**Needs the server's 2026-10-29 palette fix** (commit 43c7514): before it, the palette route refused
device tokens, so album colours fall back to Sodium until echo.folk3s.com is redeployed.

## Milestones

1. Scaffold, sign-in, library (albums, artists, playlists, starred, album, artist, search), theme.
2. Playback: the media service, dock, queue sheet, shuffle and repeat, the saved queue.
3. The Stage: room, palette, cover, brightness, modes, chrome auto-hide, governor, Reverb features.
4. Lyrics: the column with the sweep, glow, depth, dots, attribution and offsets.
5. Liquid glass: Stage (GL) and Shell (Compose), fallbacks by API level.
6. Settings (visuals, motion, lyrics size and timing, scrobbling, sign out), tests, the APK.
