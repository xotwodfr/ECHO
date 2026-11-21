# Settings parity: Android, the web and the Apple apps

Task 11a of [the plan](2026-11-19-apple-apps.md). Every setting the Android app has (its
`ui/Settings.kt` and `Prefs`), where the server and the web have it, and what the iPhone and the Mac
do with it. "User" settings follow the account (`/me/settings`, `UserSettings`, changed one key at a
time through `SettingsEditor`); "device" settings stay on the device (`DeviceSettings`, UserDefaults),
as the web keeps its per-device ones in the browser (`src/client/prefs.ts`). Out of scope by the
owner's choice, and left out of the table: YouTube Music mode, iPad, Material You, admin screens and
Downloads (task 10, parked).

Status: **done** (built, stored, and with its effect), **n/a** (does not apply on Apple, why), or
**deferred** (a feature that is not small, or another task's).

| Setting | Server key | Web | Kept | Apple | Status and where |
| --- | --- | --- | --- | --- | --- |
| ReplayGain (off, track, album, auto) | `playback.replayGain` | yes | user | iPhone, Mac | **done**: Playback; read by the player for each song (`ReplayGain.volume`) |
| Scrobble plays to Navidrome | `playback.scrobble` | yes | user | iPhone, Mac | **done**: Playback; the player's scrobbles are skipped when off |
| Stream quality (auto, 320, 192, 128) | none | yes (also "raw") | device | iPhone, Mac | **done**: Playback; `DeviceSettings.streamQuality`, asked of the stream URL (`EchoClient.streamFormat`). "Raw" is Auto here: a song plays as stored wherever the device can |
| Crossfade (0 to 12 s) | `playback.crossfadeSec` (unused by every client) | yes | device | iPhone, Mac | **deferred**: needs a second player and an equal-power fade (Android's `Crossfader`); `AVQueuePlayer` cannot overlap two songs. The key is never sent |
| Equalizer (on, preset, ten bands) | none | yes | device | iPhone, Mac | **deferred**: needs the audio moved onto `AVAudioEngine`; a feature of its own |
| Karaoke mode, vocal level, key | none | yes | device | iPhone, Mac | done (task 8): Settings → Karaoke |
| Autoplay (similar songs when the queue ends) | none | yes | device | iPhone, Mac | **deferred**: needs a "similar songs" queue feature the player does not have |
| Volume | none | yes | device | Mac | **n/a** in Settings: the iPhone uses the hardware keys; the Mac has the slider in its player bar |
| Lyric size (0.85, 1, 1.15, 1.3) | `lyrics.sizeScale` | yes | user | iPhone, Mac | **done**: Lyrics; scales the field and the sheets |
| Timing offset for all tracks (±2000 ms; Android allows ±5000, the server ±2000) | `lyrics.globalOffsetMs` | yes | user | iPhone, Mac | **done**: Lyrics; added to each track's own offset (`Lyrics.totalOffsetMs`) |
| Show lyrics without timing | `lyrics.showUnsynced` | yes | user | iPhone, Mac | **done**: Lyrics; the unsynced sheet or a note |
| Announce lyric lines | `lyrics.announceLines` | yes | user | iPhone, Mac | **done**: Lyrics; VoiceOver is told each line as it begins (`LyricAnnouncement`) |
| Lyric sources (five switches) | `lyrics.disabledSources` | yes | user | iPhone, Mac | **done**: Lyrics; the server leaves the sources off out of its lookup |
| Lyric style (Android's own styles) | none | no | device | iPhone, Mac | **deferred**: task 11b, with the themes (`LyricStyle`/`LyricLook`) |
| Visualizer behind the lyrics | none | no | device | none | **n/a**: Apple's room is the album's light, with no audio visualizer |
| Stage visuals (auto, reverb, ambient, still) and Reverb intensity | `visuals.mode`, `visuals.intensity` | yes | user | none | **n/a**: they choose the web and Android's audio-reactive visualizer, which the Apple apps do not have. The keys are left as they are on the account |
| Motion (system, full, reduced, off) | `visuals.motion` | yes | user | iPhone, Mac | **done**: Appearance; the lyric field's motion (Off is the still sheet) |
| Performance mode | none | yes | device | iPhone, Mac | **done**: Appearance; holds motion to Reduced (`effectiveMotion`), as the web does |
| Visual quality (auto to minimal) | none | yes | device | none | **n/a**: Apple's room has a single quality; Performance mode covers a slow device |
| Background brightness | none | yes | device | iPhone, Mac | **done**: Appearance; the strength of the room's album light on every page (`RoomModifier`) |
| Film grain | `visuals.grain` | disabled ("later") | user | none | **deferred**: the web has not built it either |
| Move with the pointer | `visuals.pointerParallax` | disabled ("later") | user | Mac | **deferred**: the web has not built it either |
| Theme | `appearance.theme` | yes | user | iPhone, Mac | **deferred**: task 11b (the Appearance group's slot) |
| Light or dark | `appearance.dark` | yes | user | iPhone, Mac | **deferred**: task 11b |
| Clay in the dark (album or a colour) | none | no | device | iPhone, Mac | **deferred**: task 11b, with the Clay theme |
| Theme sounds | none | no | device | iPhone | **deferred**: task 11b, with the themes |
| Haptics | none | no | device | iPhone | **n/a**: the system's controls give their own haptics; not on the server or the web, no Mac |
| Tab order | none | no | device | iPhone | **n/a**: the tab bar is the system's (iOS 26) and the tabs follow it |
| Downloads | none | no | device | | out of scope (task 10, parked) |
| Guests: invite, the guests | the guest API | yes | account | iPhone, Mac | **done** (task 7): Sign in and guests |
| Sign in on a computer (scan) | the link API | yes | account | iPhone | **done** (task 7) |
| Account: who, server, sign out | `/me`, `/auth` | yes | account | iPhone, Mac | **done**: Account |
| About | | yes | | iPhone, Mac | **done**: About |
| Lock screen's animated cover and its speed | the motion API | no (Apple's own) | device | iPhone | **done** (task 5): Lock screen |

Summary: 16 done (11 new here: ReplayGain, Scrobble, Quality, Size, Offset, Unsynced, Announce,
Sources, Motion, Performance mode, Background brightness; and 5 from earlier tasks: Guests, Sign in
on a computer, Account, About, Lock screen), 6 not applicable (Volume, Visualizer, Stage visuals and
intensity, Visual quality, Haptics, Tab order, counting Stage visuals and intensity as one), 11
deferred (Crossfade, Equalizer, Karaoke, Autoplay, Lyric style, Film grain, Move with the pointer,
and the themes' Theme, Light or dark, Clay in the dark, Theme sounds).

The groups, in order, in `Apple/Shared/App/SettingsScreen.swift` and `SettingsGroups.swift`:
Appearance, Playback, Lyrics, Lock screen (iPhone), Sign in and guests, Account, About; the Mac's
Settings window (⌘,) has the same ones but the lock screen's.
