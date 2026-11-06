# ECHO for Windows, liquid glass — design

Status: **approved** by the owner 2026-11-06 ("yeah, build it and push to github as a release").
Replaces the WPF baseline in `Windows/` (2026-11-04, `fc21acd`).
Mockup: board **A · Clear** of the glass board (brainstorm companion, `.superpowers/`, not in git).
Boards B (frosted) and C (song-coloured glass) are rejected directions.

## Intent

The owner wants a native ECHO for their **gaming PC**, with **liquid glass**, and with **no
YouTube Music** for now. They "can go all out": the gaming PC has no performance limit that
matters here. The main use is **ECHO full screen on a second monitor**, showing the Listen room
(lyrics and the room) while a game runs on the main one.

The glass ban of 2026-10-29 (`DESIGN_SYSTEM.md` §7.11 "No glass") was about the owner's slow
laptop and stays as it is for the web and Android (`design-rules.test.ts` is not touched). This app
is the exception, by the owner's choice.

## Owner decisions (2026-11-06)

- **A native app**, built up in stages. Rejected: the web app in a WebView2 window.
- **Liquid glass, direction A "Clear"**: almost no frost. The edges bend what is behind them like
  a lens, and a bright rim catches the light. The content scrolls underneath.
- **No YouTube Music** (F15) for now.
- **For the gaming PC**: a generous GPU budget.
- **Full screen on a second monitor during games** is the main use, so the Listen room comes first.
- **Builds come through GitHub Releases** on the public repo `xotwodfr/ECHO`, knowing that anyone
  can download the app (it is useless without an account on the owner's server).
- The summary below ("what it is, how it looks, how it gets made, what it does, gaming PC manners")
  was approved as played back ("looks good").

## My calls (the owner can veto)

- **Avalonia 12 on .NET 10** replaces WPF. It builds *and runs* on the Linux dev box, so every
  screen can be screenshotted while it is built. Nobody has ever seen the WPF window. On Windows it
  draws with Skia on the GPU (Direct3D 11 through ANGLE). WinUI 3 is out because it only builds on
  Windows.
- **One self-contained `ECHO.exe`** (win-x64, single file, no installer, no .NET to install).
  Unsigned, so Windows SmartScreen asks once ("More info → Run anyway").
- **Port from Android, not the web.** Android is already a complete native port of the web app's
  logic. The pure modules keep their names and structure, as Android did (`ANDROID_CLIENT.md`
  §Architecture), so a change in one carries to the others.
- **The glass is the 10-28 physical model** (`4850f4b` `DESIGN_SYSTEM.md` §7.11 "Liquid glass";
  code at `8cbc0bb^`: `src/client/ui/glass.ts`, `Android/…/stage/Glass.kt`, `Android/…/ui/Glass.kt`).
  It refracts by Snell's law across a convex squircle rim, using a bend lookup and a specular rim
  light, tuned to board A.
- **Dark only.** ECHO's Navidrome look, not the Fluent/Mica web look and not M3.
- **Admin pages and the Navidrome connection setup stay on the web.** Performance mode (F16) is
  left out: it exists for slow computers.
- **Draw nothing when nobody can see it**: minimised or fully covered, the glass, the room and the
  lyrics stop rendering. Audio and the media controls keep going.
- **Media keys and the Windows media overlay** (SMTC) from the first stage, so you can control the
  music without leaving the game.
- **Lyric source menu and per-track nudges** stay on the web, as on Android.

## Goals

1. A Windows app that feels made for Windows, not a web page in a frame.
2. The Listen room full screen on any monitor: the room, the album palette, the lyric field with
   everything Android has, Lyrics / Visual / Cover views, reactive to the real audio.
3. Liquid glass that looks like board A on the gaming PC, at the display's refresh rate.
4. Then everything else the web app does on the Navidrome side (Goals of stages 3–4 below).

## Non-goals

- YouTube Music (F15), Performance mode (F16), admin and connection settings.
- Light theme. An installer, MSIX, auto-update or code signing.
- Replacing the GTK Linux app (`Linux/`). The Avalonia app runs on Linux for development only.
- Server changes. None are expected. If one turns out to be needed, it is a separate commit, and
  deploying it needs the owner's word.

## Anti-goals (a failure even if it works)

- **Glass that costs legibility.** The lyrics are never under glass. Text on glass stays readable
  over the loudest cover (`PRODUCT_SPEC.md` §1.1 rule 5).
- **Stealing the game's frames**: rendering while hidden, or a frame rate above the display's.
- **Stutter in the lyrics.** Lyric timing comes from the audio clock, never from frame counts.
- **A different ECHO.** Same words, same behaviour, same lyric motion as the web and Android.

## The look (board A)

- **Ground**: ECHO's true dark neutrals. Colour comes from the playing album: the room and page
  headers use the album palette (extracted colours, OKLab, crossfaded). Covers appear as covers:
  never blurred, stretched or overlaid with text (`DESIGN_SYSTEM.md` §8).
- **Shell layout**: a **floating glass sidebar** (12 px from the window edges, rounded). Logo;
  Home, Search, Your Library; the user's playlists. The content scrolls **full width underneath**
  it. A **glass search capsule** and an **account button** sit top right. A **glass player pill**
  floats at the bottom centre of the content: cover, title, artist, progress, previous / play-pause
  / next, and the play button is a glass lens of its own. Sheets (queue), menus and dialogs are
  glass too.
- **Glass, direction A**: a near-clear fill (about 10% dark tint), frost of 1 px or less, and the
  10-28 bend (thickness 24, bezel 20, IOR 1.5, refraction 1.0; device-independent pixels). The
  specular rim light comes from the top left (135°), with saturation 1.5 on what shows through.
  The rim bends a **fixed-width band**, whatever the element's size.
- **Legibility on clear glass**: text on glass gets a soft dark shadow. The tint deepens where the
  backdrop under that piece of glass is bright (sampled luminance; my call, as Apple does), so
  white text keeps its contrast.
- **Windows "Transparency effects" off** (Settings → Personalisation → Colours): every glass surface
  becomes opaque, as the web's reduced-transparency fallback did.
- **The Listen room**: the room fills the window, with the lyric field over it. The chrome (top bar
  and transport) is glass and hides after 3 s of play, as on the web and Android. The lyrics are
  never under glass. The sidebar does not show here, as on the web's Stage (my call).
- **The window itself is opaque** (my call). The glass bends ECHO's own content, not the desktop
  or the game behind the window. A system backdrop (Mica/Acrylic) would show nothing under a
  full-screen room anyway.
- **Type**: Segoe UI Variable, as the web's `--font` already says, then Segoe UI (Windows 10). On
  the dev box, Inter, which Avalonia bundles (my call). The web's Selawik ships as `.woff2`, which
  Avalonia does not load, and only the dev box would ever need it.

## How it is built

- **Folder**: `Windows/` becomes the Avalonia app; the WPF files go. Its parts mirror Android's
  packages: `Api` (keep and extend `Api.cs`), `Library`, `Playback`, `Stage`, `Stage/Lyrics`, `Ui`,
  `Glass`. The device token keeps `TokenStore.cs`'s DPAPI on Windows. On Linux dev runs it is a 0600
  file under `$XDG_STATE_HOME`.
- **Server API**: the same `/api/v1` calls Android uses (`Android/…/api/Api.kt`,
  `docs/api/openapi.yaml`). That covers the device token, Subsonic through the proxy, signed stream
  URLs, lyrics, the palette, the saved queue and scrobbles. The default server is
  `https://echo.folk3s.com`; `ECHO_URL` overrides it.
- **The room**: the web's GLSL ES 3.00 shaders (room, energy, composite, probe), generated from
  `src/client/stage/shaders.ts` the way `scripts/android-shaders.ts` does for Android. A test fails
  when the copies are stale. They run in Avalonia's OpenGL control: ANGLE on Windows, desktop GL
  (Mesa) on the dev box.
- **The glass**: a GPU shader (Skia runtime effect / SkSL) that draws each glass rect from the
  backdrop beneath it. It reads the 10-28 bend lookup and adds the rim light. How to get the
  backdrop is the builder's call; the first stage must prove it. Either snapshot what has been drawn
  under the rect (Skia API lease), or re-draw the known layers (room, covers) into an offscreen
  surface. Glass over the room may live in the GL pass, as Android's glass boxes did.
- **Audio**: decoding and output that hand the decoded PCM to the FFT features (`Features`,
  VISUALIZER_SPEC.md §3.2). Output uses WASAPI on Windows and Pulse/ALSA on the dev box. The output
  latency is compensated like Android's `AudioTap` (measure it on Windows). FLAC, MP3 and WAV play
  as stored; the server already sends everything else as MP3 320. Lean: **SoundFlow** (miniaudio).
  The first stage confirms it, or swaps it.
- **Windows integration**: SMTC through WinRT in a Windows target framework, and a plain
  `net10.0` target for Linux dev runs, which leave it out. Full screen on a chosen monitor (F11 or
  double-click the room), and the app remembers which monitor.
- **Frame budget**: render at the display's refresh rate, never above it. Android's governor tiers
  stay. Rendering stops when minimised or fully covered.
- **Tests**: unit tests for the ported pure logic, mirroring Android's JVM tests. Screenshots of
  every screen on the dev box: Avalonia headless renders through Skia, and the GL room uses a real
  window under Xvfb. A throwaway server with the mock Navidrome (`ANDROID_CLIENT.md` "Testing
  against a local server").
- **Build**: `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true`
  gives `ECHO.exe` (not in git), on the dev box and in CI alike.
- **Windows CI** (`.github/workflows/windows.yml`, my calls): on every push that touches
  `Windows/**`, a `windows-latest` runner builds the exe, runs the unit tests, and runs
  `ECHO.exe --smoke`. The smoke run opens the window on built-in fixtures (generated covers and a
  palette; the runner cannot host an ECHO server), draws the glass and the room (software
  rendering through WARP: the runner has no GPU), and exits 0 after a few seconds; the workflow
  screenshots it before then.
  The screenshot is uploaded as a workflow artifact, so the builder sees Windows' own rendering. A
  tag `windows-v*` also publishes a **pre-release** with `ECHO.exe` attached (`contents: write`
  for the workflow's own token, nothing else).
- **The owner runs each stage's exe on the gaming PC**, downloaded from the repo's Releases page.
  Nothing here can run Windows, so each stage ends with a tag, a pre-release and that check.
  Pushing the branch and its tags is part of the agreed delivery; merging to `main` still waits for
  the owner.

## Stages

1. **Prove it**: a window with glass over a scrolling grid of real covers, the GL room running from
   the shared shaders, a song playing with the FFT features moving the room, the Windows CI with
   its smoke screenshot, and the first pre-release. Gate: on the gaming PC the owner sees board A's
   glass, hears the song and sees the room react.
2. **The Listen room**: sign in, albums → album → play, the player pill, the Stage (room, palette,
   Reverb, Lyrics / Visual / Cover views, brightness, chrome auto-hide, governor), the lyric field
   with everything Android has, the queue saved to and restored from the server, scrobbles, SMTC
   and media keys, and full screen on a second monitor.
3. **Library and search**: Home (mixes), albums (four sorts), artists, playlists, starred,
   album and artist pages, search, Play next / Add to queue, the queue sheet (move, remove,
   clear), shuffle and repeat, the Wanted list.
4. **Settings and finish**: visuals, motion, lyrics size and timing, scrobbling, sign out, this
   user's sessions and devices, the keyboard map and shortcut sheet (F10), the designed states
   (F11), an icon, and the docs (`Windows/README.md`, `PRODUCT_SPEC.md` F14,
   `TECHNICAL_ARCHITECTURE.md`).

## Constraints

- Windows 10 (1809 or later) and Windows 11, x64 (my call: what .NET 10 and SMTC support).
- .NET SDK 10.0.113 and NuGet on the dev box (an i7-3770, no AVX2; Mesa GL). Node 24 and pnpm
  for the shader generator.
- Work on the branch `windows-glass` (my call).
- The repository is public: no secrets, tokens or personal data in commits. Test against the
  throwaway server, never the live one.
- Merging and anything outward-facing waits for the owner.

## Left to the builder

- The backdrop technique for the glass, and the audio library, both settled by stage 1.
- Project and test layout, the test framework, and how the shaders are embedded.
