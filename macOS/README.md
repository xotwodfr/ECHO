# ECHO for macOS

A native Mac client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the Keychain for the
device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in the Xcode
scheme's environment points it at another.

Code both apps share lives in `Apple/Shared` (the plan's layout,
`docs/superpowers/plans/2026-11-19-apple-apps.md`): `App/` (entry, routing, the tabs or sidebar,
Settings), `Api/` (the client, models, preferences, the Keychain token, the session and
the offline state), `Library/` (the library the screens see: hearts, playlists, the album sorts,
the artists, Home's shelves, the Wanted list and the cover cache), `Playback/` (the player: the
queue, the engine, the queue that follows you, scrobbles, Now Playing's info), `Lyrics/` (the
lyrics: the loader, the field's model, the layout and the style), `Motion/` (the lock screen's
animated covers: asking for them, waiting, the files kept), `Settings/` (the preferences kept on
this device), `UI/` (the screens,
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

## Playback

- **The queue** as the web keeps it (`QueueState`, so a queue saved here plays on the web and on
  Android): a list plays from the song tapped, Play Next and Add to Queue go first, shuffle keeps the
  list's own order to come back to, repeat all and repeat one, Previous starts the song again past
  3 s; Up next (the player bar's) reorders, removes and plays a song now.
- **AVQueuePlayer**, the next song buffered 5 s in so it starts without a gap where its format
  allows; each song's signed stream URL (`/navidrome/stream-url`, 6 hours), fetched again on Play
  after a long pause when it would run out before the song ends; a broken stream asked for again at
  its place three times, then skipped; ReplayGain as Settings has it (album gain within an album).
- **The queue that follows you** (`/me/queue`): read at sign-in and cued where it was (the API
  budget's 429 waited out after each Retry-After, five times at most), saved 2 s after a change and
  every 15 s while playing; a newer queue from another device is taken unless this one is playing.
- **Scrobbles** to Navidrome (now playing, then played at half the song or 4 minutes, as Settings
  allows) and ECHO's history (`/me/plays`, for Made For You) at the same point.
- **The player bar** at the bottom of the window, in glass: the song, shuffle, previous, play or
  pause, next and repeat over the scrubber, Lyrics, Up next and the volume.
- **The keyboard's media keys and macOS's Now Playing**: the song, its cover, length and place
  (`MPNowPlayingInfoCenter`, built in one place, `Playback/NowPlayingInfo.swift`), and play, pause,
  next, previous, seek and the heart (`MPRemoteCommandCenter`).

## Lyrics

- **The server's lyrics** for the playing song (`GET /lyrics`: word-synced, line-synced or plain
  text), asked for 250 ms after the song changes (skipping through songs costs nothing), an answer
  for another song dropped, "No lyrics found" with the sources tried after 6 s while a late answer
  still shows, ECHO not answering said with Try Again, and the next song's lyrics asked ahead.
- **The lyric field** (`docs/LYRICS_EXPERIENCE.md`, the web's model ported as it is): the column
  with the line being sung at 40% of its area and the rest one gap apart, dimmer and softer with
  distance, scrolled by springs in a ripple at each hand-over; the word sweep with its one soft edge
  along the line, the bright edge in the album's light, the word being sung lifted and swollen, the
  glow behind it (its alpha never faster than 1.5/s; 60% while paused), held words letter by
  letter, the interlude dots in gaps of 7 s or more, backing vocals under their line, duets on two
  sides; line-synced lines lit by one wash, plain lyrics as a still sheet; the scrubber followed
  while it is held, a tap on a line plays from it, reduced motion (a crossfade in place) and Motion
  off (a still sheet) as Settings has them. Set with CoreText, drawn in SwiftUI.
- **On the Mac**: the player bar's Lyrics button opens them in the whole window over the album's
  light, the song on the left (its cover, the scrubber and the transport on glass), the lyrics on
  the right; the chevron or Escape goes back, and `[` and `]` move this song's lyrics 50 ms
  earlier or later (the web's keys).
- **The source's credit** on glass ("Word-synced · LRCLIB") opens the lyrics menu: the attribution
  with its links, the source to use for this song (or automatic), and this song's timing in 50 ms
  steps (`PUT /me/tracks/{trackKey}/override`, saved half a second after the last step), with the
  total said in a toast; the global offset from Settings is added, and the output's latency
  (the output device's) is taken off the clock.

## Settings

- **The Settings window** (the app menu's Settings…, ⌘, or the toolbar's gear): groups on glass in
  the room. **Sign in and guests**: Guests (invite a guest with a QR code in a sheet on glass, 1 hour /
  1 day / 1 week, the guest joining noticed; the list with the time left, Approve for a request to
  stay and End now), and a note that a computer is signed in by scanning its code with ECHO on the
  iPhone (a Mac has no camera to scan with). A guest sees its pass instead and the app listens only
  (no hearts, no Wanted changes). **Account**: who is signed in, the server, Sign out. **About**: the version. The
  lock screen's animated covers are the iPhone's alone (the owner's decision), so the Mac has
  neither them nor their speed. Nor has it the iPhone's home-screen widget (not asked for on the
  Mac); its views would carry over, but a Mac widget extension runs sandboxed and needs a signed
  App Group, which the runner's builds cannot show.

## Build and run

On a Mac with Xcode 26 (macOS 26, for Liquid Glass):

```sh
brew install xcodegen
cd macOS && xcodegen && open ECHO.xcodeproj
```

Then Run. The generated `ECHO.xcodeproj` and `Info.plist` are not committed: `project.yml` is the
project.

The Swift tests (Swift Testing, `Apple/Tests`: the API client, models, sign-in, the library, with
the sorts, Wanted's Undo and the cover cache, and playback on a fake engine: the queue, the gapless
hand-over, signed URLs, the saved queue with its 429s and conflicts, scrobbles, interruptions, the
media keys' commands and Now Playing's info, what the player bar shows; and the lyrics: the
loader, and the field's timing, springs, motion and layout on the web's own cases and lyric
fixtures; against the server's recorded answers in `Apple/Tests/Fixtures`, which
`scripts/apple-fixtures.ts` records from the server's own code; the animated covers' and the iPhone
widget's tests run here too, the lock screen's keys and the simulator's App Group left out on the Mac) run in Xcode (the `ECHOTests` scheme), on every push in
`.github/workflows/apple.yml`, or with:

```sh
xcodebuild test -project macOS/ECHO.xcodeproj -scheme ECHOTests -destination 'platform=macOS'
```

Checked 2026-11-20 on GitHub's macOS 26 runner (Xcode 26.6, apple run 38): both apps build with no
Swift warnings, the Swift tests pass on the Mac (293) and in the iOS 26 simulator (293; on both the Keychain's
data-protection round trip skips, the test host having no entitlement), and the app runs on the
Mac on its built-in library, a player that never streams and the web's lyric fixtures
(`Apple/Screenshots`: `-ECHODemo home`, `shelves`, `albums`, `album`, `search`, `player`, `lyrics`,
`settings`, `signin`, `shell`, `guests` (Settings → Guests in its window)). It has not yet signed in to a real server or played through one.

## Next

Sign in to a real server; then the plan's next tasks (`docs/superpowers/plans/2026-11-19-apple-apps.md`):
the rest of Themes (11b stage 2; stage 1, ECHO and Liquid Glass, is done, apple run 49), Karaoke, Listen together, downloads (10), the menu commands; signing and notarization to share it. Offline downloads (10) are paused: their code is kept in git history (commits 36116ea, 56c096c, 380d2d6; re-apply by `git revert 6bf75cb`), unfinished, it had not built green yet.

## Themes (11b, stage 1)

ECHO (the default) and **Liquid Glass** are made, chosen first in Settings → Appearance (the Settings window),
with Light or dark and **Theme sounds** (the Mac has no haptics; its sounds play as system sounds). The choice
follows the account. The Mac's main window and Settings window read the theme as the iPhone's screens do
(`Apple/Shared/Themes`, `UI/Theming.swift`). Demo screens: `themes` (the Settings window), `theme-liquid-glass-home`
and `theme-liquid-glass-lyrics` (apple run 49: 330 Swift tests). What stage 2 needs: the plan's "Picking this up".

## Settings (11a)

Settings has the groups Appearance, Playback, Lyrics, Sign in and guests, Account, About
(`Apple/Shared/App/SettingsScreen.swift`, `SettingsGroups.swift`). What follows the user is
`/me/settings` (`SettingsEditor`, one key at a time); what is this device's is `DeviceSettings` (stream
quality, background brightness, Performance mode). Every Android setting, where it is kept and its status:
`docs/superpowers/plans/apple-settings-parity.md`. The demo screens `settings`, `settings-playback` and
`settings-lyrics` show it (apple run 46: Swift tests 308 on both platforms).
