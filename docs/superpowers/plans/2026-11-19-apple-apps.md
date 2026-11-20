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

The owner's order from 2026-11-20 (their time is limited): **7, 10, 8, 9, 11, 12**. Themes (11):
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
| 6 Widget | in progress |
| 7 Scan to sign in, guests | next |
| 10 Downloads | then |
| 8 Karaoke | then |
| 9 Listen together | then |
| 11 Themes (Liquid Glass, ECHO, then Android's) | then |
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
