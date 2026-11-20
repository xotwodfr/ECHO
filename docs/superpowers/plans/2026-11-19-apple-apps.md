# ECHO for iPhone and Mac — build plan

Spec and the owner's decisions: [`../specs/2026-11-19-apple-apps-design.md`](../specs/2026-11-19-apple-apps-design.md).
The owner wants the finished apps shown at once; the tasks below are the order they are built in.

## Ground rules (every task)

- **Branch** `claude/zealous-noether-1iioev`, PR xotwodfr/ECHO#7. The PR's web CI (`ci.yml`:
  typecheck, lint, unit, e2e, security) must stay green: `pnpm lint` (Biome over the whole
  repository, `Apple/` included: SVGs need a `<title>`, JSON Biome's format) before every push.
  Others push to the branch too: `git fetch` and merge before pushing; commit only your own files.
- **iOS 26 (iPhone) and macOS 26 only**, SwiftUI, Apple's own Liquid Glass (`glassEffect`,
  `GlassEffectContainer`, `.glass`/`.glassProminent`, the system tab bar and its bottom accessory,
  `Tab(role: .search)`). Code both apps share lives in `Apple/Shared`; `iOS/` and `macOS/` hold
  each app's own (XcodeGen `project.yml`).
- **The look** is the approved preview (`Apple/Screenshots/`): the album-lit ground full-bleed
  under the status bar and the floating glass, no bar or header backgrounds and no hard edges at
  the top, white controls on glass, one glass capsule for the transport.
- **No Swift on this Linux box**: everything compiles and runs on GitHub's macOS 26 runner,
  `.github/workflows/apple.yml` (builds both apps unsigned, runs the Swift tests, launches each
  screen with `-ECHODemo <screen>` in the iOS 26 simulator and on the Mac, commits the
  screenshots under `Apple/Screenshots/`). Add a demo screen and a test for what you build; look
  at every screenshot yourself before calling it done. A run takes 12–15 minutes; batch changes.
- **The server's API is the contract**: `docs/api/openapi.yaml`. The Android app
  (`Android/app/src/main/java/…`, `docs/ANDROID_CLIENT.md`) is the reference implementation of
  every feature on a phone: read how it does a thing before doing it here.
- Demo data (the web fixtures' albums) only behind `-ECHODemo`; real builds talk to
  `https://echo.folk3s.com` (`ECHO_URL` overrides, as now).
- Commits end with the session's attribution lines; no model names in commits or code.

## Layout

`Apple/Shared/`: `App/` (entry, routing, tabs, settings), `Api/` (client, models, Keychain token,
sign-in), `Library/`, `Playback/`, `Lyrics/`, `Karaoke/`, `Together/`, `Downloads/`, `Themes/`,
`UI/` (screens and components), `Preview/` (demo data), `AppIcon.icon`. `iOS/` adds the widget
extension (WidgetKit, App Group) and the lock screen's animated artwork; `macOS/` the menu
commands. Tests: `Apple/Tests/` (Swift Testing), run on the runner.

## Status and order (kept current; read this first)

The owner's order from 2026-11-20 (their time is limited): **7, 11, 8, 9, 10, 12** (downloads were paused). Themes (11):
the plain Liquid Glass theme and ECHO first, then as many Android themes as time allows. After
each task, update this list, `iOS/README.md` and `macOS/README.md`, so another agent can pick up
where the last one stopped. A green apple run uploads `ECHO-ipa` (unsigned, Release, for
Sideloadly) besides the simulator builds and screenshots.

| Task | Status |
| --- | --- |
| 1 Foundation | done (apple run 12) |
| 2 Library and search | done (apple run 16) |
| 3 Playback | done (apple run 19) |
| 4 Lyrics | done (apple run 26) |
| 5 Animated lock-screen covers, Settings | done (apple run 30) |
| 6 Widget | done (apple run 36) |
| 7 Scan to sign in, guests | done (apple run 38) |
| 11a Settings parity with Android | done (apple run 46; the table: [`apple-settings-parity.md`](apple-settings-parity.md)) |
| 11b Themes (Liquid Glass, ECHO, then Android's) | **done so far**: stage 1 (apple run 49): the Theme model, the picker, ECHO and Liquid Glass; stages 2a and 2b (apple run 53): Apple Music, Spotify, SoundCloud, Deezer, Qobuz, Tidal, YouTube Music and Monochrome styles. **Next (3)**: Clay, Yarn, Paper & origami, Retro hi-fi (the material themes: they need Android's `Matter.kt` materials, their lyric renderers and sounds; see "Picking this up") |
| 8 Karaoke | then |
| 9 Listen together | then |
| 10 Downloads | paused: code kept in commits 36116ea, 56c096c, 380d2d6; re-apply with `git revert 6bf75cb`; unfinished: it did not build yet (run 39's tests failed to type-check a test expression, since fixed in 56c096c; the later fixes were never run through to green) |
| 12 Finish | last |
| S Server motion covers | done |

## Tasks (numbered as first planned; built in the order above)

1. **Foundation**: the layout above (moving the baseline and the preview screens into it); the
   API client (device sign-in with the code in one request, the token in the Keychain for this
   device only, a refused token brings sign-in back, sign-out revokes it), models, preferences
   that follow the user (`/me/preferences`), error and offline states; tests against recorded
   API responses.
2. **Library and search**: Home (album-list shelves, Made for you mixes, Karaoke shelf), Library
   (Playlists, Albums with the four sorts, Artists from the server's list, Liked Songs, Wanted),
   Search (`search3`, top result, songs, albums, artists), Album, Artist, Playlist pages, hearts,
   song and album menus; covers through `/navidrome/cover`.
3. **Playback**: a queue on AVPlayer (gapless where the formats allow), signed stream URLs, playing
   on with the screen off, the queue that follows you (`/me/queue`), the mini player in the tab
   bar's accessory, Now Playing; the lock screen and Control Center (`MPNowPlayingInfoCenter`,
   `MPRemoteCommandCenter`); on the Mac the media keys and macOS's Now Playing.
4. **Lyrics**: the server's lyrics, word-synced as `docs/LYRICS_EXPERIENCE.md` describes, the
   Lyrics button on Now Playing, the source credit and menu, per-track offsets.
5. **Animated lock-screen covers (app side)**: `MPMediaItemAnimatedArtwork`, tall 3:4 and square,
   from the server's motion covers (task S), the still cover until one is ready, the loop's speed
   in Settings.
6. **Widget**: a now-playing home-screen widget (small and medium) through an App Group.
7. **Scan to sign in a computer and guest passes**: scan the web sign-in page's QR to approve it
   (`/auth/qr/peek`, `/auth/qr/approve`); scan a guest QR to listen as a guest
   (`/guests/peek`, `/guests/redeem`); invite guests with a QR (`src/server/guests.ts`).
8. **Karaoke**: karaoke versions from the server (`docs/KARAOKE.md`), the Vocals slider and the
   key (AVAudioEngine, time pitch), the Home shelf, "Make karaoke version" in the song menu.
9. **Listen together**: `docs/TOGETHER.md`: start from Now Playing, join by QR or link, the shared
   queue, the host's transport, Server-Sent Events.
10. **Offline downloads**: albums, playlists and Liked Songs into the app's container (background
    URLSession), played offline, storage shown and freed in Settings.
11. **Themes**: every Android theme (`docs/ANDROID_CLIENT.md` v0.3, v0.4, v0.6): ECHO; the Apple
    Music, Spotify, SoundCloud, Deezer, Qobuz, Tidal, YouTube Music and Monochrome styles; Clay,
    Yarn, Liquid glass, Paper & origami, Retro hi-fi; plus the plain Liquid Glass theme. Glass
    worked in where it suits; each theme's lyric style and its UI sounds and haptics; light and
    dark. Material You is Android's own (not ported).
12. **Finish**: `iOS/README.md` and `macOS/README.md`, `docs/ACCEPTANCE_CRITERIA.md` (NAT-04,
    NAT-05 and new rows), screenshots of every screen and theme.

**S, the server (alongside 1–4)**: animated covers.
- An admin uploads a video for an album in the web app (the album page's menu, admins only);
  ECHO keeps it in `/data` and serves it as that album's motion cover.
- Otherwise a `motion/` service like `stems/` (Python: Depth Anything V2 Small on onnxruntime,
  ffmpeg) makes one on the album's first request: **Depth** for photographs, **Living light** for
  flat or text-heavy art (a rule tuned on real covers), the whole tall frame moving, the loop's
  length from the request; ECHO caches it. The preview renderer's lessons are in the spec.
- The API: the motion cover for an album, tall or square, with its first frame as a still, and
  the admin's upload and removal; `compose.example.yaml`, `docs/MOTION.md`, tests.

## Picking this up

**11b, themes: stages 1, 2a and 2b are done** (apple run 53, 332 Swift tests on both platforms, `ECHO-ipa` uploaded). Made: **Apple Music, Spotify and SoundCloud styles** (Android's accents and grounds, light by default for Apple Music and SoundCloud, dark for Spotify; `Theme.Shapes` scales the corners of art and cards, `Palette.onAccent` is the label on the accent; lyric looks `.appleMusic`, `.spotify`, `.soundcloud` in `LyricStyle.swift`; haptics only, as Android gives them no sounds; demo screens `theme-apple-music-*`, `theme-spotify-*`, `theme-soundcloud-*` with home, nowplaying, lyrics, and the Mac's home). 2b adds Deezer, Qobuz, Tidal, YouTube Music (round art: `Shapes.art` 30) and Monochrome (`Theme.monochrome` greys `AlbumLight`), all built by `Theme.service(...)` from Android's accent and grounds, each with a lyric look and the same demo screens (`theme-deezer-*`, `-qobuz-`, `-tidal-`, `-youtube-`, `-monochrome-`). Add further flat themes the same way: one `static let` in `Theme.swift`, a `Lyric` case and look, the demo names in `DemoThemes` and the workflow's lists. What stage 3 (Clay, Yarn, Paper & origami, Retro hi-fi) needs beyond that: the materials (`ui/Matter.kt`: textured surfaces, grounds, cover frames, the controls' shapes) as new `Theme` surface treatments applied through `themedGlass`/`themedRow`/the room, Android's per-theme lyric renderers (`Styled.kt`: Clay, Embroidered, cut-out, display) as a renderer switch in `UI/LyricFieldView.swift`, their sounds (`scripts/android-sounds.py` recipes into `scripts/apple-sounds.py`, `Theme.Sounds` cases), and "Clay in the dark". Not yet: Android's fonts (Inter; the system face is used), the tab pill off, Spotify's header tone. Also made: **ECHO**
(default) and **Liquid Glass** (server id `glass`, which is also Android's "Liquid glass": the owner's plain Liquid
Glass theme takes that id, so the Android one is not a separate theme; its lens-style lyrics and the rest of its
look can still be added to it). What stage 2 needs to know:

- **The model:** `Apple/Shared/Themes/Theme.swift`: a `Theme` (id, name, blurb, `defaultDark`, a light and a dark
  `Palette`, a `Glass` treatment, a `Lyric` look, a `Sounds` set). `Theme.made` is the picker's list and
  `Theme.of(id)` shows any id not made as ECHO. **Add a theme by adding a `static let` and putting it in `made`
  only when it is whole** (tokens, lyric look, sounds, demo screens). `Theme.resolve(appearance, systemDark:)`
  gives the `Resolved` one (the variant in use); `ThemeProvider` (UI/Theming.swift, applied in `RootView` and the
  Mac's Settings window) puts it in `\.theme` with the colour scheme, the tint and `\.lyricLook`.
- **Every screen reads `@Environment(\.theme)`**: `theme.tint`, `.accent`, `.highlight`, `.warning`, `.floor`
  (no screen holds a colour; `Color.amber`/`echoTint` etc. remain only for the widget and previews). Surfaces go
  through `themedGlass(radius)` (cards, bars; tinted, rimmed where the theme says), `themedRow()` (rows and
  tiles, on glass in Liquid Glass), `PlayButtons` (glassProminent or refracting `.glass`), the room
  (`RoomModifier`: strength, height, light-variant wash, caustic) and `glassToggle`. A theme with a different
  material should extend `Theme.Glass`/`Palette` and these few modifiers, not the screens.
- **Light and dark:** ECHO and Liquid Glass default to dark (Android's ECHO follows the system; here the
  approved dark look stays the default); "Light or dark" in Appearance overrides. Now Playing, the lyrics, the
  scanner, the invite sheet, the sign-in page and the lock-cover preview are always dark (`themedDark()`, as
  Android's `forceDark`); within those, read `theme.forcedDark.x` if the struct applies `themedDark` to itself.
- **Lyrics:** `Theme.Lyric` names a `LyricLook` (`.echo`, `.glass` in `LyricStyle.swift`). Android's other themes'
  lyric renderers (`Styled.kt`: Apple Music style, Spicy, Cinema, Colour block, Kinetic, Karaoke, Clay,
  Embroidered, glass lens, cut-out, display) are column renderers: Stage 2's themes can start with a `LyricStyle`
  (face, inks, glow) and add a renderer switch in `UI/LyricFieldView.swift` where the style is not enough.
  Android's per-device "Lyric style" setting and "Clay in the dark" are still to do (Clay's stage).
- **Sounds and haptics:** `Themes/Feedback.swift`: the five events of Android's `Haptics` (tap, toggle, confirm,
  reject, tick) become UIKit haptics and a theme's sound (`Theme.Sounds`, `.wav` files in
  `Apple/Shared/Themes/Sounds`, made by `scripts/apple-sounds.py`, system sounds so they follow the device's
  volume). Android defines sounds only for Clay, Yarn, Liquid glass, Paper and Retro hi-fi (ECHO and the
  service-style themes have haptics only): add a set to `Theme.Sounds`, a recipe to the script (see
  `scripts/android-sounds.py` for the Clay, Yarn, Paper and hi-fi ones), run it and commit the wavs. The device
  switches **Haptics** (iPhone) and **Theme sounds** are in Appearance (`DeviceSettings`). Hooked up so far:
  play/pause, the heart, Play and Shuffle, song rows, tab changes and the settings toggles.
- **Tests:** `Apple/Tests/ThemeTests.swift` (resolution and variants, tokens complete incl. sound files on
  disk, lyric looks, picker saves one key / ordered / refused put back / loaded at sign-in, the feedback mapping
  on fakes); the picker's keys are also in `SettingsScreenTests`' table. A new theme is covered by the loops over
  `Theme.made`; add its sounds to the feedback test.
- **Demo screens:** `themes` (Settings with the picker, Liquid Glass chosen), `theme-liquid-glass-home`,
  `-nowplaying`, `-lyrics`, `theme-light-home` (ECHO light), `mac-themes` and the Mac's `theme-liquid-glass-home`
  and `-lyrics`: `DemoThemes` in `Preview/DemoRoot.swift` maps a name to a base screen and an appearance; add a
  name there and in the workflow's two screenshot lists.
- **Known, not done:** the tab bar's bottom accessory (mini player) keeps system-drawn controls that read pale on
  a light ground (see `iphone-theme-light-home.png`); the widget does not follow themes; a theme the account
  holds that is not made here (e.g. Android's Clay) shows as ECHO, and picking ECHO then saves `echo`.

(Original notes for 11b, still true:)

- **Where:** `Apple/Shared/App/SettingsGroups.swift`, `AppearanceSettings`: it holds Motion, Performance
  mode and Background brightness now. Put a `ThemePicker` first in that group, then the light or dark
  choice. Settings opens with Appearance at the top, so the picker is the first thing on the screen.
- **The key:** `UserSettings.appearance` (`theme: ThemeID`, `dark: DarkMode`), the user's, so it follows
  the account and loads at sign-in. Change it with `SettingsEditor.save { $0.appearance.theme = .glass }`
  (one key at a time, in order, put back if the server refuses; tested in `SettingsScreenTests`). The
  Apple apps show "materialyou" as ECHO. Read it from `session.settings.appearance`.
- **The lyric seam:** `LyricStyle` and `LyricLook` (`Apple/Shared/Lyrics/LyricStyle.swift`) with the
  `lyricLook` environment value (`LyricFieldView.swift`): a made theme sets the look the lyric screens use,
  as Android sets its lyric style from the theme. Android's per-device "Lyric style" and "Clay in the dark"
  settings, and theme sounds, belong here (deferred in the parity table).
- **The widget** does not follow themes yet (it reads its own snapshot, `Apple/Shared/Widget`).
- Per-device choices go in `DeviceSettings` (a property, a key, a setter), as `streamQuality`,
  `backdrop` and `performance` do; the demo screens `settings`, `settings-playback`, `settings-lyrics`
  show the groups (add a `settings-appearance` that scrolls to `SettingsAnchor.appearance` if useful).

**Deferred settings** (the parity table says why): Crossfade, Equalizer, Karaoke (task 8), Autoplay.
