# Listen together

Several people hear the same song at the same moment, each on their own device, and anyone can add
songs to a shared queue (like Spotify Jam). The host starts a session and shows its link as a QR code.
Anyone signed in to the same ECHO server can join: from the link in a browser, or by scanning the code
with the Android app. Guest accounts can join too.

## Who can do what

| | Host | Member |
|---|---|---|
| Play, pause, seek, Next, Previous | yes | no (a toast says "Only the host controls playback") |
| Add songs (Add to queue, Play next) | yes | yes |
| Play a song now (picked from a list) | yes: it is queued first and played | it is added to the end |
| Remove a queued song | any | the ones they added |
| Play a queued song now (jump) | yes | no |
| Leave | ends the session for everyone | leaves |

Every queued song shows who added it.

## The library rule

Members play the songs through their own ECHO session (`/api/v1/navidrome/stream/{id}`), so song ids
must mean the same thing for everyone: a member's Navidrome connection must point at the host's
Navidrome server (the same scope as `navidromeUrlOf` in `src/server/navidrome/routes.ts`). Otherwise
joining answers `409 other_library` and the app says "Joining needs the same library". A guest copies
its inviter's connection, so a guest can join its inviter's session (and any other on that server).

## Server (`src/server/together.ts`)

Sessions live in memory: a restart ends them. A session ends when its host leaves, or after
12 hours without anyone adding, controlling or joining. Members neither streaming events nor asking
for the state for 30 minutes are dropped. The session id is 18 random bytes, base64url: the link is
the secret, like a guest code. Limits: 50 members, 500 queued songs, 200 sessions per server; one
session per user (joining or starting another leaves the first).

The state every answer carries:

- `now`, `queue`: items `{ uid, track: TrackRef, addedBy: { id, username } }`.
- `playing`, `startedAt` (server time in ms at which the song was at 0, while playing),
  `positionMs` (the position at `serverTime`; where it stays while paused), `serverTime`, `version`.
- `members` (with `host` and `online`), `you` (`host`, `member`), `url` (what the QR code holds).

The server moves on by itself when a song's time is up (its length plus 1.5 s of grace, a timer per
session, and checked again on every request); the host's player also says so when the song ends
there (`next` with `from`, ignored if the session already moved on).

Routes (all signed in; documented in `docs/api/openapi.yaml`):

- `GET /together`: the session the caller is in, or `null`.
- `POST /together` `{ track?, positionMs?, playing?, queue? }`: start, on what the host is playing
  and with the host's upcoming songs as the shared queue.
- `GET /together/:id`, `POST /together/:id/join`, `POST /together/:id/leave`.
- `POST /together/:id/queue` `{ track, next? }`, `DELETE /together/:id/queue/:uid`.
- `POST /together/:id/control` `{ action: play | pause | seek | next | previous | jump, positionMs?, uid?, from? }`: host only.
- `GET /together/:id/events`: Server-Sent Events: `state` (first, then on every change), `ping`
  `{ serverTime, version }` every 15 s, `end`.

## Staying in step (`src/client/together/sync.ts`)

- **Clock.** Each client estimates `offset = server time − local time`. A polled answer was stamped
  between sending and receiving, so its midpoint is right to within half the round trip; the sample
  with the shortest round trip of the last 8 wins. A pushed event only says the offset is at least
  `serverTime − receivedAt`, which raises an estimate that was too low.
- **Position.** `expected = (local now + offset) − startedAt` while playing, `positionMs` while
  paused, clamped to the song.
- **Following.** Twice a second the player is compared with the session: another song is loaded,
  play and pause follow the host, and a drift over 300 ms is corrected. Loads and corrections while
  playing are cued ahead: the song is loaded paused on the first whole second at least 1.5 s ahead
  and started when the session gets there (a load takes time, and a transcoded stream can only start
  on whole seconds, Navidrome's `timeOffset`). After a correction the player gets 2.5 s to settle.
  Paused, a player on the whole second before the session's position counts as in step.
- **End of a song.** A song that ends here first waits for the session to move on: it is not started
  again, and Autoplay does not see an ended queue.

## Web

- "Listen together" in Now Playing (right panel) and at the top of the queue (panel or sheet) starts a
  session on the song playing and shows the sheet: QR code, link (Copy link), listeners, End session
  or Leave. In a session the button reads "Listening together · 3" and opens the sheet again.
- The queue shows the shared queue (Now playing, Up next, "added by …"); the host's row menu has Play
  now and Remove, a member's has Remove on their own songs.
- While in a session the controller's transport and queue go to the session (`RemoteQueue` in
  `src/client/playback/controller.ts`): the dock's buttons, media keys, "Add to queue" and "Play next"
  in every song and album menu, and a click on a song in a list.
- A link `/together/<id>` opened in the browser is remembered through sign-in, then offered: whose
  session it is, Join or Not now. A reload finds the session again (`GET /together`).
- Leaving puts back the queue from before joining, paused.

## Android

- Now Playing's pills have **Together** ("Together · 3" in a session). Its sheet starts a session
  (the song playing and what is up next) or opens the scanner to join one; in a session it shows the
  QR code and link, the listeners (host, you, away), the shared queue (the host taps a song to play
  it now; Remove for the host, or on one's own songs) and End session or Leave.
- The scanner is the guest scanner's camera (`Camera` and `Viewfinder` in `ui/GuestScan.kt`, now
  shared) reading `<origin>/together/<id>` for this app's server. A link opened on the phone opens
  the app too (an intent filter on `https://<server>/together/`, not auto-verified: Android asks
  which app). Both show the offer: whose session, Join or Not now; a link opened while signed out is
  offered after signing in.
- `together/Sync.kt` is `sync.ts` in Kotlin (tested in `TogetherTest.kt`); `together/Together.kt`
  holds the session, reads the event stream over OkHttp (no extra library), polls every 5 s (every
  second while the stream is down) and follows the session twice a second through `Playback.follow*`.
  While in a session `Playback.remote` takes Play/Pause, Next, Previous, Seek, Play next, Add to
  queue and a tap on a song in a list, as on the web; the song ending tells the session (host).

## Rough edges

- Sessions are in memory; a server restart ends them without telling the members until their next
  request (the event stream closes; polling then gets 404 and the app says the session ended).
- The shared queue cannot be reordered (only added to, removed from, jumped).
- YouTube songs cannot be shared (members could not play them): "Only songs from your library can be
  shared."
- Members' volume, EQ and the like stay their own; Karaoke mode follows each device's own setting.
- Android: the notification's and lock screen's buttons go to the player directly, not through
  `Playback.remote`: a member pausing there is played again within half a second, and a host's Next
  there skips only locally until the session puts it right. The app's Up next sheet still shows the
  local queue (one song); the shared queue is in the Together sheet.
- Sync is by position only: each device's own output latency (Bluetooth, say) is not measured.
