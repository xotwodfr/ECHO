# ECHO for iPhone and Mac — design

Status: **approved** by the owner 2026-11-19 on the real Liquid Glass preview (simulator
screenshots in `Apple/Screenshots/`, `.github/workflows/apple.yml`); the full apps are being
built (plan: `docs/superpowers/plans/2026-11-19-apple-apps.md`), to be shown when complete.
Mockups (browser approximations of the glass): https://claude.ai/artifact/4T8uWxuB8p7qisZxH98VPW.

## Intent

Native iPhone and Mac apps in **real Liquid Glass**, Apple's own (iOS 26 and macOS 26 SwiftUI:
`glassEffect`, `GlassEffectContainer`, the glass button styles, the floating tab bar and its
bottom accessory), with the features the web and Android apps have. The owner judged the CSS
mockups "not even real liquid glass": the look is approved on real renders, not imitations.

## Owner decisions (2026-11-19)

- **See the real glass first.** A small SwiftUI prototype of the main screens with Apple's glass
  APIs, built on GitHub's macOS runner, with screenshots from the iOS 26 simulator and macOS 26;
  the full apps follow once the owner has seen them.
- **iOS 26 and macOS 26 only**: real glass everywhere, no material fallback for older systems.
- **iPhone only** for now (no iPad layout).
- **Features in the first version**, beyond sign-in, Home, Library, Search, albums and playback:
  word-synced lyrics; the lock screen, Control Center and a home-screen widget; Karaoke (Vocals,
  key) and Listen together; offline downloads (albums, playlists, Liked Songs); **animated
  lock-screen covers** (below). Not YouTube Music mode.
- **Sign-in**: username, password and the authenticator code; the iPhone scans the web sign-in
  page's QR code to sign a computer in (as on Android); guest passes (scan to listen as a guest,
  invite guests). The server stays `https://echo.folk3s.com` (no server field).
- **Themes**: **all** the Android app's themes (ECHO; the Apple Music, Spotify, SoundCloud,
  Deezer, Qobuz, Tidal, YouTube Music and Monochrome styles; Clay, Yarn, Liquid glass, Paper &
  origami, Retro hi-fi), **each with its lyric style and its sounds and haptics**, Liquid Glass
  worked into most of them where it suits, **plus a plain Liquid Glass theme** (ECHO's room lit by
  the album, glass on top). Material You is Android's own and has no counterpart here.
- **All at once**: the owner sees the finished apps, not milestones.
- **The look, from the preview**: no bar or header backgrounds: the album-lit ground runs
  full-bleed under the status bar and the floating glass, with no hard edge at the top (the
  owner's "remove the ugly borders"); controls white over the glass, not the system blue; one
  glass capsule for the transport.
- **The app icon is "Echo"** (concept A of four: a point of sound and three fading rings, amber
  light over deep blue), an Icon Composer icon whose rings and dot are glass layers
  (`Apple/Shared/AppIcon.icon`).
- **Lyrics** open from a glass Lyrics button on Now Playing; swipe down to go back.
- **Mac**: the keyboard's media keys and macOS's Now Playing control the app.
- **Installing**: unsigned simulator builds as CI downloads for now; TestFlight or device builds
  later, with the owner's Apple developer secrets.

## Animated lock-screen covers

iOS 26 lets an app give the lock screen a short looping video for the playing song, tall (3:4,
full screen) or square, with a still first frame (`MPMediaItemAnimatedArtwork`,
`MPNowPlayingInfoProperty3x4AnimatedArtwork`); without one the lock screen shows the still cover.

- **Where**: the iPhone lock screen only (not the app's Now Playing, not the Mac).
- **Source**: a video **an admin uploads for the album in ECHO's web app** when there is one;
  otherwise **ECHO generates one** from the cover. (The owner first chose any video in the album's
  folder, then, told that ECHO cannot see the music folders, chose uploading over giving a new
  service read-only access to them.)
- **When**: on an album's **first play**, then kept on the server. Until it is ready the lock
  screen shows the still cover.
- **Frame**: the **whole tall frame moves**: the square cover fills the 3:4 frame (cropped at the
  sides) and the motion plays across all of it.
- **Motion, mixed by cover** (owner's choice after previews of each on four real covers, 8 s
  loops): **Depth** (estimated depth, near and far moving apart in a slow orbit) for photographs;
  **Living light** (the cover still, light in its own colours drifting over it and a soft sweep)
  for flat or text-heavy art. The rule that tells them apart is tuned on the owner's library.
  Drift & zoom (a window travelling and zooming across the cover) was shown and not chosen.
- **Speed is a setting** (the loop's length), in the apps' Settings.
- The previews of the three styles were rendered on the owner's own covers and not committed (the
  covers are commercial artwork). Findings from them: the depth map must be smoothed hard and the
  orbit kept small, or printed lettering bends; light must keep the cover's contrast (soft light,
  not a milky screen).

## Open

- The generator's cost on the OptiPlex per album (measured when built).
- How glass meets each material theme (Clay, Yarn, Paper, Hi-fi): judged on screenshots.
