# ECHO for iPhone and Mac — design

Status: **decisions taken** by the owner 2026-11-19; the real Liquid Glass preview (simulator
screenshots) is being built before the full apps. Not built yet beyond the 2026-11-04 baseline
(`iOS/`, `macOS/`, `Apple/Shared`: sign in, albums, songs, a player bar).
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
- **Themes**: the Android app's themes, with Liquid Glass worked into most of them where it
  suits, **plus a plain Liquid Glass theme** (ECHO's room lit by the album, glass on top).
- **A new app icon**, layered for iOS and macOS 26's glass rendering; options are shown first.
- **Lyrics** open from a glass Lyrics button on Now Playing; swipe down to go back.
- **Mac**: the keyboard's media keys and macOS's Now Playing control the app.
- **Installing**: unsigned simulator builds as CI downloads for now; TestFlight or device builds
  later, with the owner's Apple developer secrets.

## Animated lock-screen covers

iOS 26 lets an app give the lock screen a short looping video for the playing song, tall (3:4,
full screen) or square, with a still first frame (`MPMediaItemAnimatedArtwork`,
`MPNowPlayingInfoProperty3x4AnimatedArtwork`); without one the lock screen shows the still cover.

- **Where**: the iPhone lock screen only (not the app's Now Playing, not the Mac).
- **Source**: **any video in the album's folder** (the first `.mp4`/`.mov`) when there is one;
  otherwise **ECHO generates one** from the cover.
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

- The generator's home on the server (the depth model runs with onnxruntime; ffmpeg encodes HEVC
  for the lock screen) and its cost on the OptiPlex per album.
- Which Android themes take glass and how; the icon options; the widget's sizes.
