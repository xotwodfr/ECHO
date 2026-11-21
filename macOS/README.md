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
the rest of Themes (11b stage 2; stage 1, ECHO and Liquid Glass, is done, apple run 49), Listen together, downloads (10), the menu commands; signing and notarization to share it. Offline downloads (10) are paused: their code is kept in git history (commits 36116ea, 56c096c, 380d2d6; re-apply by `git revert 6bf75cb`), unfinished, it had not built green yet.

## Karaoke (task 8, stages 1 and 2: apple runs 61 and 62)

`docs/KARAOKE.md` is the contract. **Playback** (`Apple/Shared/Karaoke/`): the server's karaoke file (AAC 5.1, instrumental on the front channels, vocals on the rear) is fetched with the device token to a file in the temporary folder (`KaraokeFiles`) and played by `KaraokeAudioEngine` (AVAudioEngine): read in 2 s pieces, each split by `KaraokeChannels` (by the file's layout tag) into two stereo pairs for two `AVAudioPlayerNode`s that meet in a mixer, then an `AVAudioUnitTimePitch`. The Vocals slider is the vocals node's volume (`KaraokeMath.volumes`: instrumental 1, vocals = level, as Android's mixer and the web's `vocalGains`); the key is the time-pitch unit's cents (100 a semitone, +-6, bypassed at 0). `RoutedEngine` sends a song to the ordinary engine or the Karaoke engine by `EngineItem.karaoke` and stops the other; `Player.item(for:)` picks the version when `Karaoke.audio(for:)` has one, `Player.karaokeChanged()` reloads the song at the same position when Karaoke is turned on or off or a version comes ready, and a version that will not play falls back to the original (left alone 5 minutes). The queue, scrobbling and the lock screen's info are the player's as before; the lyrics clock reads the engine's `currentTime` and `outputLatency` (plus the time-pitch unit's own latency). **Server:** `Karaoke` (`@Observable`) asks `/karaoke/{id}` for the song playing every 5 s until ready and the next two with `?soon=1` once a minute, `/karaoke` for the progress; 429 is `EchoClient`'s. **UI:** `UI/KaraokeControls.swift`: the Karaoke button (Now Playing; the Mac's player bar with a compact Vocals slider and a Key menu), `KaraokePanel` (Vocals and Key sliders and the note: Now Playing, the lyrics, the Mac's lyrics), the Home shelf turns Karaoke on and plays versions from the first note, Settings → Karaoke (mode, default level, key: all this device's, `DeviceSettings`; and the server's progress). **Stage 2:** "Make karaoke version" in the song menu (`TrackMenu`; hidden for guests and for songs not from the library: the server lets a guest read versions but asking costs the host's CPU), with the web's notices; the server gives no percent, only the songs ahead, so "working" shows as the note under the sliders. Demo screens: `karaoke`, `karaoke-lyrics`, `karaoke-shelf`, `karaoke-making`, `karaoke-menu` (the menu listed in a sheet), `settings-karaoke`. Tests: `Apple/Tests/KaraokeTests.swift` (392 tests on each platform in run 62), fixtures `karaoke-*.json`. **Differs from Android and the web:** the file is downloaded whole before it plays (AVAudioFile cannot stream), so a version starts after its download; two Karaoke songs follow each other with a small gap (the next is fetched while one plays and started when it ends), a Karaoke song and an ordinary one are not gapless; the slider has no glide (a node volume is set at once); album and playlist menus have no entry (the web has none). **Needs a real device:** all the audio (channel order as Core Audio hands the file back, the two nodes starting together, the pitch quality, interruptions, the engine restarting on a route change, the lyrics' sync with the time-pitch latency); the tests use fakes.

## Listen together (task 9; stage 1 join and follow: apple run 66, 468 Swift tests on each platform)

`docs/TOGETHER.md` is the contract (server: `src/server/together.ts`; the web's `src/client/together`; Android's `together/`). **Code** (`Apple/Shared/Together/`): `TogetherModels` (the session state every answer carries, `TrackRef`, the host's `TogetherAction`, `TogetherError` told apart from the server's status and `error`, `TogetherOffer`), `TogetherSync` (`sync.ts` in Swift: `ClockSync`, `expectedPosition`, `TogetherPlan.step` and `.cue`, `TogetherLink` for `<origin>/together/<id>` and `echo://together/<id>`), `TogetherApi` (`TogetherSource`, the protocol the controller talks to, `EchoClient` implementing it; `SSEParser`, which reads the event stream byte by byte because Foundation's `lines` drops the blank line that ends each event; `EchoClient.open` for the long GET), `Together` (the `@Observable` controller). **Following:** `Together.follow()` twice a second compares the player with the session (`TogetherPlan`): another song is loaded cued 1.5 s ahead and started when the session gets there, play and pause follow, a drift over 300 ms is corrected, then 2.5 s to settle; positions are compared as heard (`Player.audibleTime`) and asked of the engine plus `outputLatency`, so AirPlay or Bluetooth is allowed for. **The player's controls:** `Player.remote` (`PlayerRemote`): while in a session `toggle/resume/pause/next/previous/seek`, `playNext`, `addToQueue` and `play(_:at:)` (a row, the lock screen, the widget, the media keys) go to the session: the host's transport is `POST /control`, a member is told "Only the host controls playback." and can add songs (a song picked from a list is added at the end; the host's is queued first and jumped to). The host's player tells the session when a song ends (`next` with `from`). The system pausing the sound (headphones out, a call) holds following (`Player.followHeld`) until the person plays. **The personal queue:** `Player.beganSession()` keeps the queue and holds `QueueSync` (`/me/queue` is never written during a session); leaving puts the queue back, paused where it was (the web's rule; Android just stops), and an empty player stays empty. **Events:** `listen` reads `GET /together/:id/events` (state first, ping every 15 s with the version, end), opens it again 1, 2, 4 ... 30 s apart (the server's 429 wait when it gives one), takes only states not older than the one held, asks for the state when a ping names a newer version, and polls every 5 s (1 s while the stream is down) for the clock's round trips. The server sends no event ids, so there is no Last-Event-ID: the first state after a reconnect is the resync. **Joining:** the scanner (`ScanFlow` purpose `.joinTogether`, `ScanPayload.together`), an `echo://together/<id>` link (`AppLink.together`, a link opened signed out waits for the sign-in), or a pasted link in the Together sheet (the only way on the Mac) all give `Together.consider(id)`: whose session, Join or Not now (`409 other_library` says "Joining needs the same library"). A session this person is still in is joined again at launch. **UI** (`UI/TogetherViews.swift`): the Together button in Now Playing's row (the Mac's player bar), the sheet (join; or listeners, the song, the shared queue "added by", Leave or End session) and the offer, presented from Now Playing while it is open and from the shell otherwise (a sheet cannot open under a full-screen cover); on the Mac they are cards in the window, since a sheet or popover is a window of its own. Up next is the shared queue in a session (`SharedQueueList`). Universal https links need Associated Domains (signing), so only the app's own scheme and the scanner open an invitation. **Differs from Android and the web:** no whole-second cue for transcoded streams (AVPlayer seeks by byte range); the queue is put back on leaving as on the web, Android's is not; the lock screen does go through the session (Android's does not). Tests: `Apple/Tests/TogetherTests.swift` and `TogetherFollowTests.swift` (the events, sync arithmetic, links, every call and refusal against `together-*.json` recorded from the server by `scripts/apple-fixtures.ts`, the follow rules and controls on a fake engine and `FakeTogether`, reconnecting, leaving, the personal queue untouched against the stub). **Only tested against fakes, needs a real device:** the real audio and AirPlay latency, the sync across two real devices (the cue and the drift correction on a real engine), the camera scan, the `echo://` link from Notes or Messages, the lock screen's buttons in a session, an interruption while following.

## Themes (11b, all 14: stage 3, apple run 58)

**Clay, Yarn, Paper & origami and Retro hi-fi** are made too (textured surfaces and grounds, a plate under the lyrics, lyric looks, Android's sounds, **Clay in the dark** in Appearance; closest faithful versions, the differences are in the plan's "Picking this up"). Only Material You (Android's wallpaper theme) is not built. The **Apple Music, Spotify, SoundCloud, Deezer, Qobuz, Tidal, YouTube Music and Monochrome styles** are made too (apple run 53: 332 Swift tests; Android's accents, grounds and squareness; haptics only; demo screens `theme-<name>-home|nowplaying|lyrics`).  ECHO (the default) and **Liquid Glass** are made, chosen first in Settings → Appearance (the Settings window),
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
