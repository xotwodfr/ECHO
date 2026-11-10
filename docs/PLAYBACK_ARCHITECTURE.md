# ECHO — Playback Architecture

> **Navidrome only since 2026-11-03.** Spotify playback was removed (`1ea5b0b`, `385fa38`; why:
> [reviews/2026-11-03-spotify-outage.md](reviews/2026-11-03-spotify-outage.md)). Its sections are
> one-line stubs, kept so that section numbers (cited in code comments) stay put; their full text is
> in git before those commits.

Status: **Draft 2** · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §5 (types, clock, stores) · [Settings & security](SETTINGS_AND_SECURITY.md) (credentials) · [Visualizer](VISUALIZER_SPEC.md) §2 (analysis per provider) · [Lyrics integration](LYRICS_INTEGRATION.md)

Labels: **[C]** confirmed in official docs/terms/source (`DESIGN_RESEARCH.md` §5), **[R]** reported,
**[A]** assumption to verify in the named milestone.

---

## 1. Overview

```
UI (Dock, Library, Queue, keyboard, Media Session)
        │ commands                         ▲ PlaybackState, QueueState
        ▼                                  │
PlaybackController ── owns queueStore, playerStore, SongClock
        │
        └── NavidromeProvider  (HTMLAudioElement ×2 + Web Audio graph; via /api/v1/navidrome,
                                YouTube songs via /api/v1/youtube/stream, §11)
```

The controller is the only thing the UI talks to. Providers never touch stores directly. They emit
events that the controller maps.

---

## 2. Provider interface

```ts
interface ProviderCapabilities {
  canSeek: boolean;
  canSetVolume: boolean;
  canReorderQueue: boolean;
  canRemoveFromQueue: boolean;
  canCrossfade: boolean;
  audioFeatures: boolean;        // VISUALIZER_SPEC.md §2.1
}

interface PlaybackProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  connect(): Promise<void>;                 // provider-specific readiness (server ping)
  disconnect(): Promise<void>;

  load(track: Track, opts: { startMs?: number; autoplay: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;      // 0..1 UI value
  preload?(next: Track): Promise<void>;     // Navidrome gapless

  on(event: 'state', cb: (s: ProviderState) => void): Unsubscribe;   // position, paused, track, buffering
  on(event: 'ended', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: AppError) => void): Unsubscribe;

  features(): FeatureSource;                // AnalyserFeatures | AmbientFeatures
  // Providers playing an <audio> element (Navidrome): audio.currentTime and the output latency,
  // read by the SongClock every frame (TECHNICAL_ARCHITECTURE.md §5.2).
  audioClock?(): { positionMs: number; latencyMs: number } | null;
}
```

One implementation, `NavidromeProvider` (the fixtures' `FakeProvider` in development). No factory
or plugin registry: the controller holds the provider directly.

---

## 3. Transport semantics

| Command | Rule |
|---|---|
| Play/pause | Toggles. Before the first user gesture, `play()` is deferred to the gesture (autoplay policy). |
| Previous | If position > 3 s: seek to 0. Else go to the previous track in history. |
| Next | Next in `nextUp`, else `context`. With repeat-one, Next still advances (repeat-one only applies to natural end). |
| Seek | Optimistic: the clock re-anchors immediately (`TECHNICAL_ARCHITECTURE.md` §5.2), then the provider confirms. Seeks are throttled to one in flight. The latest request wins. |
| Volume | UI value `v` 0–1, applied as `v³` (perceptual). Persisted in settings. |
| Shuffle | Shuffles `context` only, keeps `nextUp` order, current track stays. |
| Repeat | `off → all → one`, controller logic. |
| End of queue | Stop. Show Cover mode with the last track. Clear the "playing" indicators. |

---

## 4. Spotify adapter (removed)

Removed on 2026-11-03 with Spotify playback: eligibility (Premium, Widevine), PKCE, the SDK
lifecycle, state mapping, the Web API, the policy gates G1/G2 and Connect's remote state.

---

## 5. Navidrome adapter

### 5.1 Configuration

**Per ECHO user:** the Navidrome URL (default `ECHO_NAVIDROME_URL`, i.e. `http://navidrome:4533` on
the shared compose network on the OptiPlex), the user's **own Navidrome username**, and **either**
password **or** API key. Entered in Account → Connections, sent once to the ECHO server, stored
encrypted, and never returned to any client (`SETTINGS_AND_SECURITY.md` §3, §6.1). Using each
person's own Navidrome account keeps Navidrome's per-user libraries, stars, playlists and play counts
correct.

### 5.2 Authentication and the proxy

ECHO's server signs every Subsonic request with the **requesting user's** credentials:

- Common params: `v=1.16.1`, `c=ECHO`, `f=json`.
- **Token auth (default):** a fresh random 12-byte hex salt per request; `t = md5(password + salt)`
  [C: Navidrome middleware]. The password must be stored to compute tokens. That trade-off is
  inherent to Subsonic token auth and is mitigated by encryption at rest (`SETTINGS_AND_SECURITY.md` §3).
- **API key auth** (preferred when available): if `getOpenSubsonicExtensions` lists
  `apiKeyAuthentication`, the settings form offers an API key. Requests then send `apiKey=` only;
  sending it with `u/p/t/s` is rejected [C: OpenSubsonic spec; Navidrome PR #6219]. As of
  2026-10-22 this is merged to Navidrome master but **not in a tagged release** (latest v0.64.2,
  2026-09-24) [C]. ECHO supports both and detects which one applies.
- **Allow-list:** the proxy forwards only these methods: `ping`, `getOpenSubsonicExtensions`,
  `getLicense`, `getScanStatus`, `getArtists`, `getArtist`, `getAlbum`, `getAlbumList2`, `getSong`,
  `getPlaylists`, `getPlaylist`, `getStarred2`, `search3`, `star`, `unstar`, `scrobble`,
  `getLyrics`, `getLyricsBySongId`, plus the streaming routes (`stream`, `getCoverArt`). Everything
  else → 403. ECHO cannot be used to delete playlists or change users even if the UI is compromised.
- Responses are passed through after stripping any echoed auth parameters. Error `code` 40/41/43/44
  map to "credentials rejected" (`AppError.code = 'navidrome.auth'`).

### 5.3 Connection test

`POST /api/v1/navidrome/test` (also run on save):
1. `ping`: reachability and auth.
2. `getOpenSubsonicExtensions`: capabilities (`songLyrics`, `transcodeOffset`,
   `apiKeyAuthentication`, …) cached for the session.
3. `getScanStatus`: track count.

Result shown as: "Connected · Navidrome 0.64.2 · 41,203 tracks · synced lyrics supported". Each
failure has its own message (unreachable/DNS, TLS error, 401, wrong URL path, not a Subsonic server).

### 5.4 Library mapping

| Screen | Calls |
|---|---|
| Albums (sort) | `getAlbumList2` `type=newest | alphabeticalByName | byYear | frequent | recent`, `size=60` with `offset` paging (infinite scroll with virtualisation) |
| Artists | `getArtists` (index), `getArtist` (albums) |
| Album detail | `getAlbum` |
| Playlists | `getPlaylists`, `getPlaylist` |
| Starred | `getStarred2` |
| Search | `search3` (`artistCount=6&albumCount=6&songCount=6`; "Show all" pages) |
| Cover art | `/api/v1/navidrome/cover/:id?size=` (proxy → `getCoverArt`, `Cache-Control: private, max-age=604800`) |

Song fields used: `id`, `title`, `artist`/`artists`, `album`, `albumId`, `duration`, `suffix`,
`contentType`, `bitRate`, `replayGain` (`trackGain`, `albumGain`, `trackPeak`, `albumPeak` [C:
OpenSubsonic responses]), `isrc` (an OpenSubsonic **array** when tags provide it [C: Navidrome v0.64.0 `responses.go`; M6]), `musicBrainzId`.

### 5.5 Streaming and seeking

- **Raw first:** if `audio.canPlayType(contentType)` is `probably`/`maybe` (FLAC, MP3, AAC/M4A, Ogg
  Vorbis/Opus and WAV in Chrome), stream with `format=raw`. Raw streams support HTTP Range [C:
  `http.ServeContent`], so seeking is native.
- **Remote listening:** the per-device `playback.quality` setting (`SETTINGS_AND_SECURITY.md` §7.1)
  decides raw vs transcoded. `auto` uses raw when a throughput probe (first 2 s of a stream) shows
  ≥ 4 MB/s, otherwise Opus 192. Navidrome does the transcoding on the OptiPlex.
- **Transcode otherwise:** `format=opus&maxBitRate=192` (or the chosen bitrate). Live transcodes send
  `Accept-Ranges: none` [C]. Seeking then requires `transcodeOffset`: reload the source with
  `timeOffset=<s>` and add the offset in the clock. Without that extension, seeking a transcoded
  track is disabled with the tooltip "This server can't seek in converted audio."
- The proxy forwards `Range` and streams the body without buffering (no transcoding or storage in
  ECHO).
- An upstream request ends after 15 s of silence from Navidrome. A listener that stopped reading (a
  paused player with a full buffer) is not that silence: bytes ECHO holds unread keep the stream open
  (`navidrome/client.ts`), since a live transcode cannot be asked for its rest.

### 5.6 Gapless and crossfade

- Two `<audio>` elements (A/B), each with its own `MediaElementAudioSourceNode` and ReplayGain node,
  summed into the shared analyser tap (`VISUALIZER_SPEC.md` §3.1).
- **Preload** the next track 20 s before the end (`preload()`), so the hand-over is gapless.
- **Crossfade** (Settings → Playback, 0 = off (default) … 8 s): equal-power gain ramps on the two
  ReplayGain nodes. The lyric field prepares the next document (`LYRICS_EXPERIENCE.md` §9.7).

### 5.7 Scrobbling

`scrobble?id=…&submission=false` at play start (now playing). `submission=true` once 50% of the track
or 4 minutes have played, whichever is first. Plays count in Navidrome only with `submission=true`
[C]. Setting: "Report plays to Navidrome" (default on).

### 5.8 Queue persistence

The queue and position are saved **per user on the ECHO server** (`PUT /api/v1/me/queue`, debounced
2 s) and restored on start in a paused state, so the queue follows the user from the laptop to the
gaming PC (and later to native clients). If two clients play at once, the last writer wins and the
other client shows "Queue changed on another device · Reload". A save of a queue the server already
holds (the periodic one, a pause, a seek) sends the position alone (`PATCH /api/v1/me/queue`, same
compare-and-set); a client falls back to the full `PUT` when the server refuses it. Navidrome's own
`savePlayQueue`/`getPlayQueue` sync is not used.

---

## 6. Queue model

```ts
interface QueueState {
  provider: ProviderId | null;
  now: Track | null;
  nextUp: Track[];        // user-added ("Play next" inserts at 0, "Add to queue" appends)
  context: Track[];       // remainder of the album/playlist/search list being played
  contextSource?: { kind: 'album' | 'playlist' | 'artist' | 'search' | 'starred'; id?: string; title: string };
  history: Track[];       // last 50, for Previous
  shuffleOrder?: number[];
}
```

### 6.1 Operations

| Operation | Rule |
|---|---|
| Play album/playlist from index | the controller fills `context`, loads `now` |
| Play next / Add to queue | insert into `nextUp` (at 0 / at the end) |
| Reorder / remove | yes (QUE-01) |
| Clear | `nextUp` + `context` |

### 6.2 Advancement

On `ended`: `nextUp.shift()` → else `context.shift()` (or the next in shuffle order) → else
repeat-all wraps → else stop. The previous `now` goes into `history`.

### 6.3 Spotify queue mirror (removed)

Removed on 2026-11-03 with Spotify playback.

---

## 7. Track state and timing

`PlaybackState` and the song clock are defined in `TECHNICAL_ARCHITECTURE.md` §5. The provider's
inputs:

| | Navidrome |
|---|---|
| Position source | `audio.currentTime` every frame |
| Latency correction | `outputLatency` (or `baseLatency`) |
| Buffering signal | `waiting`/`stalled` → `buffering` |
| Duration | Subsonic `duration` (s), refined by `audio.duration` |

---

## 8. Errors and reconnection

| Situation | Detection | Behaviour |
|---|---|---|
| Navidrome unreachable (idle) | health `ping` every 30 s while ECHO is visible | Status pill "Navidrome unreachable". Backoff 1, 2, 4, 8, 16, 30 s (cap), ±20% jitter. Library shows cached data with a freshness note. |
| Stream error mid-track | `audio` `error`/`stalled` > 8 s | Reload the source at the current position (Range or `timeOffset`), up to 3 attempts. Then skip to next with a toast "Couldn't play ‘Title’. Skipped." |
| Navidrome auth rejected | Subsonic code 40/41/44 | Stop retries. Settings row shows "Credentials rejected". Dock: "Reconnect Navidrome" link. |
| ECHO server unreachable (client still open) | fetch failures to `/api/v1/*` | Dock status "Can't reach the ECHO server · retrying", backoff as above. Navidrome audio already buffered keeps playing. |
| Session expired or revoked | 401 from `/api/v1/*` | Playback stops after the current track. Login sheet over the current screen, which returns to it after login. |

---

## 9. Provider differences (removed)

With one provider there is nothing to compare. Navidrome has Reverb visuals, the art palette,
word- and line-synced lyrics, seeking (transcoded streams need `transcodeOffset`), queue editing,
crossfade and gapless, the full library, works on the LAN without internet, and needs no attribution.

---

## 10. Media Session

`navigator.mediaSession.metadata` (title, artist, album, artwork 96/256/512) and action handlers
(`play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward`). The
position state is updated on each anchor. This gives OS media keys and system "now playing" for free.

---

## 11. YouTube songs (YouTube Music mode, 2026-11-03)

A YouTube song is an ordinary `Track` (`provider: 'youtube'`, key `youtube:<videoId>`) played by
the same provider: `navidrome.ts` points the `<audio>` element at `/api/v1/youtube/stream/:id`
instead of Navidrome. The queue, the song clock, Media Session and the lyrics carry on when the
mode switch flips; Reverb's audio-reactive visuals do not apply (YouTube Music mode has no Stage
room).

- **Resolving** (`src/server/youtube/ytdlp.ts`): the standalone yt-dlp (`yt-dlp_linux`, updated
  daily into the data volume) turns a video id into a googlevideo URL for format 140 (AAC,
  ~130 kbps), anonymously, never with the user's cookie. It asks as YouTube's visionOS app first
  (since 2026-11-04: ~2 s, and the URL plays at once) and falls back to yt-dlp's default clients
  when that gives nothing; a bot check or a song that is truly gone is not asked twice. At most
  two run at once; a song being played goes ahead of waiting look-ups (up to eight wait); a
  failure is remembered for 2 minutes; a bot check stops the queue with a message.
- **Streaming** (`proxy.ts`): the URL is bound to the server's IP, so the bytes come through ECHO.
  googlevideo refuses a `Range` header but serves a `range` query, so the browser's Range becomes
  that, 10 MiB at a time, with yt-dlp's own headers, and ECHO answers 206. A URL from the default
  clients is refused until its `available_at` (4–5 s after resolving); the proxy waits for it.
- **Looking up ahead** (`/youtube/prepare`, `radio.ts`): a page's first six songs as it opens (an
  album's or playlist's tracks too), a tap, a hover or focus, and the playing and next two songs
  in the queue; each song once an hour.
- **Seeking**: any position, as Range requests.

### 11.1 Start time (2026-11-04)

A song looked up ahead starts at once. Before 2026-11-04 one that was not took 8–14 s (production
log: 8 of 20 starts): 3.4–4 s of yt-dlp's default clients, then YouTube's 4–5 s `available_at`
wait, then the first chunk. Asked as visionOS, measured through `ytdlp.ts` on the OptiPlex: first
audio after **2.3–2.6 s**, no wait; and a page's first six songs are looked up as it opens.

Options considered:

| Option | Gain | Cost or blocker |
|---|---|---|
| **Built:** the visionOS client first, the defaults as a fallback | a cold start ~2.5 s instead of 8–14 s | YouTube may change which clients it serves freely; the fallback and the `available_at` wait stay |
| **Built:** a page's first six songs looked up as it opens | those start at once | more yt-dlp runs and requests to YouTube: six a page, each song once an hour, a backlog of eight |
| Keep played songs on disk (`/data/cache/audio`, a size cap), and fetch the next song in the queue whole | replays and seeks at once; no expired URLs or throttled chunks mid-song | disk (~4 MB a song) and a whole download for a song skipped early |
| yt-dlp's directory build (`yt-dlp_linux.zip`) instead of the one-file build that unpacks ~40 MB on every run | a part of each resolve (not measured) | a different update path |
| Format 251 (Opus, ~134 kbps) where the browser plays WebM | better sound at the same size | none for speed: the same wait |
| Other YouTube clients | — | all need a GVS PO token (BotGuard); a token provider is a service of its own and breaks when YouTube changes |
| Resolving inside the server with youtubei.js | no process start | the same PO-token wall, and none of yt-dlp's daily fixes |
| Streaming straight from the browser | — | the URL is bound to the server's IP |
| Starting on format 139 (49 kbps, no wait) and switching up | — | an audible switch mid-song |

