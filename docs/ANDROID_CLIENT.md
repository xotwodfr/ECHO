# ECHO — Android client

Status: **v0.4 built** (2026-11-18: Clay and Yarn; v0.3 themes, lyric styles, motion; v0.2 2026-11-17; v0.1 2026-10-29), tested on an Android 17 emulator against a local server · Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §2.2 · [Visualizer](VISUALIZER_SPEC.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Design system](DESIGN_SYSTEM.md)

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

## v0.8: offline downloads (2026-11-19)

Owner decisions (2026-11-19): albums, playlists and Liked Songs can be downloaded to the phone
and play with no connection. They are stored as **Opus at 192 kbps**, which Navidrome transcodes
through ECHO's proxy (`/api/v1/navidrome/stream/{id}?format=opus&maxBitRate=192`, with the device
token like any stream). Downloads wait for **Wi-Fi by default**.

- **Storage** (`offline/OfflineIndex.kt`, `offline/Downloads.kt`): everything stays in
  app-private storage under `files/offline/`. `index.json` lists each download (kind, id, title,
  subtitle, cover and the `Track`s as they were last seen online) plus the finished files
  (track id → bytes, cover id → bytes). Tracks go in `tracks/<id>.opus` (written as `.part`, then
  renamed) and covers in `covers/<cover id>.jpg` (fetched at 600 px). A track or cover shared by
  two downloads is kept until both are removed (`OfflineIndex.remove`). A downloaded playlist,
  album or Liked Songs follows its online version whenever it is seen again (`Downloads.sync`;
  Liked Songs follows the hearts). Signing out deletes everything (REL-05).
- **The worker** (`offline/DownloadWorker.kt`): a WorkManager `CoroutineWorker`, so downloads go
  on after the app closes. It needs `UNMETERED` (Wi-Fi only, the default) or `CONNECTED`
  networks and enough free storage. It fetches covers first, then one track at a time, newest
  download first. It runs as a `dataSync` foreground service with a quiet progress notification
  when Android allows; if Android refuses because it was started from the background, it runs
  without one. If a connection drops it retries with backoff; a track the server refuses is
  skipped for that run and retried later. A new download is queued with `APPEND_OR_REPLACE`, so
  one added just as a run ends is still fetched. Changing the Wi-Fi setting replaces the queued run.
- **Playback** (`playback/Playback.kt`): `uriOf` asks `chooseSource`. The karaoke version wins
  while Karaoke mode is on, it is ready and ECHO can be reached. Otherwise the downloaded file
  plays (`file://`, even online, to save data), and otherwise the stream. A finished download
  moves queued songs to their files without touching the one playing; going offline or online
  swaps that one too, at the same position. `PlaybackService` reads through
  `DefaultDataSource` (files, plus OkHttp for streams), and the notification artwork uses the
  saved cover. A Coil `Mapper` serves saved covers at any size, and so does the Stage's
  backdrop.
- **Offline** (`offline/Network.kt`): online means the phone has a network *and* ECHO answered
  the last request. `Api` marks the server unreachable when a request to it fails to connect,
  but not when the request was cancelled. While the phone has a network but ECHO doesn't answer,
  `/api/v1/health` is asked every 20 s. When ECHO is back, the library reloads by itself.
  Offline, Home becomes the downloads list. Library shows an "Offline · your downloads still
  play" note instead of the error, and other pages show that note above the bars. Album,
  playlist and Liked Songs pages fall back to the downloaded copy.
- **Screens** (`ui/Downloads.kt`): the download button sits in the album, playlist and Liked
  Songs top bars. It shows an arrow to download, a ring that fills while downloading (tap to
  cancel), or a filled disc once downloaded (tap to remove, after asking). The same actions are
  in each page's ⋯ menu. Library → Downloads lists each download with its size or progress,
  Play and ⋯, the total, the reason it's waiting ("Waiting for Wi-Fi") and Remove all. Settings →
  Downloads has "Download only on Wi-Fi", the storage used and Manage downloads.
- Tests: `OfflineTest` (which source plays, shared files, the missing list, sizes, cover ids).

## v0.7: sign-in and guest accounts (2026-11-19)

Owner decisions (2026-11-19): a more beautiful, smoother sign-in screen (an album art wall,
chosen from mockups); guest accounts from a QR code. Any user can invite and picks 1 hour, 1 day
or 1 week. Guests listen only, with a "Keep account" request the inviter approves. The web app
invites too.

- **Sign in** (`ui/SignIn.kt`): `CoverWall` keeps up to 24 small covers from the last signed-in
  session, refreshed daily and never on a guest's phone; coloured tiles stand in before that. Six
  tilted columns drift (still with reduced motion) under a darkening gradient. The wordmark has a
  gradient brush and rises in with a spring. The card is a translucent panel with a lit edge,
  fields glow amber when focused, and a refused sign-in shakes. Two-factor works as before.
- **Scanning** (`ui/GuestScan.kt`): ZXing's `BarcodeView` (QR only, continuous, following the
  lifecycle) with ECHO's own viewfinder and scan line. `guestCodeOf` accepts only
  `<this server>/guest#<code>`. `peek` shows whose pass it is, and `redeem` stores the guest's
  device token in the usual token store.
- **Guests** (`ui/Guests.kt`, `api/Guests.kt`): `GuestState` holds the guest's `/guests/me` and
  the inviter's pending keep requests. Home shows the guest's countdown banner (with "Keep
  account") or, for an inviter, the request card. Settings → Guests has the invite sheet (a ZXing
  QR code with error correction H and the ECHO mark in its centre, 1 hour / 1 day / 1 week, a
  countdown, and it notices a join by polling `/guests`), plus the list with Approve and End now.
  Guests get no heart and no "Add to playlist".
- Server: `src/server/guests.ts`; the rules are in `GUEST_DENY` (auth/routes.ts).

## v0.6: Liquid glass, Paper & origami, Retro hi-fi (2026-11-18)

Owner decision (2026-11-18): build the three themes from the mockups (themes3), each with its own
lyrics and sounds like Clay and Yarn, and the Karaoke controls in each.

- **Materials** (`ui/Matter.kt`), with new `Material` values:
  - `Glass`: a tinted frosted pane, a top-left rim of light, a slanted reflection and a caustic
    along the bottom. Its colours are a hair under opaque (`SEE_THROUGH`), so `inkOn` keeps the
    material's ink on them. The ground is three glows from the album's colour on a deep ground.
  - `Paper`: card with generated fibres, a crisp and a soft cut-paper shadow, a crease on some
    bigger pieces and a dog-eared corner (`PaperShape`) on others. The ground is fibred paper.
  - `HiFi`: generated brushed aluminium with a bevel and corner screws on panels, on a generated
    wood-veneer cabinet.
- **Palettes** (`matterColors`): Glass from the album (dark, and a light variant); Paper light
  (pastel papers) and dark (kraft); Hi-fi dark (walnut, gunmetal panels, silver and champagne
  buttons, amber for the playing track) and light (oak, silver panels).
- **Pieces** (`ui/Made.kt`):
  - Hi-fi: the cover as the label of a record turning at 33⅓ rpm under a tonearm that sets down
    while playing; VU and PEAK meters from `AudioTap` on Home's featured panel; a knurled VOCALS
    knob (drag, with detent clicks) instead of the slider.
  - Paper: the Now Playing cover as a taped polaroid, tape on the featured card, and an origami
    pentagon play button.
  - Glass: round play button.
- **Lyrics** (`Styled.kt`):
  - Glass: the line being sung inside a glass lens that fades in as the line starts; the rest are
    blurred.
  - Cut-out: on a notebook page with blue rules and a red margin. Sung words are cut from coloured
    paper and land on the line a little crooked; words to come are pencil.
  - Display: a teal VFD in the cabinet. Capitals in a monospaced face, lit letter by letter with a
    glow; the rest are unlit segments.
  - Picking a theme picks its style.
- **Sounds** (`scripts/android-sounds.py`): glass tink and chimes, paper rustle and fold, hi-fi
  switch thunk and knob detent.

## v0.5: Karaoke mode (2026-11-18)

Owner decisions (2026-11-18): a karaoke toggle like Apple Music's, with a vocals slider; the
voice removed by a model on the server (no GPU), for the whole library and on demand, stored
at /Media/Media/Instrumentals, gently (two cores, lowest priority). Server side: docs/KARAOKE.md.

- **The file**: the server's karaoke version is AAC 5.1, with the instrumental on front L/R and
  the vocals on rear L/R. `VocalMixProcessor` (`playback/VocalMix.kt`) comes first in the audio
  sink. It mixes the file back to stereo as `instrumental + level × vocals`, with the level
  gliding over each buffer, so the slider acts at once without clicks. Any other 5.1 song gets
  an ordinary downmix. The Stage's tap sees the stereo result.
- **Swapping** (`Playback.refreshSources`): with Karaoke mode on, each queued item gets the
  karaoke URI once the server has it. The song playing is replaced at its position. Turning the
  mode off swaps back to the original.
- **Asking** (`playback/Karaoke.kt`): while on, the song playing is asked for every 5 s until
  ready (`GET /karaoke/{id}`, made first), and the next two once a minute (`?soon=1`). Settled
  answers (ready, failed, too long) are kept for the session.
- **Downmix check**: if a karaoke file still arrives as 2 channels after 2 s (the phone's AAC
  decoder downmixed it), the app says so once, because the voice can't be removed on that phone.
- **UI** (`ui/Karaoke.kt`): a Karaoke pill on Now Playing with the Vocals slider and a status
  line under it, a mic button on the lyrics dock with the slider over it, and Settings →
  Karaoke with the server's progress. `Prefs.karaoke` and `Prefs.vocalLevel` (default 0 %).

## v0.4: Clay and Yarn (2026-11-18)

Owner decisions (2026-11-18): a Clay theme (pastel plasticine, handmade realism, everything in
clay, light with a dark option whose colour follows the album or is picked from eight), a Yarn
theme (knitted, cosy autumn colours), lyrics to match (Clay; Embroidered), both themes as 3D as
possible, and sounds on presses in each.

- **Materials** (`ui/Matter.kt`): `Modifier.matter(colour, radius, pressed, seed, depth, rib,
  seam)` draws a surface in the theme's material; `matterGround` the page under it. Clay: a
  hand-made outline (`HandShape`: corners and edges varied by a seed), a tinted drop shadow, a
  top-left light and bottom-right shade, a gloss spot, a rim light, a multiplied grain texture
  (generated), and on bigger pieces sometimes a fingerprint; pressed, the light reverses and the
  shadow goes. Yarn: a generated knit tile (each loop lit and shaded, with its twist), a cushion
  puff, a rolled edge, fuzz along the outline (fibres placed along a `PathMeasure`), ribbing on
  bars, dashed stitched seams. Flat themes get a plain rounded surface.
- **Palettes** (`matterColors`): light Clay pastels; dark Clay from `Prefs.clayDark` (`album`, or
  one of `CLAY_DARK`'s eight); Yarn light and dark. Each has a ground, a paper, six accents, an
  ink and a strong colour for Play and the playing track.
- **Where**: page grounds, the tab bar (ribbed in Yarn), the mini player, Play and Shuffle, track
  rows, cover frames (cards, page headers, Now Playing), Home's featured card, the search field,
  the back and avatar buttons, Games (stats, today's pick, tiles, answers), Now Playing's buttons.
- **Lyrics** (`Styled.kt`): Clay (sung words extruded in four layers with a lit face and a soft
  shadow, held words swell and tilt; the rest stamped) on a clay slab; Embroidered (satin-stitch
  thread, a needle at the stitching edge, sung lines in green, the rest traced) on a hoop
  (`Modifier.hoop`) over green knit. Choosing the theme switches the style; both are in the list.
- **Sounds** (`ui/Sounds.kt`, `res/raw/*.wav`, synthesized for ECHO): Clay squish, pop, and a
  squish-pop for a right answer; Yarn thump, needle tick, and two ticks. Played through
  `Haptics` with a little pitch variation, as UI sounds; `Prefs.themeSounds` turns them off.

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
