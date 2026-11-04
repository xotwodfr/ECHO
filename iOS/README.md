# ECHO for iOS

A native iPhone and iPad client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the
Keychain for the device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in
the Xcode scheme's environment points it at another.

The code is shared with the Mac app: `Apple/Shared` holds the API client, the token store, the
player and the screens. This folder holds what is iOS's own: the app entry and the project.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in the Keychain as this device's
  alone (never synced or restored elsewhere). **Sign out** ends this device's session on the server
  too (Settings → Account → Sessions & devices). A token the server refuses (revoked, idle 60 days)
  brings the sign-in back.
- **Albums**, A–Z (the Subsonic proxy's `getAlbumList2`), and an album's **songs** (`getAlbum`).
- **Play**: a song from a signed stream URL (`/navidrome/stream-url/:id`, 6 h, this song only)
  through AVPlayer: MP3, AAC/M4A/ALAC, FLAC, WAV and AIFF as stored; Opus, Ogg and the rest, which
  AVPlayer does not play, come from Navidrome as MP3, 320 kbps. It plays on with the screen off. The
  album goes on, and stops after its last song. A bar with the song, its time, and play/pause.

## Build and run

On a Mac with Xcode 16 or later (iOS 17 and later):

```sh
brew install xcodegen
cd iOS && xcodegen && open ECHO.xcodeproj
```

Then run it in a simulator, or on your iPhone with your Apple developer team set under Signing &
Capabilities (or `DEVELOPMENT_TEAM` in `project.yml`). The generated `ECHO.xcodeproj` and
`Info.plist` are not committed: `project.yml` is the project.

Checked 2026-11-04 without a Mac: every file parses with Swift 6.2, and `Api.swift` compiled and
ran on Linux against a test server with the mock Navidrome (a wrong password, sign in, albums, an
album's songs, a stream without a header, sign out). The app itself has not run yet.

## Next

Run it on a device; covers, search, playlists, the queue that follows you (`/me/queue`), lyrics,
the lock screen's controls and artwork (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`), an icon.
