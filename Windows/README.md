# ECHO for Windows

A native Windows client for an ECHO server, at its baseline: the starting point new features are
built on. Avalonia 12 on .NET 10, dark Fluent. Server: `https://echo.folk3s.com`, `ECHO_URL` for
another.

Avalonia, not WPF or WinUI 3: it builds *and runs* on the Linux dev box, so every screen can be seen
and tested before it reaches Windows, and the Windows CI runs the real exe.

(A full app with liquid glass was built on the branch `windows-glass` on 2026-11-06: the Listen room,
lyrics, the whole library. It stays there as a reference to take features from.)

## What the baseline does

The same core as every native baseline (Linux, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the code, in one request
  (`POST /api/v1/auth/device`). The device token is kept for this Windows user (DPAPI,
  `%LOCALAPPDATA%\ECHO`). **Sign out** ends this device's session on the server too; a token the
  server refuses brings the sign-in back.
- **Albums**, A–Z, and an album's **songs** (the Subsonic proxy's `getAlbumList2`, `getAlbum`).
- **Play** a song (double-click) from a signed stream URL: FLAC, MP3 and WAV as stored, everything else
  from Navidrome as MP3 320. The album goes on and stops after its last song. A bar with the song, its
  time, Previous / Play–Pause / Next.

## Layout

| Folder | What |
|---|---|
| `App/Api` | The server: device token, signed stream URLs, covers (the token goes to the server only); the models |
| `App/Library` | The albums and an album through the Subsonic proxy; which formats play as stored |
| `App/Playback` | Audio out (SoundFlow, miniaudio; songs decoded to the device's format) and the player |
| `App/Ui` | The window, sign-in, the library screen |
| `Tests` | xUnit: sign-in, the library, formats, the token, the player |

## Build, test, run

With the .NET 10 SDK, on Linux or Windows:

```sh
dotnet test Windows/Tests
dotnet run --project Windows/App -f net10.0     # the dev box (needs a display)
dotnet publish Windows/App -c Release -f net10.0-windows10.0.19041.0 -r win-x64 --self-contained \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o Windows/publish
```

`ECHO.exe --smoke` shows the sign-in and exits 0 after 8 s. The Windows workflow
(`.github/workflows/windows.yml`) runs the tests and the smoke run on `windows-latest` and keeps a
screenshot as the `smoke` artifact; a `windows-v*` tag publishes the exe as a pre-release.
