# YouTube Music mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Navidrome | YouTube Music switch that turns ECHO's web client into a YouTube Music app (search, Home, Explore, Library, pages, its own player), with audio fetched by yt-dlp and streamed through ECHO like a Navidrome song.

**Architecture:**
- **Server side:** a new `src/server/youtube/` module has three parts. A *catalogue* maps youtubei.js (InnerTube, YouTube Music's own API) into ECHO's shapes. A *resolver* runs yt-dlp (anonymous, cached, at most 2 at a time) to get each song's audio URL. The *routes* serve the browsing, a Range-translating audio proxy and an image proxy.
- **Client side:** YouTube songs are ordinary `Track`s with `provider: 'youtube'`, played by the existing `<audio>` provider through `/api/v1/youtube/stream/:id`. YouTube mode is a separate React frame (`src/client/youtube/`), chosen by a `{ view: 'yt' }` route.
- **Dev and e2e:** these use a fake catalogue and resolver (`ECHO_DEV_FIXTURES=1`); no test talks to YouTube.

**Tech Stack:** Hono 4 + Node 24 (server), React 19 + zustand (client), better-sqlite3, youtubei.js 18.3.0 (new, exact pin), the yt-dlp standalone binary, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-youtube-music-design.md` (approved 2026-11-03; the calls are numbered there).

## Global Constraints

- **Dependency:** `youtubei.js` pinned exactly `"18.3.0"` in `dependencies`. No other new runtime dependency.
  - Create it as `Innertube.create({ retrieve_player: false, generate_session_locally: true, cookie?, fetch? })`.
- **yt-dlp command line**, always:
  `--no-config --no-playlist --js-runtimes node:<process.execPath> -f 140/bestaudio[ext=m4a] -j <https://music.youtube.com/watch?v=ID>`.
  - Never pass cookies to yt-dlp (spec call 4).
- **Resolving audio:**
  - At most **2** yt-dlp processes at once.
  - Concurrent requests for the same id share one process.
  - A resolved URL is reused until **30 min** before its `expire=` query parameter.
- **Upstream requests to googlevideo:**
  - Never forward the browser's `Range` header. Send `&range=<start>-<end>`.
  - Each upstream request covers at most **10 485 760** bytes. The browser gets **206** with `Content-Range`.
- **The cookie:**
  - It is sealed with `sealer.seal(cookie, { table: 'youtube_accounts', rowId: userId, column: 'cookie_enc' })`.
  - It is never returned, never logged (`sealer.open` already feeds the redactor), and only ever sent to `music.youtube.com`.
- **Signed out:** a YouTube call that needs sign-in, or whose cookie went stale, answers **409** `{ code: 'youtube.signed_out' }`. Never 401: 401 means the ECHO session ended.
- **Off:** with the admin switch `youtube.enabled` off (default **on**), every `/api/v1/youtube/*` route answers **404** `{ code: 'youtube.disabled' }`.
- **CSP unchanged:** `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self'`.
  - Images go through `/api/v1/youtube/image?u=` with the host allowlist `lh3.googleusercontent.com`, `yt3.ggpht.com`, `yt3.googleusercontent.com`, `i.ytimg.com` (https only).
- **Mode:** per device, in localStorage key `echo.mode` (`'navidrome' | 'youtube'`). Every access is wrapped in try/catch.
- **Look** (mockup board A, https://claude.ai/artifact/8yTf8MWLVBU9TQqsDvfcWm):
  - colours: ground `#030303`, raised `#212121`, hover/chip `#ffffff1a`, text `#ffffff`, secondary `#aaaaaa`, accent `#ff0033` (the progress line only);
  - font: Roboto 400/500/700, self-hosted woff2;
  - wordmark: "ECHO", never YouTube's logo;
  - no `backdrop-filter`, no live blur.
- **Copy:** "YouTube Music" (two words, both capitalised). Toasts and messages live in `src/client/strings.ts` under `youtube`.
- **Every new `/api/v1` route** goes into `docs/api/openapi.yaml` in the same task (`src/server/openapi.test.ts` fails otherwise).
- **Untouched:** Android, and Navidrome mode's behaviour. All existing unit and e2e tests stay green.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `pnpm typecheck && pnpm lint && pnpm test` before each commit.

## Review Focus

1. **A stale cookie** (Google rotated it).
   - Expected: Home and Library show "Sign in to YouTube Music again" with a link to Settings, never a blank page or an ECHO sign-out.
   - Pinned in Task 5 (`signed-out maps to 409`) and Task 8 (e2e `stale cookie`).
2. **A song that cannot be fetched** (age-restricted, removed, bot check).
   - Expected: a toast, the player skips to the next song, and the admin page shows the last yt-dlp error.
   - Pinned in Task 1 (`youtube.stream skips`) and Task 3 (`failed resolve is not cached`).
3. **Resuming after a long pause, once the resolved URL has expired** (googlevideo answers 403).
   - Expected: the proxy resolves again once and the song carries on.
   - Pinned in Task 4 (`re-resolves once on upstream 403`).
4. **Pressing Next five times quickly.**
   - Expected: identical ids share one yt-dlp, never more than 2 run, and the last song pressed plays.
   - Pinned in Task 3 (`dedupes and caps concurrency`).
5. **Long mixes, an hour long (~60 MB), and seeking deep into them.**
   - Expected: every upstream request is 10 MiB or less, and a seek to byte 50 000 000 answers `206 bytes 50000000-60485759/<size>`.
   - Pinned in Task 4 (`caps each upstream range`).

---

### Task 1: YouTube tracks ride the existing player

**Files:**
- Modify: `src/shared/types.ts` (ProviderId, PlaybackProvider)
- Modify: `src/client/playback/controller.ts` (`playList`, `enqueue`, `wrap`, `onError`)
- Modify: `src/client/playback/navidrome.ts` (`srcFor`, `scrobble`, gain)
- Modify: `src/client/strings.ts` (a new `youtube` block, starting with `unplayable: 'This song can’t play from YouTube.'`)
- Test: `src/client/playback/playback.test.ts`, `src/client/playback/navidrome.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = 'navidrome' | 'youtube'`.
  - `PlaybackProvider.sources?: readonly ProviderId[]`: what it can play; absent means `[id]`.
  - `NavidromeProvider.sources = ['navidrome', 'youtube']`.
  - The stream URL of a YouTube track is `/api/v1/youtube/stream/${encodeURIComponent(track.id)}`.
  - The "played" ping is `POST /api/v1/youtube/played/:videoId`, made in place of the Navidrome scrobble.
  - The AppError code for a failed YouTube stream is `'youtube.stream'`.

- [ ] **Step 1: Write the failing tests**
  - In `playback.test.ts`:
    - `plays a youtube list on a provider that lists youtube`: the fake provider has `sources: ['navidrome','youtube']`. `playList([ytTrack('a'), ytTrack('b')], 0, ctx)` → `queue.getState().now.key === 'youtube:a'` and `queue.getState().provider === 'youtube'`.
    - `refuses youtube on a provider without it`: the same with `sources` absent → `now` stays null.
    - `youtube.stream skips`: emit `{ code: 'youtube.stream', … }` while the queue has a next track → that track loads, and notify got `strings.dock.skipped`.
  - In `navidrome.test.ts`:
    - `streams youtube tracks through the youtube route`: after `load(ytTrack('x'))` the element's `src` ends with `/api/v1/youtube/stream/x`.
    - `pings youtube history, never the Navidrome scrobble`: past half the track, the fake `api` saw `POST /youtube/played/x` once and no `/navidrome/rest/scrobble`.
- [ ] **Step 2: Run them:** `pnpm vitest run src/client/playback`. Expected: these 5 fail.
- [ ] **Step 3: Implement.**
  - Controller: a `plays(t) = (provider.sources ?? [provider.id]).includes(t.provider)` check replaces `tracks[0]?.provider !== provider.id`. `startContext`, `wrap` and `enqueue` take the provider from the tracks (`tracks[index].provider`, `cued.now.provider`).
  - `onError` skips on `navidrome.stream` or `youtube.stream`.
  - The provider:
    - YouTube tracks get no ReplayGain (`setReplayGain(undefined)`) and play raw (no transcode, native Range seeking).
    - The scrobble branch fires the YouTube "played" ping once, at the existing "now playing" moment.
    - Its stream error uses `youtube.stream` with `userMessage: strings.youtube.unplayable`.
- [ ] **Step 4: Run** `pnpm vitest run src/client/playback`. Expected: all pass.
- [ ] **Step 5: Commit** `Web: the player plays YouTube tracks through ECHO's proxy`.

### Task 2: Storage — YouTube accounts and the web-only queue slot

**Files:**
- Modify: `src/server/db/db.ts` (append one migration)
- Modify: `src/server/queue.ts`, `src/client/playback/queueSync.ts`
- Modify: `docs/api/openapi.yaml`
- Test: `src/server/db/db.test.ts`, `src/server/queue.test.ts`, `src/client/playback/queueSync.test.ts`

**Interfaces:**
- Produces:
  - Table `youtube_accounts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, cookie_enc TEXT NOT NULL, name TEXT NOT NULL, updated_at INTEGER NOT NULL)`.
  - Table `queue_state_youtube` with the same columns as `queue_state`.
  - Routes `GET|PUT /me/queue/youtube`, with the same bodies and compare-and-set as `/me/queue`.
  - Client: `queueSlot(q: QueueState): '/me/queue' | '/me/queue/youtube'`. It returns the youtube slot when `now`, `nextUp`, `context` or `history` holds any `provider === 'youtube'` track.

- [ ] **Step 1: Write the failing tests**
  - `db.test.ts`: `creates youtube_accounts and queue_state_youtube`. A fresh DB has both tables; `SCHEMA_VERSION` went up by 1.
  - `queue.test.ts`: `keeps the youtube slot apart`. A PUT to `/me/queue/youtube` leaves `GET /me/queue` unchanged, and a stale `baseUpdatedAt` there gets 409.
  - `queueSync.test.ts`:
    - `queueSlot picks youtube for any youtube track`: three cases (all-Navidrome → `/me/queue`; one YouTube track in `nextUp` → youtube; YouTube `now` → youtube).
    - `restores the newer of the two slots`: the two GETs answer `updatedAt` 5 and 9 → `restore` gets the 9 one.
- [ ] **Step 2: Run** `pnpm vitest run src/server/db src/server/queue src/client/playback/queueSync`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - The migration appends one SQL string.
  - `queueRoutes` registers both paths from one handler pair parameterised by table name.
  - `startQueueSync`:
    - It reads both slots at start and restores the newer.
    - It saves to `queueSlot(queue)` and keeps a separate `base` for each slot.
    - A 409 refetches the same slot.
  - Document both new routes in `openapi.yaml`.
- [ ] **Step 4: Run** the same command plus `pnpm vitest run src/server/openapi src/server/contract`. Expected: all pass.
- [ ] **Step 5: Commit** `Server: YouTube accounts and a web-only queue slot`.

### Task 3: The yt-dlp resolver and updater

**Files:**
- Create: `src/server/youtube/ytdlp.ts`
- Create: `scripts/fake-yt-dlp.ts` (a test double: `#!/usr/bin/env node`, executable)
- Test: `src/server/youtube/ytdlp.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Resolved { url: string; size: number; expiresAt: number }
export interface YtdlpStatus { version: string | null; updatedAt: number | null; lastError: string | null }
export interface Resolver {
  resolve(videoId: string): Promise<Resolved>;   // rejects with YtAudioError
  forget(videoId: string): void;                  // drop the cached URL (after an upstream 403)
  status(): YtdlpStatus;
}
export class YtAudioError extends Error { code: 'youtube.unavailable' | 'youtube.bot_check' | 'youtube.failed' }
export function createYtdlpResolver(opts: {
  bin: string; now: () => number; log: Log;
  run?: (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}): Resolver;
/** Copies `bundled` to `<dataDir>/bin/yt-dlp` when missing (0755); returns that path. */
export function ensureBinary(bundled: string, dataDir: string): string;
/** Runs `<bin> -U`; records version/updatedAt/lastError into the resolver's status. */
export function updateYtdlp(bin: string, r: Resolver, run?: …): Promise<void>;
export const VIDEO_ID: RegExp; // /^[\w-]{11}$/
```
- Parsing the `-j` output:
  - `url` and `filesize` come from the JSON top level (or `requested_downloads[0]`, whichever is present).
  - `expiresAt` = `Number(new URL(url).searchParams.get('expire')) * 1000`.
- Mapping stderr to error codes:
  - `/Sign in to confirm/` → `youtube.bot_check`;
  - `/unavailable|age|private|removed/i` → `youtube.unavailable`;
  - anything else → `youtube.failed`.

- [ ] **Step 1: Write the failing tests** (with a fake `run`):
  - `resolves url, size and expiry`.
  - `rejects a bad video id without running yt-dlp`.
  - `dedupes and caps concurrency`: 5 calls for 4 ids (two the same). At most 2 `run`s are in flight at any time; `run` is called 4 times.
  - `reuses until 30 min before expiry`: `now` moves to `expiresAt - 31 min` → no new run; to `expiresAt - 29 min` → a new run.
  - `failed resolve is not cached`: the first run exits 1 with "Sign in to confirm" → rejects `youtube.bot_check`; the next call runs again; `status().lastError` holds the message.
  - `never passes cookies`: no argument matches `/cookie/i`; the args equal the Global Constraints line.
  - `ensureBinary copies once`: a temp dir; the second call doesn't copy.
- [ ] **Step 2: Run** `pnpm vitest run src/server/youtube/ytdlp`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** with `node:child_process.execFile`.
  - Timeout 30 s.
  - The environment is `TMPDIR` set to `<dataDir>/tmp`, created on start, because the distroless image may have no writable /tmp.
  - Cache: a `Map<string, Resolved | Promise<Resolved>>` with at most 500 entries, dropping the oldest.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Server: yt-dlp resolver, cached and capped, with a self-updating binary`.

### Task 4: The audio and image proxies

**Files:**
- Create: `src/server/youtube/proxy.ts`
- Modify: `src/server/navidrome/mock.ts` (add `/videoplayback`, like googlevideo)
- Test: `src/server/youtube/proxy.test.ts`

**Interfaces:**
- Consumes: `Resolver` (Task 3).
- Produces:
```ts
export const CHUNK = 10_485_760;
/** The byte window to fetch for a browser Range header (absent → from 0). Null when unsatisfiable. */
export function byteWindow(range: string | undefined, size: number): { start: number; end: number } | null;
export function streamAudio(c: Context, videoId: string, r: Resolver, fetchImpl?: typeof fetch): Promise<Response>;
export const IMAGE_HOSTS: readonly string[];
export function proxyImage(c: Context, u: string, fetchImpl?: typeof fetch): Promise<Response>;
```
- **What `streamAudio` answers:**
  - **206** with `content-type: audio/mp4`, `accept-ranges: bytes`, `content-range: bytes s-e/size`, `content-length`, `cache-control: private, no-store` and `content-security-policy: sandbox; default-src 'none'`.
  - **416** when the window is unsatisfiable.
  - **502** `{ code }` on a `YtAudioError`.
  - On an upstream **403**: `r.forget(id)`, resolve again, retry **once**.
- **What `proxyImage` does:**
  - It allows https URLs on `IMAGE_HOSTS` only (otherwise **400**) and raster `content-type`s only.
  - It sends no cookie and no referer.
  - `cache-control: private, max-age=604800`.
- **The mock's `/videoplayback?id=&range=a-b`:**
  - It serves bytes of the fixture WAV under `content-type: audio/mp4`. (WAV bytes play in `<audio>` whatever the declared type; the e2e only needs playback to move.)
  - It answers **403** whenever a `Range` header is present.

- [ ] **Step 1: Write the failing tests** (upstream = a local `http.createServer`):
  - `byteWindow` cases: `undefined → 0..min(size,CHUNK)-1`; `bytes=100-` → 100..; `bytes=100-199` → 100..199; a start ≥ size → null.
  - `caps each upstream range`: size 60 485 760 and `bytes=50000000-` → upstream saw `range=50000000-60485759` and no `Range` header; the response is 206 `bytes 50000000-60485759/60485760`.
  - `re-resolves once on upstream 403`: the first upstream answers 403, the second 200 → 206, and `resolve` was called twice. Two 403s in a row → 502.
  - `answers 502 with the resolver's code`.
  - `refuses image hosts off the list`: `http://lh3…` (not https), `https://evil.example/x.jpg`, `https://lh3.googleusercontent.com.evil.example/` → 400.
  - `passes raster images only`: an upstream `text/html` → 502.
- [ ] **Step 2: Run** `pnpm vitest run src/server/youtube/proxy`. Expected: FAIL.
- [ ] **Step 3: Implement** with `fetch(url + '&range=s-e', { redirect: 'follow' })`, streaming `res.body` straight through. The upstream `range` covers exactly the response window, so no byte counting is needed.
- [ ] **Step 4: Run** the tests plus `pnpm vitest run src/server/navidrome`. Expected: PASS.
- [ ] **Step 5: Commit** `Server: YouTube audio and image proxies (range translation, host allowlist)`.

### Task 5: The catalogue (youtubei.js → ECHO shapes) and its fake

**Files:**
- Create: `src/shared/youtube.ts`
- Create: `src/server/youtube/catalogue.ts`
- Create: `src/server/youtube/fake.ts`
- Create: `src/server/youtube/fixtures/*.json` (recorded InnerTube responses: search songs, search all, album, artist, playlist, next/up-next, browse home, lyrics, suggestions)
- Modify: `package.json` / `pnpm-lock.yaml` (`youtubei.js` 18.3.0)
- Test: `src/server/youtube/catalogue.test.ts`

**Interfaces:**
- Produces (shared, used by the client in Tasks 7–9):
```ts
export type YtKind = 'song' | 'video' | 'album' | 'playlist' | 'artist';
export interface YtItem { kind: YtKind; id: string; title: string; subtitle: string; thumb: string; track?: Track }
export interface YtShelf { title: string; strapline?: string; layout: 'rows' | 'cards'; items: YtItem[]; more?: { kind: 'playlist' | 'artist'; id: string } }
export interface YtPage { title: string; subtitle?: string; description?: string; thumb?: string; kind?: YtKind; id?: string; tracks?: Track[]; shelves: YtShelf[] }
export const YT_TABS: readonly ['all', 'songs', 'albums', 'artists', 'playlists'];
export type YtTab = (typeof YT_TABS)[number];
export interface YtUpNext { tracks: Track[] }
export interface YtLyrics { text: string; source: string }
```
- Produces (server):
```ts
export class YtSignedOut extends Error {}
export interface Catalogue {
  account(): Promise<{ name: string }>;             // throws YtSignedOut when the cookie is not signed in
  home(): Promise<YtPage>; explore(): Promise<YtPage>; library(): Promise<YtPage>;  // library throws YtSignedOut when anonymous
  search(q: string, tab: YtTab): Promise<YtPage>; suggest(q: string): Promise<string[]>;
  album(id: string): Promise<YtPage>; artist(id: string): Promise<YtPage>; playlist(id: string): Promise<YtPage>;
  upNext(videoId: string): Promise<YtUpNext>; related(videoId: string): Promise<YtPage>;
  lyrics(videoId: string): Promise<YtLyrics | null>;
  like(videoId: string, on: boolean): Promise<void>; played(videoId: string): Promise<void>;
}
export function createCatalogue(opts: { cookie?: string; fetch?: typeof fetch; lang?: string; region?: string }): Catalogue;
export function createFakeCatalogue(opts: { signedIn: boolean; audioBase: string }): Catalogue & { resolver: Resolver };
export const ytTrack: (p: { id: string; title: string; artists: {id?: string; name: string}[]; album?: {id?: string; title: string}; durationMs: number; thumb: string }) => Track;
```
- **Shapes:**
  - A YouTube `Track` is `key: 'youtube:'+id`, `provider: 'youtube'`, `album.key: 'youtube:' + (album.id ?? id)`, `artwork: [{ url: thumb }]`.
  - Every `thumb` is `/api/v1/youtube/image?u=<encoded>`, taken from the largest thumbnail. A `lh3…=wNN-hNN…` URL is rewritten to `=w544-h544-l90-rj`.
  - `lang` is `en` and `region` is `SE` (the owner's).
- **The fake** returns 3 Home shelves (`Quick picks` as rows, `Listen again` and `Mixed for you` as cards) built from 12 songs, 3 albums, 2 artists and 2 playlists.
  - Search filters them by title.
  - `account()` returns `{ name: 'Fixture Listener' }` when `signedIn`.
  - Its resolver answers `audioBase + '/videoplayback?id=<id>&expire=<now/1000+21600>'`, size = the WAV size.
  - The song id `fakeunavail` rejects with `youtube.unavailable`.

- [ ] **Step 1: Record the fixtures.**
  - Use a one-off script in the scratchpad that wraps `fetch`, writing each InnerTube request path, its `browseId`/`query`/`videoId` and the response JSON to `src/server/youtube/fixtures/<name>.json`.
  - Run it once against the live API, anonymously, for: "bohemian rhapsody" (songs and all), album `MPREb_…` from that search, artist `UC…`, a playlist `VL…`, up next for `fJ9rUzIMcZQ`, the home feed, lyrics and suggestions.
  - Commit only those files.
- [ ] **Step 2: Write the failing tests** (`createCatalogue({ fetch: replay(fixtures) })`, where `replay` answers each request from the recorded file whose key matches):
  - `maps song search`: the first shelf's first item has `kind: 'song'`, an 11-character id, a title, `track.durationMs > 0`, and a `thumb` starting with `/api/v1/youtube/image?u=https%3A%2F%2F`.
  - `maps an album page`: `tracks.length > 0`, and every track's `album.id` is the album id.
  - `maps the home feed`: at least one shelf; `Quick picks` has `layout: 'rows'`.
  - `maps up next`: `tracks.length >= 20`, and the first is the seed.
  - `maps lyrics`: the text starts with "Is this the real life".
  - `library without a cookie throws YtSignedOut`.
  - `the fake answers every Catalogue method` (a smoke test over all methods).
- [ ] **Step 3: Run** `pnpm vitest run src/server/youtube/catalogue`. Expected: FAIL.
- [ ] **Step 4: Implement** the mapping (`MusicResponsiveListItem` → rows, `MusicTwoRowItem` → cards).
  - `like` uses `yt.interact.like`/`removeRating`.
  - `played` uses `(await yt.music.getInfo(id)).addToWatchHistory()`.
  - `account` uses `yt.account.getInfo()`.
  - A logged-out answer to an authenticated call throws `YtSignedOut`.
  - When a renderer type is unknown, skip it; never throw.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `Server: YouTube Music catalogue over youtubei.js, with recorded fixtures and a fake`.

### Task 6: YouTube routes, the admin switch, the session flag and wiring

**Files:**
- Create: `src/server/youtube/routes.ts`
- Modify: `src/server/index.ts` (deps, routes, daily update, `ensureBinary`)
- Modify: `src/server/config.ts` (`ytdlpBundled: string`, from `ECHO_YTDLP` or `/app/bin/yt-dlp`)
- Modify: `src/server/admin.ts` (`youtube.enabled`; the `GET /admin/youtube` status)
- Modify: `src/server/auth/routes.ts` (`/session` + `youtube`)
- Modify: `src/server/testing.ts`
- Modify: `docs/api/openapi.yaml`
- Test: `src/server/youtube/routes.test.ts`, `src/server/admin.test.ts`, `src/server/contract.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces (all under `/api/v1`, all `requireUser`: the session cookie, no signed URLs):
  - The account:
    - `GET /me/connections/youtube` → `{ connected: boolean; name?: string; needsReentry?: boolean }`.
    - `PUT /me/connections/youtube` with `{ cookie: string }` → `{ name }`. It answers 400 `youtube.input` if the cookie lacks `SAPISID=` or `__Secure-3PAPISID=`, and 400 `youtube.signed_out` if `account()` fails. Nothing is stored on failure, and an audit row `youtube.connected` is written.
    - `DELETE /me/connections/youtube`.
  - Browsing: `GET /youtube/home|explore|library` → `YtPage`; `GET /youtube/search?q=&tab=` → `YtPage`; `GET /youtube/suggest?q=` → `{ items: string[] }`; `GET /youtube/album/:id|artist/:id|playlist/:id` → `YtPage`; `GET /youtube/up-next/:videoId` → `YtUpNext`; `GET /youtube/related/:videoId` → `YtPage`; `GET /youtube/lyrics/:videoId` → `YtLyrics`, or 404.
  - Actions: `PUT /youtube/like/:videoId` with `{ like: boolean }` (409 when signed out); `POST /youtube/played/:videoId` (204; a no-op when signed out); `POST /youtube/prepare` with `{ ids: string[] }` (at most 3, resolved in the background, 202).
  - Media: `GET /youtube/stream/:videoId`, and `GET /youtube/image?u=`.
  - Admin: `GET /admin/youtube` → `YtdlpStatus`. `PUT /admin/settings` accepts `{ youtube: { enabled: boolean } }`, and `GET` returns it.
  - `/session` adds `youtube: { enabled: boolean; signedIn: boolean }`.
- **Wiring:**
  - Each user's catalogue is cached per user and dropped on PUT/DELETE: `catalogueFor(userId)`, anonymous when there's no row.
  - IDs are checked: `VIDEO_ID` for videos, and `/^[\w-]{2,64}$/` for browse and playlist ids.
  - With `devFixtures`, the server uses `createFakeCatalogue` (signed in once a cookie is saved) and its resolver, with `audioBase = config.navidromeUrl`.
  - Otherwise it uses `ensureBinary`, `createYtdlpResolver`, and `updateYtdlp` 2 min after start, then every 24 h. Updates never block start-up and failures are logged.

- [ ] **Step 1: Write the failing tests** (in `routes.test.ts`, with the fake catalogue):
  - `saves a cookie only after it signs in`: the bad shape → 400; good → 200 `{ name: 'Fixture Listener' }`. The DB `cookie_enc` doesn't contain the cookie text, and a GET never returns it.
  - `signed-out maps to 409`: `GET /youtube/library` with no account → 409 `youtube.signed_out`.
  - `checks ids`: `/youtube/album/..%2Fx` → 400; `/youtube/stream/short` → 400.
  - `admin switch hides everything`: `youtube.enabled=false` → `/youtube/home` 404 `youtube.disabled`, and `/session` says `enabled: false`.
  - `prepare resolves in the background`: 202, then the resolver saw the ids, at most 3 of them.
  - In `admin.test.ts`: `youtube.enabled round-trips and rejects non-booleans`.
  - In `contract.test.ts`: add the GETs of `/session`, `/me/connections/youtube` and `/youtube/home` to the sweep.
- [ ] **Step 2: Run** `pnpm vitest run src/server`. Expected: the new tests fail.
- [ ] **Step 3: Implement**, and document every route and schema in `openapi.yaml`.
- [ ] **Step 4: Run** `pnpm vitest run src/server`. Expected: PASS, including `openapi.test.ts`.
- [ ] **Step 5: Commit** `Server: YouTube Music routes, admin switch and session flag`.

### Task 7: Client plumbing — routes, the switch, Settings and Admin

**Files:**
- Modify: `src/client/view.ts` (the `yt` route)
- Create: `src/client/youtube/mode.ts`, `src/client/youtube/api.ts`, `src/client/youtube/Connection.tsx`
- Modify: `src/client/session.ts` (`youtube` on signedIn)
- Modify: `src/client/main.tsx`
- Modify: `src/client/shell/Shell.tsx` (`TopBar` gets `<ModeSwitch/>`), `src/client/shell/AccountMenu.tsx` (on phones: "YouTube Music" / "Navidrome" item)
- Modify: `src/client/shell/AuthViews.tsx` (`AccountSection` renders `<YouTubeConnection/>`), `src/client/shell/AdminViews.tsx` (the switch + yt-dlp status)
- Modify: `src/client/shell/Dock.tsx` (YouTube tracks: no artist/album links, no heart). Their palette request (`youtube:` album key) gets the server's default palette, so the Stage needs no change: check it in the e2e and don't add server palette code for it
- Modify: `src/client/strings.ts` (the rest of the `youtube` block)
- Test: `src/client/view.test.ts`, `src/client/youtube/mode.test.ts`

**Interfaces:**
- Produces:
```ts
// view.ts
export type YtRoute =
  | { kind: 'home' } | { kind: 'explore' } | { kind: 'library' }
  | { kind: 'search'; q: string; tab: YtTab }
  | { kind: 'album' | 'artist' | 'playlist'; id: string };
// Route gains: | { view: 'yt'; page: YtRoute }
// paths: /yt  /yt/explore  /yt/library  /yt/search?q=&tab=  (tab 'all' omitted)  /yt/album/:id  /yt/artist/:id  /yt/playlist/:id
// mode.ts
export type Mode = 'navidrome' | 'youtube';
export function savedMode(): Mode;                       // 'navidrome' when unset or storage throws
export function switchMode(to: Mode, navigate: ViewState['navigate']): void; // saves; youtube → {view:'yt',page:{kind:'home'}}, navidrome → {view:'home'}
export function ModeSwitch(): JSX.Element | null;         // null unless session.youtube.enabled
// api.ts: thin typed wrappers, e.g. ytPage(path: string): Promise<YtPage>, ytSuggest(q), ytLike(id, on), ytPrepare(ids)
```
- **`main.tsx` changes:**
  - The provider is created for any signed-in session (not only `ownLibrary`).
  - The lyrics loader runs for any signed-in session.
  - At start, `route.view === 'home' && savedMode() === 'youtube' && session.youtube.enabled` → replace with yt home.
  - `<Shell>` renders `<YtFrame>` (Task 8) when `route.view === 'yt'`. That keeps the context providers, so the controller and the queue are shared.

- [ ] **Step 1: Write the failing tests**
  - `view.test.ts`: `parses and formats yt routes`, a round trip for every path above, including `/yt/search?q=a%20b&tab=songs`. `/yt/search?tab=nope` falls back to `all`, and `/yt/album/` → notFound.
  - `mode.test.ts`:
    - `savedMode defaults to navidrome when storage throws`.
    - `switchMode saves and navigates`.
- [ ] **Step 2: Run** `pnpm vitest run src/client/view src/client/youtube`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The switch is a two-button group (`role="group"`, `aria-pressed`), styled in each frame's own look.
  - The Settings card (`YouTubeConnection`):
    - The steps to copy the Cookie header (open music.youtube.com signed in → DevTools → Network → filter `browse` → copy the `Cookie` request header).
    - A `<textarea>` with a `<label>`, then Save. The account name shows when signed in, with a Sign out button.
    - The card says plainly that the cookie is stored encrypted and is used only for browsing, never for downloading audio.
  - Admin gets a Switch "YouTube Music for everyone", plus yt-dlp's version, last update and last error.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm vitest run src/client`. Expected: PASS.
- [ ] **Step 5: Commit** `Web: YouTube Music switch, route, sign-in card and admin switch`.

### Task 8: The YouTube Music frame and its pages

**Files:**
- Create: `src/client/youtube/YtFrame.tsx` (top bar, left nav / bottom tabs, main, player-bar slot)
- Create: `src/client/youtube/pages.tsx` (Home, Explore, Library, Search, Album, Artist, Playlist)
- Create: `src/client/youtube/parts.tsx` (`Shelf`, `Card`, `Row`, `Chips`, `SignInPrompt`, a `Search` with suggestions)
- Create: `src/client/youtube/yt.css` (scoped under `.yt`)
- Create: `src/client/fonts/roboto-{400,500,700}.woff2`, `src/client/fonts/OFL-Roboto.txt`
- Modify: `src/client/fonts.css`
- Test: `tests/e2e/youtube.spec.ts` (navigation)

**Interfaces:**
- Consumes: `YtPage`/`YtShelf`/`YtItem` (Task 5), `YtRoute`/`ModeSwitch`/the api wrappers (Task 7), `PlaybackContext` (the existing one).
- Produces:
  - `YtFrame({ route }: { route: Extract<Route, { view: 'yt' }> })`.
  - `playItem(c: PlaybackController, item: YtItem, list?: Track[])`. It implements spec call 15:
    - a song or video with no `list` → `GET up-next` → `playList(upNext.tracks, 0, { kind: 'radio', id, title: strings.radio.title(item.title) })`;
    - with a `list` (an album, playlist or Liked music page) → `playList(list, indexOf(item), { kind: 'album' | 'playlist', id, title })`.
- **Layout:**
  - Desktop (wider than 1024 px): a 240 px left nav (Home, Explore, Library), a 64 px top bar, and the full-width player bar.
  - Compact (the existing `useCompact()`): bottom tabs (Home, Explore, Library) and the mini player above them; the switch moves into the account menu.
- **The rest of the behaviour:**
  - Cards link to their pages, rows play.
  - Shelves with `layout: 'cards'` scroll sideways on phones (CSS `overflow-x: auto; scroll-snap-type: x`).
  - Signed out, Home is the general feed; Library and likes show `SignInPrompt` (→ Settings → Account). A 409 `youtube.signed_out` with a saved account shows "Sign in to YouTube Music again".
  - Loading uses the existing skeleton styles; errors use `BlockError`.

- [ ] **Step 1: Get Roboto.**
  - Download the latin woff2 files for 400, 500 and 700 from `fonts.googleapis.com/css2?family=Roboto:wght@400;500;700` (fetched with a woff2-capable User-Agent), plus the OFL text.
  - Add the `@font-face` rules beside Selawik's.
- [ ] **Step 2: Write the failing e2e tests** (`tests/e2e/youtube.spec.ts`; dev fixtures = the fake catalogue):
  - `the switch opens YouTube Music and remembers it`: sign in, click "YouTube Music" → URL `/yt`, and the "Quick picks" heading is visible. Reload `/` → back at `/yt`.
  - `search shows suggestions and songs`: type in search → a suggestion list appears; Enter → `/yt/search?q=…` and a Songs shelf is visible. The "Songs" tab → `tab=songs`.
  - `album page lists its songs`.
  - `library asks to sign in when signed out`.
  - `stale cookie`: the fake set to signed-out after a saved account → the "Sign in to YouTube Music again" text is visible.
  - `phone layout has bottom tabs`: viewport 390×844 → a tab bar with Home, Explore and Library.
  - `no CSP violations` is covered by the existing csp spec. Also add `/yt` and `/yt/search?q=a` to its page list.
- [ ] **Step 3: Run** `pnpm test:e2e tests/e2e/youtube.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 4: Implement** the frame, pages and CSS (mockup board A's values; Global Constraints colours).
- [ ] **Step 5: Run** the same command, then `--project=firefox`. Expected: PASS on both.
- [ ] **Step 6: Commit** `Web: YouTube Music frame, pages and Roboto`.

### Task 9: Player bar, full-screen player, radio and prepare-ahead

**Files:**
- Create: `src/client/youtube/PlayerBar.tsx`, `src/client/youtube/NowPlaying.tsx`, `src/client/youtube/radio.ts`
- Modify: `src/client/shell/radio.ts` (`startAutoplay` hands YouTube tracks to `ytAutoplay`)
- Modify: `src/client/main.tsx` (start `startYtPrepare`)
- Test: `src/client/youtube/radio.test.ts`, `tests/e2e/youtube.spec.ts` (playback)

**Interfaces:**
- Consumes: the `PlaybackController`, `lyricsStore` (`src/client/stage/status.ts`), the api wrappers.
- Produces:
```ts
export function startYtPrepare(c: PlaybackController): () => void; // on queue change: POST /youtube/prepare with the next ≤3 upcoming youtube ids (deduped against the last call)
export async function ytAutoplay(c: PlaybackController, last: Track): Promise<void>; // up-next of `last`, minus tracks already in history, as a radio
```
- **PlayerBar** (mockup A):
  - a 2 px `#ff0033` progress line that seeks on click and with the arrow keys, built on the existing `Slider`;
  - previous, play/pause, next and the time on the left;
  - the song in the middle, plus a like button (thumbs up, `aria-pressed`). Like is hidden for Navidrome tracks and when signed out;
  - volume, repeat, shuffle and "open player" on the right.
- **NowPlaying** is an overlay over the frame, not a route:
  - large artwork, and tabs Up next / Lyrics / Related;
  - **Up next** lists the queue's upcoming tracks, and tapping one jumps there;
  - **Lyrics** shows `lyricsStore`: when the doc is synced, the current line is highlighted using `c.songTime()`; with no doc, `GET /youtube/lyrics/:id` plain text, else "No lyrics";
  - **Related** is a YtPage of shelves; it's hidden for Navidrome tracks;
  - Esc closes it; focus moves in and is restored on close.

- [ ] **Step 1: Write the failing tests**
  - `radio.test.ts`:
    - `prepare sends the next three youtube ids once`.
    - `autoplay plays up next minus history`.
    - `autoplay ignores navidrome tracks` (the existing Navidrome autoplay handles those).
  - E2E:
    - `plays a song from search`: click a song row → the player bar shows its title and the time passes 0:01 within 10 s.
    - `tapping a single song starts its radio`: the Up next tab lists more than 1 song, and the first is the one tapped.
    - `skips a song that will not play`: the queue is [`fakeunavail`, another] → a toast appears and the second song plays.
    - `flipping to Navidrome keeps playing`: while a YouTube song plays, switch → `/`, the dock shows the same title and status stays playing.
    - `like toggles`: signed in → click like → `aria-pressed=true`, and the fake catalogue recorded `like(id, true)`.
- [ ] **Step 2: Run** `pnpm vitest run src/client/youtube && pnpm test:e2e tests/e2e/youtube.spec.ts --project=chromium`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands, plus `--project=firefox`. Expected: PASS.
- [ ] **Step 5: Commit** `Web: YouTube Music player bar, now playing, radio and prepare-ahead`.

### Task 10: The image, the docs and the whole suite

**Files:**
- Modify: `Dockerfile` (the yt-dlp binary)
- Modify: `README.md`, `docs/TECHNICAL_ARCHITECTURE.md` (a YouTube Music section), `docs/SETTINGS_AND_SECURITY.md` (the cookie, the image proxy, yt-dlp)
- Modify: the spec's Status line (built), `package.json` `description` ("…for Navidrome, and YouTube Music")

**Interfaces:**
- **The Dockerfile build stage:**
  - Download `https://github.com/yt-dlp/yt-dlp/releases/download/<ver>/yt-dlp_linux` for the current release, pinned via `ARG YTDLP_VERSION` and `ARG YTDLP_SHA256`, and verify it with `sha256sum -c`.
  - `chmod 0755` it and copy it to `/app/bin/yt-dlp` in the runtime stage.
  - Runtime `ENV ECHO_YTDLP=/app/bin/yt-dlp`.

- [ ] **Step 1: Build the image locally:** `docker build -t echo-yt-test .`. Expected: success.
- [ ] **Step 2: Prove the binary runs in distroless:** `docker run --rm --entrypoint /app/bin/yt-dlp -e TMPDIR=/data/tmp echo-yt-test --version`, with a tmpfs or volume at /data. Expected: a version string.
  - If it fails for lack of a library, stop and report. Don't work around it silently.
- [ ] **Step 3: Prove a real resolve inside the container:** `docker run --rm -v <tmp>:/data --entrypoint /app/bin/yt-dlp echo-yt-test --no-config --js-runtimes node:/nodejs/bin/node -f 140 -j https://music.youtube.com/watch?v=fJ9rUzIMcZQ | head -c 200`. Expected: JSON with `"format_id": "140"`.
- [ ] **Step 4: Run the full suite:** `pnpm check && pnpm test:e2e`. Expected:
  - everything passes, apart from the known pre-existing failures (Firefox LYR-17, the 4 time-of-day Home screenshots);
  - list any other failure and fix it before going on.
- [ ] **Step 5: Docs.** Update the three documents and the spec's Status line ("built on main, not deployed").
- [ ] **Step 6: Commit** `Image and docs: yt-dlp in the image; YouTube Music mode documented`.
- [ ] **Step 7:** Do not deploy. Report to the owner; deployment needs their word.
