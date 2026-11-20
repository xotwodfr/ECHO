# ECHO for iOS

A native iPhone client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the
Keychain for the device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in
the Xcode scheme's environment points it at another.

Code both apps share lives in `Apple/Shared` (the plan's layout,
`docs/superpowers/plans/2026-11-19-apple-apps.md`): `App/` (entry, routing, the tabs or sidebar,
the account sheet), `Api/` (the client, models, preferences, the Keychain token, the session and
the offline state), `Library/` (the library the screens see: hearts, playlists, the album sorts,
the artists, Home's shelves, the Wanted list and the cover cache), `Playback/` (the player: the
queue, the engine, the queue that follows you, scrobbles, the lock screen's info), `UI/` (the screens,
their components and the room's look), `Preview/` (the `-ECHODemo` screens on a built-in library),
`Assets.xcassets` (the amber accent) and `AppIcon.icon`. `Apple/Tests` holds the Swift tests.
This folder holds what is iOS's own: the app entry and the project.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in the Keychain as this device's
  alone (never synced or restored elsewhere). **Sign out** ends this device's session on the server
  too (Settings → Account → Sessions & devices). A token the server refuses (revoked, idle 60 days)
  brings the sign-in back.
- **The app around it**: Home, Library and Search in the system's glass tab bar (Search in its own
  place, its field in the bar), in the approved Liquid Glass look, with an offline banner.

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

## Playback

- **The queue** as the web keeps it (`QueueState`, so a queue saved here plays on the web and on
  Android): a list plays from the song tapped, Play Next and Add to Queue go first, shuffle keeps the
  list's own order to come back to, repeat all and repeat one, Previous starts the song again past
  3 s; Up next on Now Playing reorders, removes and plays a song now.
- **AVQueuePlayer**, the next song buffered 5 s in so it starts without a gap where its format
  allows; each song's signed stream URL (`/navidrome/stream-url`, 6 hours), fetched again on Play
  after a long pause when it would run out before the song ends; a broken stream asked for again at
  its place three times, then skipped; ReplayGain as Settings has it (album gain within an album).
- **On with the screen off**: the audio session plays music (`UIBackgroundModes` audio); a call or
  Siri pauses it and it plays on after when the system says so; the headphones coming out pause it.
- **The queue that follows you** (`/me/queue`): read at sign-in and cued where it was (the API
  budget's 429 waited out after each Retry-After, five times at most), saved 2 s after a change and
  every 15 s while playing; a newer queue from another device is taken unless this one is playing.
- **Scrobbles** to Navidrome (now playing, then played at half the song or 4 minutes, as Settings
  allows) and ECHO's history (`/me/plays`, for Made For You) at the same point.
- **The mini player** in the tab bar's accessory, and **Now Playing**: the room lit by the cover,
  where it plays from, the heart, the scrubber, the transport in one glass capsule, AirPlay and Up
  next (Lyrics and Karaoke open with their tasks).
- **The lock screen and Control Center**: the song, its cover, length and place
  (`MPNowPlayingInfoCenter`, built in one place, `Playback/NowPlayingInfo.swift`), and play, pause,
  next, previous, seek and the heart (`MPRemoteCommandCenter`).

## Build and run

On a Mac with Xcode 26 (iOS 26, for Liquid Glass):

```sh
brew install xcodegen
cd iOS && xcodegen && open ECHO.xcodeproj
```

Then run it in a simulator, or on your iPhone with your Apple developer team set under Signing &
Capabilities (or `DEVELOPMENT_TEAM` in `project.yml`). The generated `ECHO.xcodeproj` and
`Info.plist` are not committed: `project.yml` is the project.

The Swift tests (Swift Testing, `Apple/Tests`: the API client, models, sign-in, the library, with
the sorts, Wanted's Undo and the cover cache, and playback on a fake engine: the queue, the gapless
hand-over, signed URLs, the saved queue with its 429s and conflicts, scrobbles, interruptions, the
lock screen's commands and info, what the mini player and Now Playing show; against the server's
recorded answers in `Apple/Tests/Fixtures`, which `scripts/apple-fixtures.ts` records from the
server's own code) run in Xcode (the `ECHOTests` scheme), on every push in
`.github/workflows/apple.yml`, or with:

```sh
xcodebuild test -project iOS/ECHO.xcodeproj -scheme ECHOTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Checked 2026-11-20 on GitHub's macOS 26 runner (Xcode 26, apple run 19): both apps build with no
Swift warnings, the Swift tests pass in the iOS 26 simulator (145) and on the Mac (146; the Keychain's
data-protection round trip skips where the test host has no entitlement), and the app runs in the
simulator on its built-in library and a player that never streams (`Apple/Screenshots`: `-ECHODemo
home`, `shelves`, `album`, `artist`, `playlist`, `mix`, `library`, `albums`, `search`, `wanted`,
`mini`, `nowplaying`, `queue`, `signin`, `shell`). It has not yet signed in to a real server or
played through one.

## Next

Sign in to a real server and play on a device; then the plan's next tasks
(`docs/superpowers/plans/2026-11-19-apple-apps.md`): lyrics (from Now Playing's Lyrics button), the
animated lock-screen covers, the home-screen widget, and the rest.
