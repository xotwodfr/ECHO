# ECHO for iOS

A native iPhone client for an ECHO server: Swift and SwiftUI, AVPlayer for audio, the
Keychain for the device token. Server: `https://echo.folk3s.com` (the Android app's); `ECHO_URL` in
the Xcode scheme's environment points it at another.

Code both apps share lives in `Apple/Shared` (the plan's layout,
`docs/superpowers/plans/2026-11-19-apple-apps.md`): `App/` (entry, routing, the tabs or sidebar,
Settings), `Api/` (the client, models, preferences, the Keychain token, the session and
the offline state), `Library/` (the library the screens see: hearts, playlists, the album sorts,
the artists, Home's shelves, the Wanted list and the cover cache), `Playback/` (the player: the
queue, the engine, the queue that follows you, scrobbles, the lock screen's info), `Lyrics/` (the
lyrics: the loader, the field's model, the layout and the style), `Motion/` (the lock screen's
animated covers: asking for them, waiting, the files kept), `Settings/` (the preferences kept on
this device), `Widget/` (what the app and the home-screen widget share: what plays, its folder in
the App Group, the widget's timeline and its buttons), `UI/` (the screens,
their components and the room's look), `Preview/` (the `-ECHODemo` screens on a built-in library),
`Assets.xcassets` (the amber accent) and `AppIcon.icon`. `Apple/Tests` holds the Swift tests.
This folder holds what is iOS's own: the app entry (`Sources`), the home-screen widget's extension
(`Widget`) and its views (`WidgetViews`, which the app's demo screens draw too), the entitlements
(the App Group) and the project.

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
  where it plays from, the heart, the scrubber, the transport in one glass capsule, Lyrics, AirPlay
  and Up next (Karaoke opens with its task).
- **The lock screen and Control Center**: the song, its cover, length and place
  (`MPNowPlayingInfoCenter`, built in one place, `Playback/NowPlayingInfo.swift`), and play, pause,
  next, previous, seek and the heart (`MPRemoteCommandCenter`).

## Lyrics

- **The server's lyrics** for the playing song (`GET /lyrics`: word-synced, line-synced or plain
  text), asked for 250 ms after the song changes (skipping through songs costs nothing), an answer
  for another song dropped, "No lyrics found" with the sources tried after 6 s while a late answer
  still shows, ECHO not answering said with Try Again, and the next song's lyrics asked ahead.
- **The lyric field** (`docs/LYRICS_EXPERIENCE.md`, the web's model ported as it is): the column
  with the line being sung 40% of the way down and the rest one gap apart, dimmer and softer with
  distance, scrolled by springs in a ripple at each hand-over; the word sweep with its one soft edge
  along the line, the bright edge in the album's light, the word being sung lifted and swollen, the
  glow behind it (its alpha never faster than 1.5/s; 60% while paused), held words letter by
  letter, the interlude dots in gaps of 7 s or more, backing vocals under their line, duets on two
  sides; line-synced lines lit by one wash, plain lyrics as a still sheet; the scrubber followed
  while it is held, a tap on a line plays from it, reduced motion (a crossfade in place) and Motion
  off (a still sheet) as Settings has them. Set with CoreText, drawn in SwiftUI.
- **On the iPhone**: Now Playing's glass Lyrics button opens them over the album's light, the song
  in a glass card under them; swipe down (or the chevron) goes back.
- **The source's credit** on glass ("Word-synced · LRCLIB") opens the lyrics menu: the attribution
  with its links, the source to use for this song (or automatic), and this song's timing in 50 ms
  steps (`PUT /me/tracks/{trackKey}/override`, saved half a second after the last step), with the
  total said in a toast; the global offset from Settings is added, and the output's latency
  (AirPlay's included) is taken off the clock.

## The lock screen's animated cover

- **The playing album's motion cover** (`docs/MOTION.md`): on the album's first play the app asks
  ECHO for it (`GET /motion/{album}?shape&loop`), tall (3:4) and square, at the loop length chosen
  in Settings. While ECHO makes it (202) the lock screen keeps the still cover and the app asks
  again after each Retry-After, never sooner, the waits growing by half to a minute, ten minutes in
  all; another album playing, or another speed chosen, stops the asking for the one before. Once
  it is ready, its first frame (`/still`) and its looping video (`/video`) are downloaded into a
  cache of their own in Caches (64 MB, the least recently used let go first, emptied on sign-out)
  and the lock screen gets them (`MPMediaItemAnimatedArtwork` under
  `MPNowPlayingInfoProperty3x4AnimatedArtwork` and `MPNowPlayingInfoProperty1x1AnimatedArtwork`, the
  first frame as its preview image), the still cover staying under it. The next play of the album
  shows it at once; a kept cover is checked against ECHO's version once a day (an admin's upload
  replaces it). A cover that cannot be made, no motion service, or no network leaves the still
  cover. ECHO picks the motion (Depth for photographs, Living light for flat art).

## The home-screen widget

- **Now Playing, small and medium** (`iOS/Widget`, WidgetKit): the cover, the song and the artist on
  the album's own light (its colours, as the app's room has them; a pale cover's glow dimmed under
  the words), and the progress, which runs from the song's start by itself
  (`ProgressView(timerInterval:)`, no reloads while the song plays) and holds where it is when
  paused. The small one has play and pause; the medium one the time played and the length, and
  previous, play or pause and next in one capsule, as Now Playing's transport. Nothing playing:
  the ECHO mark and "Play something". A tap anywhere else opens Now Playing (`echo://now-playing`,
  the app's URL scheme). The medium one has the Android widget's buttons.
- **iOS 26's looks**: full colour on the album's colours; tinted and clear, where the system takes
  the background away and draws its own glass, the words white, the progress and the buttons in
  the accent group (`widgetAccentable`), the cover kept a cover in full colour
  (`widgetAccentedRenderingMode(.fullColor)`).
- **Through the App Group** `group.com.folk3s.echo`: the player writes a small snapshot (the song,
  artist and album, the album's colours, playing or not, where in the song and when, its length)
  and the cover drawn small (a JPEG at most 400 px) from the same values it gives the lock screen at
  the same moment, so the widget, the lock screen and Control Center never disagree. The widget's
  timelines are reloaded when the song, play or pause, a seek or the cover change, once a second at
  most, never as the song plays on; a playing song's timeline also holds it stopped at its end,
  should the app say nothing more by then. Signing out empties the folder. No container (an
  unsigned build): nothing is written, the widget shows nothing playing, the music plays on.
- **The buttons are App Intents** (`AudioPlaybackIntent`), which the system runs in the app's
  process, starting it in the background when it is not running: the app then reads the saved
  queue first (8 s at most), and Play plays on from where the widget showed.
- **What needs a signed build**: unsigned, as the runner builds it, the app and the extension have
  no entitlements, so the simulator gives the app no App Group container (`containerURL` is nil:
  the app logs it at launch). The extension is embedded and the simulator's plugin registry lists
  it, but with no container to read it could only show nothing playing. Signed ad hoc (`CODE_SIGN_IDENTITY=-`, no
  developer account; a step of the workflow builds it so), the simulator gives the app its App
  Group container, writable. On a device the app and the widget need the owner's Apple developer
  team and the App Group registered for both (`DEVELOPMENT_TEAM` in `project.yml`).

## Signing a computer in, and guests

- **Sign in a computer** (Settings → Sign in and guests; `Apple/Shared/Guests`, `UI/ScanScreen.swift`):
  the camera full-bleed (VisionKit's `DataScannerViewController`, QR codes only; the camera asked
  for with `NSCameraUsageDescription`) under a glass title, ECHO's white frame and a glass card.
  A scanned `https://echo.folk3s.com/link#<id>` (the web sign-in page's QR code) is peeked
  (`/auth/qr/peek`): which browser asks and from which network; **Approve** (`/auth/qr/approve`)
  signs it in, **Deny** sends nothing (the request runs out in two minutes). A code run out or used
  (404) says to reload the page; a guest pass, another server's code or anything else says what it
  is; 429 waits for its Retry-After (a minute without one) before checking another code; a refused
  code is not asked about again for 4 s while the camera keeps seeing it. Writes are never repeated.
- **Scan a guest pass** (the sign-in page, before anyone is signed in): the same scanner. A scanned
  `<origin>/guest#<code>` shows whose pass it is and for how long (`/guests/peek`); **Join as guest**
  redeems it (`/guests/redeem`) and the device token goes in the Keychain as any sign-in's. The
  session knows its pass (`/guests/me`, kept for the next start), and the app listens only: no
  hearts (songs, albums, artists, Now Playing), no Wanted changes, no inviting, no signing a computer
  in (the server's `GUEST_DENY`); the library refuses those itself (the lock screen's Love too).
  Home shows "You're ada's guest · 18 h left"; Settings shows the pass. When the time is up the
  server deletes the account, and the sign-in page comes back saying the pass has ended.
- **Guests** (Settings → Guests): **Invite a guest** shows the code full-screen on glass, a white QR
  plate (error correction H, the Echo mark in the middle), "Works once, for 9:41", 1 hour / 1 day /
  1 week (a new code for each), and the guest joining noticed by asking `/guests` every 3 s. The
  list shows each guest's time left, **Approve** for a request to stay and **End now**. The server
  has no call to take back a code not yet scanned: it runs out by itself after 10 minutes (at most
  five wait at once).
- **Guest links**: `echo://guest#<code>` (also `/<code>` or `?code=`) opens the guest pass on the
  sign-in page; signed in, the scanner opens and says to sign out first. `https://…/guest#` links
  (the QR code's own) need Associated Domains, which need a signed build.
- **What needs a real device**: the camera (the simulator has no data scanner: the demo screens draw
  a sign-in page in its place); the scan, Approve and Join have only run in tests against the
  server's recorded answers.

## Settings

- **One page in the room** from Home's account button: groups on glass, each under its title.
  **Lock screen**: the animated cover as the lock screen shows it (tap it for the whole lock screen
  in a preview) beside its loop speed, Fast, Normal, Slow or Very slow (5, 8, 12 or 15 s, ECHO's
  lengths), kept on this iPhone (the server's preferences have no key for it, and the web no such
  setting). **Sign in and guests**: Sign in a computer and Guests (a guest sees its pass instead).
  **Account**: who is signed in, the server, Sign out. **About**: the version. The
  widget has no setting: its size and look are the home screen's.

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
lock screen's commands and info, what the mini player and Now Playing show; the lyrics: the
loader, and the field's timing, springs, motion and layout on the web's own cases and lyric
fixtures; and the animated covers: ECHO's answers, the waits, giving up, another album stopping
it, the files kept and let go, the version checked, the lock screen's keys, the loop speed; and the
widget: what the app writes into the App Group and the widget reads back, the cover drawn small,
the timeline and the progress from the song's start, when the app writes and reloads (and when not),
its buttons on the player, the link it opens, the folder emptied on signing out, and no App Group
at all; signing a computer in and guest passes: what a scanned code holds, peek, Approve, Deny, a
code run out or used, 429 and its Retry-After, joining as a guest and its limits, the pass at start
and its end, inviting, listing and ending guests, and guest links; against the server's recorded answers in `Apple/Tests/Fixtures`, which
`scripts/apple-fixtures.ts` records from the server's own code) run in Xcode (the `ECHOTests` scheme), on every push in
`.github/workflows/apple.yml`, or with:

```sh
xcodebuild test -project iOS/ECHO.xcodeproj -scheme ECHOTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Checked 2026-11-20 on GitHub's macOS 26 runner (Xcode 26.6, the iOS 26.5 SDK, apple run 38): both apps build with no
Swift warnings, the Swift tests pass in the iOS 26 simulator (293) and on the Mac (293; on both the Keychain's
data-protection round trip skips, the test host having no entitlement), and the app runs in the
simulator on its built-in library, a player that never streams and the web's lyric fixtures
(`Apple/Screenshots`: `-ECHODemo home`, `shelves`, `album`, `artist`, `playlist`, `mix`, `library`,
`albums`, `search`, `wanted`, `mini`, `nowplaying`, `queue`, `lyrics`, `lyrics-interlude`,
`lyrics-plain`, `lyrics-menu`, `settings`, `lockcover` (the lock screen preview on a loop made from
the web fixture's Harbour Lights cover), `widgets`, `widgets-tinted`, `widgets-idle` (the
widget's own views at their sizes on a home screen like iOS 26's: playing and paused in full
colour; tinted and clear, drawn as the system draws them; nothing playing), `signin`, `shell`,
`scan` (the scanner on a drawn camera), `approve` (a computer asking), `guest-pass` (a pass scanned
from the sign-in page), `guest-invite` (an invite's QR code), `guests` (the list), `guest-home`
(the app as a guest)). A green run also uploads `ECHO-ipa`, an unsigned Release device build to
sideload. It has not yet signed in to a real server or played through one.

## Next

Sign in to a real server and play on a device, and scan a real sign-in page and guest pass with
the camera; then the plan's next tasks (`docs/superpowers/plans/2026-11-19-apple-apps.md`): Themes (11b: they go in Settings' Appearance group; Settings parity, 11a, is done, apple run 46), then Karaoke, Listen together, downloads (10), finish. The real lock screen's animated cover and the real widget on the home screen are to be seen
on a device, signed (the simulator's lock screen and home screen cannot be screenshotted
reliably, and an unsigned build has no App Group). Offline downloads (10) are paused: their code is kept in git history (commits 36116ea, 56c096c, 380d2d6; re-apply by `git revert 6bf75cb`), unfinished, it had not built green yet.

## Settings (11a)

Settings has the groups Appearance, Playback, Lyrics, Lock screen, Sign in and guests, Account, About
(`Apple/Shared/App/SettingsScreen.swift`, `SettingsGroups.swift`). What follows the user is
`/me/settings` (`SettingsEditor`, one key at a time); what is this device's is `DeviceSettings` (stream
quality, background brightness, Performance mode). Every Android setting, where it is kept and its status:
`docs/superpowers/plans/apple-settings-parity.md`. The demo screens `settings`, `settings-playback` and
`settings-lyrics` show it (apple run 46: Swift tests 308 on both platforms).
