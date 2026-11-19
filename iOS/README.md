# ECHO for iOS

A native iPhone client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the
Keychain for the device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in
the Xcode scheme's environment points it at another.

Code both apps share lives in `Apple/Shared` (the plan's layout,
`docs/superpowers/plans/2026-11-19-apple-apps.md`): `App/` (entry, routing, the tabs or sidebar,
the account sheet), `Api/` (the client, models, preferences, the Keychain token, the session and
the offline state), `Playback/`, `UI/` (screens and the room's look), `Preview/` (the `-ECHODemo`
screens with built-in albums) and `AppIcon.icon`. `Apple/Tests` holds the Swift tests. This folder
holds what is iOS's own: the app entry and the project.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in the Keychain as this device's
  alone (never synced or restored elsewhere). **Sign out** ends this device's session on the server
  too (Settings → Account → Sessions & devices). A token the server refuses (revoked, idle 60 days)
  brings the sign-in back.
- **The app around it**: Home, Library and Search (on the Mac, the sidebar) in the approved Liquid
  Glass look, with an offline banner; their pages are placeholders the library task fills. The API
  client already reads albums, songs, artists, playlists, Liked, search, the preferences that follow
  the user (`/me/settings`) and signed stream URLs (`/navidrome/stream-url/:id`, 6 h, this song
  only); the baseline's player (AVPlayer, the album going on) waits in `Playback/` for the playback
  task.

## Build and run

On a Mac with Xcode 26 (iOS 26, for Liquid Glass):

```sh
brew install xcodegen
cd iOS && xcodegen && open ECHO.xcodeproj
```

Then run it in a simulator, or on your iPhone with your Apple developer team set under Signing &
Capabilities (or `DEVELOPMENT_TEAM` in `project.yml`). The generated `ECHO.xcodeproj` and
`Info.plist` are not committed: `project.yml` is the project.

The Swift tests (Swift Testing, `Apple/Tests`: the API client, models and sign-in against the
server's recorded answers in `Apple/Tests/Fixtures`, which `scripts/apple-fixtures.ts` records from
the server's own code) run in Xcode (the `ECHOTests` scheme), on every push in
`.github/workflows/apple.yml`, or with:

```sh
xcodebuild test -project iOS/ECHO.xcodeproj -scheme ECHOTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Checked 2026-11-19 on GitHub's macOS 26 runner (Xcode 26): both apps build with no Swift
warnings, the Swift tests pass on the Mac and in the iOS 26 simulator, and the app runs in the
simulator (`Apple/Screenshots`, `-ECHODemo signin` and `shell`). It has not yet signed in to a real
server.

## Next

Sign in to a real server and run it on a device; then the plan's next tasks
(`docs/superpowers/plans/2026-11-19-apple-apps.md`): Home, Library and Search with covers, playback
with the queue that follows you (`/me/queue`) and the lock screen's controls and artwork
(`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`), lyrics, and the rest.
