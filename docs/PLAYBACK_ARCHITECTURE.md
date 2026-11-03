# ECHO — Playback Architecture

Status: **Draft 2** · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §5 (types, clock, stores) · [Settings & security](SETTINGS_AND_SECURITY.md) (credentials, OAuth) · [Visualizer](VISUALIZER_SPEC.md) §2 (analysis per provider) · [Lyrics integration](LYRICS_INTEGRATION.md)

Labels: **[C]** confirmed in official docs/terms/source (`DESIGN_RESEARCH.md` §5), **[R]** reported,
**[A]** assumption to verify in the named milestone.

---

## 1. Overview

```
UI (Dock, Library, Queue, keyboard, Media Session)
        │ commands                         ▲ PlaybackState, QueueState
        ▼                                  │
PlaybackController ── owns queueStore, playerStore, SongClock
        │  one active provider at a time
        ├── NavidromeProvider  (HTMLAudioElement ×2 + Web Audio graph; via /api/v1/navidrome)
        └── SpotifyProvider    (Web Playback SDK device "ECHO" + Web API via short-lived token)
```

The controller is the only thing the UI talks to. Providers never touch stores directly. They emit
events that the controller maps.

---

## 2. Provider interface

```ts
interface ProviderCapabilities {
  canSeek: boolean;
  canSetVolume: boolean;
  canReorderQueue: boolean;      // Spotify: false
  canRemoveFromQueue: boolean;   // Spotify: false
  canCrossfade: boolean;         // Navidrome only
  audioFeatures: boolean;        // VISUALIZER_SPEC.md §2.1
  artPaletteAllowed: boolean;    // §4.6 gate G1
  syncedLyricsAllowed: boolean;  // §4.6 gate G2
  requiresAttribution: 'spotify' | null;
}

interface PlaybackProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  connect(): Promise<void>;                 // provider-specific readiness (SDK device ready, server ping)
  disconnect(): Promise<void>;

  load(track: Track, opts: { startMs?: number; autoplay: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;      // 0..1 UI value
  preload?(next: Track): Promise<void>;     // Navidrome gapless

  // Spotify plays contexts server-side; Navidrome receives explicit track lists from the controller.
  playContext?(ctx: PlayContext, offset: number): Promise<void>;
  enqueue?(track: Track): Promise<void>;

  on(event: 'state', cb: (s: ProviderState) => void): Unsubscribe;   // position, paused, track, buffering
  on(event: 'ended', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: AppError) => void): Unsubscribe;

  features(): FeatureSource;                // AnalyserFeatures | AmbientFeatures
  // Providers playing an <audio> element (Navidrome): audio.currentTime and the output latency,
  // read by the SongClock every frame (TECHNICAL_ARCHITECTURE.md §5.2). Spotify has neither.
  audioClock?(): { positionMs: number; latencyMs: number } | null;
}
```

One implementation per provider. No factory or plugin registry: the controller holds
`{ navidrome, spotify }` directly.

---

## 3. Transport semantics (both providers)

| Command | Rule |
|---|---|
| Play/pause | Toggles. Before the first user gesture, `play()` is deferred to the gesture (autoplay policy). Spotify: `player.activateElement()` is called on that gesture [C: SDK reference]. |
| Previous | If position > 3 s: seek to 0. Else go to the previous track in history (Navidrome) or `previousTrack()` (Spotify). |
| Next | Next in `nextUp`, else `context`. With repeat-one, Next still advances (repeat-one only applies to natural end). |
| Seek | Optimistic: the clock re-anchors immediately (`TECHNICAL_ARCHITECTURE.md` §5.2), then the provider confirms. Seeks are throttled to one in flight. The latest request wins. |
| Volume | UI value `v` 0–1, applied as `v³` (perceptual). Persisted in settings. Spotify volume is per device via `player.setVolume`. |
| Shuffle | Navidrome: shuffles `context` only, keeps `nextUp` order, current track stays. Spotify: Web API shuffle endpoint. |
| Repeat | `off → all → one`. Navidrome: controller logic. Spotify: Web API repeat endpoint. |
| End of queue | Stop. Show Cover mode with the last track. Clear the "playing" indicators. |

---

## 4. Spotify adapter

### 4.1 Requirements and eligibility

| Requirement | Fact | ECHO behaviour |
|---|---|---|
| Account | Web Playback SDK "requires a Spotify Premium subscription". Mobile-only Premium plans are excluded [C] | First run states it. `account_error` → "Spotify playback needs Premium." |
| App registration | Development Mode (from 2026-02-11 for new apps): **≤ 5 authorized users**, app owner must have Premium, one Development Mode Client ID per developer [C: quota modes + Feb 2026 update] | **One Spotify app per ECHO server, owned by the admin.** The admin enters its Client ID in Admin → Server and adds each Spotify-using ECHO user to the app's user list. At most 5 Spotify-connected users per server ("seats", shown in Admin; `SETTINGS_AND_SECURITY.md` §6.2). Each user still connects **their own** Spotify account. ECHO ships with no Client ID. |
| Extended quota | Organisations only, ≥ 250k MAU [C] | Out of scope |
| Commercial use | "This SDK must not be used in commercial projects without Spotify's prior written approval" [C]. Developer Policy IV: no commercial use of streaming apps [C] | ECHO is AGPL-3.0 open source, self-hosted and non-commercial. Each operator runs their own server and Spotify app. Recorded in About. |
| Browser | Widevine (EME) required. Supported: Chrome, Firefox, Safari, Edge [C] | Detection per `TECHNICAL_ARCHITECTURE.md` §2.2 |
| Native clients (future) | The Web Playback SDK is for browsers. No official SDK plays Spotify inside a third-party mobile app | Mobile clients act as a **Spotify Connect remote** (§4.7). Desktop clients need Electron ECS for in-app playback. |

### 4.2 Authentication

Authorization Code with **PKCE**, run by ECHO's server (details and token storage in
`SETTINGS_AND_SECURITY.md` §6.2). Scopes:

| Scope | Why |
|---|---|
| `streaming` | Web Playback SDK [C] |
| `user-read-playback-state`, `user-modify-playback-state` | devices, transfer, play, seek, shuffle, repeat, volume, queue add [C] |
| `user-read-currently-playing` | currently playing and queue read [C] |
| `user-library-read`, `playlist-read-private` | browse saved albums, Liked Songs and the user's playlists |
| `user-library-modify`, `user-follow-read`, `user-follow-modify` | hearts save to Spotify (`/v1/me/library`); followed artists in Your Library (2026-11-02) |
| `user-top-read`, `user-read-recently-played` | Spotify Home: top tracks and artists, Jump back in (2026-11-02) |
| `user-read-private` | Required by Search [C: scopes doc, 2026-10-24] and returns `product`, which ECHO reads to say "Spotify playback needs Premium" before the SDK fails. |
| `user-read-email` | No endpoint ECHO uses needs it, and the SDK reference names no scopes [C]; Spotify's own SDK example still requests it [R]. Kept until the M7 manual checklist shows the SDK plays without it (one constant, `SPOTIFY_SCOPES`). |

The scope list is `REQUIRED_SCOPES` (`src/shared/spotify-scopes.ts`), shared with the browser: the
token route also returns the scopes Spotify granted, and a connection made before a scope was added
shows "Reconnect Spotify to finish setting it up." in Settings (a 403 naming the scope maps to
`spotify.scope`, never to "not on the user list").

The client asks the server for the **current user's** access token (`POST /api/v1/spotify/token`)
whenever the SDK calls `getOAuthToken`, and before Web API calls. Access tokens last 3600 s [C]. The
server refreshes per user when fewer than 5 minutes remain.

### 4.3 SDK lifecycle

1. Load `https://sdk.scdn.co/spotify-player.js` **only after** Spotify is connected (no third-party
   script for Navidrome-only users). The script opens a hidden iframe at
   `https://sdk.scdn.co/embedded/index.html` with `allow="encrypted-media; autoplay"`; the player
   runs inside it [C: the script itself, 2026-10-24]. ECHO's CSP therefore needs `sdk.scdn.co` in
   `script-src` and `frame-src`, `api.spotify.com` in `connect-src` and `i.scdn.co` in `img-src`,
   which it already has (`src/server/http.ts`).
2. On `onSpotifyWebPlaybackSDKReady`: `new Spotify.Player({ name: 'ECHO', getOAuthToken, volume })`.
   Listen for `ready`, `not_ready`, `player_state_changed`, `autoplay_failed`,
   `initialization_error`, `authentication_error`, `account_error`, `playback_error` [C].
3. `connect()`. On `ready({ device_id })`, store the device id.
4. To play in ECHO: `PUT /v1/me/player` `{ device_ids: [device_id], play: false }` (transfer), then
   `PUT /v1/me/player/play?device_id=…` with `context_uri` + `offset`, or `uris`.
5. `player_state_changed` → map to `ProviderState` (§4.4). Poll `getCurrentState()` every 1000 ms
   while playing, because the event fires "at random intervals" and carries no timestamp [C]. Stamp each
   sample with `performance.now()` on receipt (`TECHNICAL_ARCHITECTURE.md` §5.2).
6. `not_ready` → status "Reconnecting". `connect()` is retried with backoff (§8).

### 4.4 State mapping

| SDK field | ECHO |
|---|---|
| `track_window.current_track` (`id`, `uri`, `name`, `artists[]`, `album{ name, uri, images[] }`, `duration_ms`) | `Track` (`key = spotify:<id>`, `spotifyId = id`, `artwork = album.images`) |
| `position`, `paused` | `positionMs`, `status` |
| `track_window.next_tracks`, `previous_tracks` | queue mirror hint (§6.3) |
| `disallows` | capability adjustments (e.g. `seeking`) |
| `shuffle`, `repeat_mode` (0/1/2) | `shuffle`, `repeat` |
| ISRC | **not in the SDK state.** Fetched once per track via `GET /v1/tracks/{id}` → `external_ids.isrc` when needed. The Feb 2026 removal of `external_ids` was reverted in March 2026 [C]. |

### 4.5 Web API usage

All calls go **from the browser** with the short-lived access token. A Navidrome page load makes none: Spotify's playlists, hearts and saved albums load when the Spotify source is open or a heart for one of its items is on screen. The refresh token never leaves
the server. Rate limiting: on `429`, a `Retry-After` up to 30 s is slept through once; a longer one,
a second `429`, or a Development Mode quota (`{"error":{"reason":"QUOTA_EXCEEDED"}}`, which has no
30 s window and is shared by the developer's apps) starts a page-wide cooldown (the `Retry-After`;
else 1 min, or 15 min for the quota). Until it is over no Web API call is sent and the SDK is not
asked to connect (its own `check_scope` calls count too), and the message says how long Spotify
asked ECHO to wait. A reconnect clears it. The adapter keeps one in-flight request per endpoint.

| Need | Endpoint (checked against the February 2026 migration guide, 2026-10-24) |
|---|---|
| Transfer / play / pause / seek / next / previous / shuffle / repeat / volume | `/v1/me/player/*` [C: unchanged in the Feb 2026 guide] |
| Queue read / add | `GET /v1/me/player/queue`, `POST /v1/me/player/queue?uri=` |
| User playlists | `GET /v1/me/playlists`. Playlist items via `/playlists/{id}/items` (renamed from `/tracks`). Only playlists the user owns or collaborates on are readable [C: Feb 2026 guide] |
| Saved albums | `GET /v1/me/albums` (unchanged). Saving and checking use the generic `PUT`/`DELETE /v1/me/library` and `GET /v1/me/library/contains` with Spotify URIs [C: Feb 2026 guide] |
| Search | `GET /v1/search` (`track,album,artist`), **limit ≤ 10** (default 5) [C] |
| Playlist page | `GET /v1/playlists/{id}` (name, owner, description) + its items |
| Liked Songs, followed artists | `GET /v1/me/tracks`, `GET /v1/me/following?type=artist` |
| Hearts (save, follow) | `PUT`/`DELETE /v1/me/library` with `{ uris }` (tracks, albums, artists) [C: Feb 2026 guide] |
| Artist page | `GET /v1/artists/{id}`, `GET /v1/artists/{id}/albums`; search `artist:"…"` if the latter is refused. No top tracks: "Your liked songs by this artist" instead |
| Home | `GET /v1/me/player/recently-played`, `GET /v1/me/top/tracks`, `GET /v1/me/top/artists` |
| Single track | `GET /v1/tracks/{id}` (batch `GET /tracks` removed [C]) |

Not used: Audio Features, Audio Analysis, Recommendations, Related Artists (restricted for new apps
[C]); artist top tracks, new releases, browse categories (removed in Development Mode [C]).

### 4.6 Policy compliance

Spotify's Developer Terms (v10, effective 2025-05-15), Developer Policy and Design Guidelines
[C, near-verbatim; re-read before any release]:

| Rule (source) | ECHO behaviour |
|---|---|
| Cover art must be shown with Spotify playback: "no playback of Spotify Content without showing relevant cover art and metadata" (Policy II.5) | Dock always shows the artwork, title and artist for Spotify tracks. These never auto-hide (`PRODUCT_SPEC.md` §6.1). |
| "Artwork must be kept in its original form": no cropping, animation, distortion, overlays, blurring, controls or text on top; corner radius 4px or 8px (Design Guidelines) | `DESIGN_SYSTEM.md` §8: opacity-only crossfades, 4/8px radii, no overlays (the album-tile hover play button sits **outside** the artwork for Spotify tiles: below-right, not on top). The spring motion (§11.2, 2026-11-02) never scales or flies Spotify's artwork: Spotify cards don't fly to their page, the lyrics view's cover flight is skipped while Spotify plays, and its covers only fade |
| Spotify logo must accompany Spotify content, minimum 70px wide; metadata links back to Spotify (Design Guidelines; Policy II.4) | Dock and detail views show the official Spotify logo (asset downloaded from Spotify's design page in M7, not redrawn) and link title/artist/album to `open.spotify.com` |
| "You may adjust the size of metadata or cover art"; no modifying or derivative works (Terms IV.2.b) | Sizes only |
| No caching of Spotify Content except as strictly necessary; keep data current (Terms IV.3.b) | ECHO caches **no** Spotify audio, artwork or metadata on disk. TanStack Query memory cache only. With G1 on, only the *derived palette* is cached (30-day TTL). The source image is decoded in memory and discarded. |
| No integration of Spotify streams with content from another service (Policy III.5) | One provider per queue (`PRODUCT_SPEC.md` §6.2). No crossfade or mixing between providers. |
| No segue, mix, re-mix or overlap of recordings (Policy III.7) | No crossfade for Spotify (`canCrossfade: false`) |
| No analysis of Spotify Content (Policy III.13) | No audio analysis (impossible anyway with DRM). **Gate G1** below for artwork colour. |
| Do not synchronise sound recordings with visual media (Policy III.6) | Ambient environment is not synchronised to the recording (`VISUALIZER_SPEC.md` §2.2). **Gate G2** below for synced lyrics. |
| Stream ripping or capture prohibited (Terms IV.2.b.iii, VI.5) | No system/tab audio capture (`VISUALIZER_SPEC.md` §2.3) |

**Policy gates.** These are features whose permissibility ECHO could not confirm from the terms.
**Decision (product owner, 2026-10-22): both gates are ON, with the policy risk knowingly
accepted** for this personal, non-commercial, self-hosted use. Each gate stays a single server-level
switch (Admin → Server → Spotify), so either can be turned off instantly if Spotify objects or
clarifies otherwise:

| Gate | Feature for Spotify tracks | Concern | Setting (default) | When off |
|---|---|---|---|---|
| **G1** | Art-derived palette | Extracting colours from cover art may count as "analysing Spotify Content" (III.13) | `spotify.gates.artPalette` (**on**) | Spotify tracks use the Sodium fallback palette |
| **G2** | Time-synced lyrics (word or line) during Spotify playback | Could be read as synchronising recordings with visual media (III.6). Lyric rights for third-party sources are unclear (`LYRICS_INTEGRATION.md` §9) | `spotify.gates.syncedLyrics` (**on**) | Lyrics shown as an untimed sheet (`LYRICS_EXPERIENCE.md` §9.3) |

The gates keep the codebase provider-agnostic. Every lyric and palette path already handles "untimed"
and "fallback", so a switch needs no new code. Audio-reactive visuals are **not** gated: they are
impossible for Spotify (no PCM) and remain Ambient.

### 4.7 Spotify Connect remote state

If the user moves playback from ECHO to another device, ECHO's SDK player stops. ECHO then shows a
**remote state**: Cover mode with "Playing on <device name>" and a **Play here** button (transfer
back). It polls `GET /v1/me/player` every 5 s while visible. No lyric sync in remote state.

**Future mobile clients** use this remote state as their *normal* Spotify mode. The official Spotify
app plays the audio, and the ECHO mobile client controls it through the Web API and shows the stage.
Lyric sync in that mode would rely on 5 s polling plus extrapolation, which is too coarse for word
sync. Mobile Spotify therefore shows line-level lyrics at most [A: evaluate when the mobile client is
designed].

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
other client shows "Queue changed on another device · Reload". Navidrome's own
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
  history: Track[];       // last 50, for Previous (Navidrome)
  shuffleOrder?: number[];
}
```

### 6.1 Operations

| Operation | Navidrome | Spotify |
|---|---|---|
| Play album/playlist from index | controller fills `context`, loads `now` | `playContext(context_uri, offset)` |
| Play next / Add to queue | insert into `nextUp` | `POST /me/player/queue` (append only; "Play next" becomes "Add to queue" with a note) |
| Reorder / remove | yes | **no** (API has no reorder/remove) |
| Clear | `nextUp` + `context` | not possible. The button is hidden. |
| Cross-provider | **never mixed** (§4.6 III.5). Prompt: "Replace the queue?" | same |

### 6.2 Advancement

On `ended`: `nextUp.shift()` → else `context.shift()` (or the next in shuffle order) → else
repeat-all wraps → else stop. The previous `now` goes into `history`.

### 6.3 Spotify queue mirror

The Queue sheet for Spotify renders `GET /me/player/queue` (refreshed on open and on each track
change), read-only, with "Queue managed by Spotify. Items can be added but not reordered."
**As built (M7):** the sheet mirrors the SDK state's `next_tracks` (the next two), refreshed on
every state change; the full `GET /me/player/queue` read is a follow-up. Spotify queues are not
saved to `/me/queue` (Spotify keeps its own across devices).

---

## 7. Track state and timing

`PlaybackState` and the song clock are defined in `TECHNICAL_ARCHITECTURE.md` §5. Provider-specific
inputs:

| | Navidrome | Spotify |
|---|---|---|
| Position source | `audio.currentTime` every frame | SDK state events + 1 s polling |
| Latency correction | `outputLatency` (or `baseLatency`) | none observable. User offset only. |
| Buffering signal | `waiting`/`stalled` → `buffering` | `loading` in state (when present) |
| Duration | Subsonic `duration` (s), refined by `audio.duration` | `duration_ms` |

---

## 8. Errors and reconnection

| Situation | Detection | Behaviour |
|---|---|---|
| Navidrome unreachable (idle) | health `ping` every 30 s while ECHO is visible | Status pill "Navidrome unreachable". Backoff 1, 2, 4, 8, 16, 30 s (cap), ±20% jitter. Library shows cached data with a freshness note. |
| Stream error mid-track | `audio` `error`/`stalled` > 8 s | Reload the source at the current position (Range or `timeOffset`), up to 3 attempts. Then skip to next with a toast "Couldn't play ‘Title’. Skipped." |
| Navidrome auth rejected | Subsonic code 40/41/44 | Stop retries. Settings row shows "Credentials rejected". Dock: "Reconnect Navidrome" link. |
| Spotify device `not_ready` | SDK event | "Reconnecting to Spotify…" with backoff on `connect()`. After 60 s, offer "Retry". |
| Spotify `authentication_error` / 401 | event / HTTP | Server refresh once. On failure → "Spotify sign-in expired" + Reconnect (refresh tokens last ~6 months [C]). |
| Spotify `account_error` | event | "Spotify playback needs Premium." Spotify disabled until reconnect. |
| Spotify 403 on Web API | HTTP | If the app is in Development Mode and the user isn't allow-listed: "Add this Spotify account to your app's user list in the Spotify Developer Dashboard." Any other reason Spotify gives (for example the app owner's Premium has lapsed) is shown in its own words: "Spotify refused ECHO: …". |
| Widevine missing | `requestMediaKeySystemAccess` rejection | Browser-specific guidance (`TECHNICAL_ARCHITECTURE.md` §2.2) |
| Spotify 429 | HTTP | Short `Retry-After`: wait once. Long, repeated or `QUOTA_EXCEEDED`: stop calling for that long and say so ("Spotify is limiting this app and asks ECHO to wait 19 hours" / "…quota is used up"). §4.5. |
| ECHO server unreachable (client still open) | fetch failures to `/api/v1/*` | Dock status "Can't reach the ECHO server · retrying", backoff as above. Navidrome audio already buffered keeps playing. Spotify keeps playing (the SDK talks to Spotify directly) until the access token expires. |
| Session expired or revoked | 401 from `/api/v1/*` | Playback stops after the current track. Login sheet over the current screen, which returns to it after login. |

---

## 9. Provider differences (summary)

| Capability | Navidrome | Spotify |
|---|---|---|
| Audio-reactive visuals | ✅ Reverb | ❌ Ambient only |
| Art-derived palette | ✅ | ✅ (gate G1, on by owner decision) |
| Word/line-synced lyrics | ✅ | ✅ (gate G2, on by owner decision) |
| Seek | ✅ raw; transcode needs `transcodeOffset` | ✅ |
| Queue reorder/remove/clear | ✅ | ❌ (add only) |
| Crossfade / gapless | ✅ / ✅ | ❌ / Spotify's own |
| Library | full | playlists the user owns, saved albums, search ≤ 10/page |
| Offline (server on LAN, no internet) | ✅ | ❌ |
| Attribution | none required | logo + link back + art/metadata always visible |

---

## 10. Media Session

`navigator.mediaSession.metadata` (title, artist, album, artwork 96/256/512) and action handlers
(`play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward`). The
position state is updated on each anchor. This gives OS media keys and system "now playing" for free.
