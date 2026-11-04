# ECHO for Windows

A native Windows client for an ECHO server: WPF on .NET 10 with Windows 11's Fluent theme
(`ThemeMode="System"`: light or dark as Windows is, Mica behind the window). Server:
`https://echo.folk3s.com` (the Android app's), `ECHO_URL` for another.

WPF, not WinUI 3: WinUI 3 only builds on Windows, while this compiles anywhere the .NET SDK runs
(`EnableWindowsTargeting`), so every change can be checked before it reaches a Windows machine.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in `%LOCALAPPDATA%\ECHO`, encrypted
  for this Windows user (DPAPI). **Sign out** ends this device's session on the server too
  (Settings → Account → Sessions & devices). A token the server refuses (revoked, idle 60 days)
  brings the sign-in back.
- **Albums**, A–Z (the Subsonic proxy's `getAlbumList2`), and an album's **songs** (`getAlbum`).
- **Play**: a song from a signed stream URL (`/navidrome/stream-url/:id`, 6 h, this song only),
  through WPF's `MediaPlayer` (Media Foundation): MP3, AAC/M4A, FLAC, WAV and WMA as stored; Opus,
  Ogg and the rest, which it does not play without extras, come from Navidrome as MP3, 320 kbps.
  The album goes on, and stops after its last song. A bar with the song, its time, and play/pause.

## Build and run

On Windows 10 or 11 with the .NET 10 SDK:

```powershell
dotnet run
```

`dotnet build` also works on Linux and macOS (it checks the code; the app runs on Windows only).
`ECHO_URL` points it at another server, e.g. a test server.

Checked 2026-11-04: it builds without warnings on Linux, and `Api.cs` (everything but the window)
ran against a test server with the mock Navidrome: a wrong password, sign in, albums, an album's
songs, a stream without a header, sign out. The window itself has not run yet.

## Next

Run it on Windows; covers, search, playlists, the queue that follows you (`/me/queue`), lyrics,
the system media controls (SMTC), an installer (MSIX) and an icon.
