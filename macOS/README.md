# ECHO for macOS

A native Mac client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the Keychain for the
device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in the Xcode
scheme's environment points it at another.

Code both apps share lives in `Apple/Shared` (the plan's layout,
`docs/superpowers/plans/2026-11-19-apple-apps.md`): `App/` (entry, routing, the tabs or sidebar,
the account sheet), `Api/` (the client, models, preferences, the Keychain token, the session and
the offline state), `Library/` (the library the screens see: hearts, playlists, the album sorts,
the artists, Home's shelves, the Wanted list and the cover cache), `Playback/`, `UI/` (the screens,
their components and the room's look), `Preview/` (the `-ECHODemo` screens on a built-in library),
`Assets.xcassets` (the amber accent) and `AppIcon.icon`. `Apple/Tests` holds the Swift tests.
This folder holds what is the Mac's own: the app entry (a window of a laptop's size) and the
project.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in the Keychain as this Mac's alone.
  **Sign out** ends this device's session on the server too (Settings → Account → Sessions &
  devices). A token the server refuses (revoked, idle 60 days) brings the sign-in back.
- **The app around it**: Home, Search, Albums, Artists, Liked Songs, Wanted and the playlists in
  the glass sidebar, the search field and the album sorts in the toolbar, in the approved Liquid
  Glass look, with an offline banner.

## Library and search

- **Home**: shortcuts to Liked Songs and the albums played last, then shelves: Recently played,
  New in your library, Made for you (`/me/mixes`), Karaoke (`/karaoke/ready`), your playlists, your
  most played, something different and the artists you play.
- **Library**: Playlists, Albums in the four sorts (Recently added, A–Z, Year, Most played; every
  page of `getAlbumList2`), Artists from the server's list with the ones you follow, Liked Songs and
  the shared Wanted list (add, and remove with Undo while its toast shows; the removal reaches the
  server only then).
- **Search**: Navidrome's `search3` 250 ms after typing stops: the top result (an artist, else an
  album with Play), songs, artists and albums; nothing found offers the Wanted list.
- **Pages**: Album, Artist (Popular, the discography, fans also like, about), Playlist, Liked Songs
  and each mix, each lit by its cover's colours; hearts on songs, albums and artists, and the song
  and album menus (play next, add to queue, like, go to the artist or album).
- **Covers** through `/navidrome/cover` with the device token, kept in memory and in Caches (the
  least recently used let go past each limit) and forgotten on sign-out.

Playing is the baseline's player for now (`Playback/`); the playback task makes it the real queue.

## Build and run

On a Mac with Xcode 26 (macOS 26, for Liquid Glass):

```sh
brew install xcodegen
cd macOS && xcodegen && open ECHO.xcodeproj
```

Then Run. The generated `ECHO.xcodeproj` and `Info.plist` are not committed: `project.yml` is the
project.

The Swift tests (Swift Testing, `Apple/Tests`: the API client, models, sign-in and the library,
with the sorts, Wanted's Undo and the cover cache, against the server's recorded answers in
`Apple/Tests/Fixtures`, which `scripts/apple-fixtures.ts` records from the server's own code) run
in Xcode (the `ECHOTests` scheme), on every push in `.github/workflows/apple.yml`, or with:

```sh
xcodebuild test -project macOS/ECHO.xcodeproj -scheme ECHOTests -destination 'platform=macOS'
```

Checked 2026-11-20 on GitHub's macOS 26 runner (Xcode 26, apple run 16): both apps build with no
Swift warnings, the Swift tests pass on the Mac (88) and in the iOS 26 simulator (87; the Keychain's
data-protection round trip skips where the test host has no entitlement), and the app runs on the
Mac on its built-in library (`Apple/Screenshots`: `-ECHODemo home`, `shelves`, `albums`, `album`,
`search`, `signin`, `shell`). It has not yet signed in to a real server.

## Next

Sign in to a real server; then the plan's next tasks (`docs/superpowers/plans/2026-11-19-apple-apps.md`):
playback with the queue that follows you (`/me/queue`), the player bar, the media keys and Now
Playing in Control Center (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`), lyrics, the menu
commands, and the rest; signing and notarization to share it.
