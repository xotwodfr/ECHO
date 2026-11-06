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

- **Sign in** with username, password and, with two-factor on, the code; the device token is kept
  for this Windows user (DPAPI, `%LOCALAPPDATA%\ECHO`). A token the server refuses brings the sign-in
  back.
- **Albums**, an album, and play from any song on: FLAC, MP3 and WAV as stored, everything else from
  Navidrome as MP3 320.
- **Liquid glass** (board A, "Clear"): the sidebar, the search and account capsules and the player
  pill bend what scrolls under them at their rims (`App/Glass`: the 10-28 model of
  `DESIGN_SYSTEM.md` §7.11, a Skia shader over a snapshot of what is under each panel).
- **The room**: the web's GLSL shaders (embedded from Android's assets) in Avalonia's GL control,
  reacting to the real audio (`App/Stage`, ported from Android); a Skia fallback where GL cannot run.

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
