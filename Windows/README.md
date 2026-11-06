# ECHO for Windows

A native Windows client for an ECHO server, with liquid glass, made for a gaming PC with ECHO full
screen on a second monitor (design: `docs/superpowers/specs/2026-11-06-windows-glass-design.md`;
plan: `docs/superpowers/plans/2026-11-06-windows-glass.md`). Avalonia 12 on .NET 10. Server:
`https://echo.folk3s.com`, `ECHO_URL` for another.

Avalonia, not WPF or WinUI 3: it builds *and runs* on the Linux dev box, so every screen can be
seen and tested before it reaches Windows, and it draws with Skia on the GPU (Direct3D 11 through
ANGLE on Windows), which the glass needs.

## Get it

Download `ECHO.exe` from the repository's Releases (`windows-v*`, pre-releases). One file, nothing
to install. Windows may say it protected your PC (the exe is not signed): **More info → Run anyway**.

## What it does

Everything the web app does on the Navidrome side, except the admin pages, the Navidrome connection
and Performance mode (on the web) and YouTube Music (not yet):

- **Sign in** with username, password and, with two-factor on, the code; the device token is kept
  for this Windows user (DPAPI, `%LOCALAPPDATA%\ECHO`). A token the server refuses brings the sign-in
  back and clears the queue.
- **Home** (Made For You, Jump back in, the shelves, your playlists), **Your Library** (albums in four
  orders, artists, playlists, Liked Songs, Wanted), **search** as you type, and a song's menu: Play
  next, Add to queue, its album, its artist, Like.
- **Playback**: FLAC, MP3 and WAV as stored, everything else as MP3 320; the queue (Next up, then
  where it plays from; the glass queue sheet), shuffle and repeat, the queue saved to the server and
  restored on another device (the playing device wins a conflict), scrobbles, ECHO's play history.
- **The Listen room** (click the player's cover): the room in the album's colours, reacting to the
  audio (the web's GLSL in Avalonia's GL control, a Skia fallback without GL), the word-by-word lyric
  field (ported from Android), or the cover, or the room alone. **Full screen** on the window's
  monitor (F11, F, double-click, the room's button); ECHO comes back on the same monitor.
- **Liquid glass** (board A, "Clear"): the sidebar, capsules, player, queue sheet and room chrome bend
  what is under them at their rims (`App/Glass`: the 10-28 model of `DESIGN_SYSTEM.md` §7.11, a Skia
  shader over a snapshot of what is under each panel), darken over bright covers, and turn opaque
  with Windows' Transparency effects off.
- **While you game**: the media keys and Windows' media overlay control ECHO; minimised, or covered
  by a full-screen game on the same monitor, the room and the lyrics stop drawing (audio goes on).
- **Settings**: stage visuals, intensity, quality, motion, cover brightness, lyric size and timing,
  unsynced lyrics, scrobbling; your sessions and devices; sign out. The keyboard map of
  `PRODUCT_SPEC.md` §7 (`?` shows it).

## Layout

| Folder | What |
|---|---|
| `App/Api` | The server: device token, Subsonic proxy, signed stream URLs, covers; OKLab; the models |
| `App/Glass` | The glass: the bend model, `glass.sksl`, `GlassPanel` |
| `App/Stage` | The room: palette, FFT features, Reverb, governor, renderer, view (Android's names) |
| `App/Playback` | Audio out (SoundFlow, miniaudio) and the tap the room listens to |
| `App/Ui` | The window, sign-in, the shell, pages, the player pill |
| `App/Fixtures` | A built-in library for `--smoke` and the tests |
| `Tests` | xUnit: the ported logic, and screens rendered headless through Skia |

## Build, test, run

With the .NET 10 SDK, on Linux or Windows:

```sh
dotnet test Windows/Tests                       # ECHO_TEST_SHOTS=<dir> also saves screenshots
dotnet run --project Windows/App -f net10.0     # the dev box (needs a display)
dotnet publish Windows/App -c Release -f net10.0-windows10.0.19041.0 -r win-x64 --self-contained \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o Windows/publish
```

`ECHO.exe --smoke` runs on the built-in fixtures with no server: the library, then the room after 8 s,
and exits 0 after 16 s. The Windows workflow (`.github/workflows/windows.yml`) runs the tests and the
smoke run on `windows-latest` and keeps both screenshots as the `smoke` artifact; a `windows-v*` tag
publishes the exe as a pre-release.
