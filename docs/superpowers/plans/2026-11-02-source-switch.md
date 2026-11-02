# Source switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-02):** all seven tasks done, plus the review's fix pass (Spotify artist links,
connections older than the new scopes, followed artists, the player's links); merged into `main`
and deployed. Full e2e in the CI image: 439 passed + 18 isolated; only the known Firefox LYR-17
fails. Deferred minors: a failed pref save snaps the switch back silently; Liked Songs and follows
reload in full at every start; hearting a Spotify album shows in Your Library only after a reload;
the menu's library choices have no group separator; Settings → Default service shows with one
source connected.

**Goal:** One library at a time, Navidrome or Spotify, chosen by a switch, with a full Spotify
library behind it.

**Architecture:** `main.tsx` keeps both libraries side by side instead of merging them.
- A zustand `sourceStore` (`src/client/source.ts`) holds the active source.
- `PlaybackContext`'s `useLibrary()` returns the active one.
- `collections.ts` keeps playlists and hearts per source, and routes each heart by the item's id
  prefix.
- `library-spotify.ts` grows the `Library` methods the pages need.
- A route to an item of the other source flips the source.

**Tech Stack:** React 19, zustand, Vitest, Playwright with `tests/e2e/fake-spotify.ts`, Hono server
(`src/server/spotify.ts`).

**Spec:** `docs/superpowers/specs/2026-11-02-source-switch-design.md`

## Global Constraints

- Web client only; Android unchanged.
- Spotify Web API as of the February 2026 migration (`PLAYBACK_ARCHITECTURE.md` §4.5):
  - saving and checking go through `PUT`/`DELETE /v1/me/library` and `GET /v1/me/library/contains`
    with Spotify URIs;
  - search limit ≤ 10;
  - no artist top tracks, recommendations, related artists, new releases or browse.
  - Before writing a Spotify call, check the endpoint against developer.spotify.com. An endpoint
    that is unavailable is dropped from its page, never shown empty.
- Nothing from Spotify is stored beyond memory (Terms IV.3.b). Only the chosen source is kept, in
  this device's preferences.
- Spotify ids inside ECHO carry the `spotify:` prefix (`PREFIX`), for albums, playlists and, after
  Task 4, artists. Navidrome ids never do.
- The queue stays one source at a time (QUE-03, Spotify Policy III.5). Autoplay is unchanged: it
  already only follows Navidrome queues (`radio.ts:35`).
- Spotify artwork rules (`DESIGN_SYSTEM.md` §8): no play button over a Spotify cover.
- DS-01 and Fluent 2 (Draft 6) for every new style. `pnpm check` and the touched e2e specs pass at
  the end of each task.
- Commit messages: `Web: …` / `Docs: …`, with the attribution line.

## Review Focus

1. **A user with only one source connected.** The switch is hidden and every page works exactly as
   before for that source, including a Navidrome-only user who never connected Spotify.
   - Test: Task 3, `source.test.ts` "one source: no switch, that source".
   - Test: the existing e2e suite stays green.
2. **The remembered source no longer connected** (Spotify disconnected in Settings, or its token
   expired). ECHO falls back to Navidrome and nothing throws.
   - Test: Task 3, "remembered spotify, now navidrome only → navidrome".
3. **Deep links to the other source**, such as a shared `/playlist/spotify:…` URL opened in
   Navidrome mode or "Go to album" on a Spotify song from the player. They open the item and flip
   the source.
   - Test: Task 3 e2e, "a Spotify link in Navidrome mode opens it and switches".
4. **Tokens granted before the new scopes.** Calls that need a new scope fail with 403. ECHO must
   show the reconnect prompt and hide only those parts. It must not show "not on the user list",
   and nothing else may break.
   - Test: Task 2, `api.test.ts` "403 insufficient scope → spotify.scope"; Task 2 e2e.
5. **A heart on a song from the other source** (the player while browsing the other mode). It saves
   to the song's own source and the heart's state is right in both modes.
   - Test: Task 4 e2e, "hearting a Spotify song in Navidrome mode saves it in Spotify".

---

### Task 1: Spotify playlists open (the reported bug)

**Files:**
- Modify: `src/client/library-spotify.ts`: `createSpotifyLibrary` gains `playlist`; in
  `combineLibraries`, `playlist` routes by prefix. (`combineLibraries` goes in Task 3; this keeps
  the fix shippable on its own.)
- Modify: `tests/e2e/fake-spotify.ts`: answer `GET /v1/playlists/{SP_PLAYLIST.id}` with
  `{ id, name, description: '', owner: { id: 'mock-user', display_name: 'Ada' }, images: [] }`.
- Test: `tests/e2e/spotify.spec.ts`

**Interfaces:**
- Produces: `playlist(id: string): Promise<PlaylistDetail | undefined>` on the Spotify library.
  - It reads `GET /v1/playlists/{raw}` for `name`, `owner.display_name` and `description`.
  - `entries` comes from `playlistTracks(id)`.
  - `covers` is the first four distinct album covers of the entries.
  - `durationMs` is the sum of the entries.
  - The id is `PREFIX + raw`.
  - It returns `undefined` on 404.

- [ ] **Step 1: Write the failing e2e test.** `test('a Spotify playlist opens with its songs')` in
  `spotify.spec.ts`:
  - `ready(page)`, then
    `page.goto('/playlist/' + encodeURIComponent('spotify:' + SP_PLAYLIST.id))`.
  - Expect `heading({ name: 'Night Drive' })` to be visible.
  - Expect `.track-row` to have count 2.
  - Expect the text `This playlist does not exist` to have count 0.
- [ ] **Step 2: Run** `pnpm test:e2e --project=chromium tests/e2e/spotify.spec.ts -g "playlist opens"`.
  Expected: FAIL, "This playlist does not exist".
- [ ] **Step 3: Implement** `playlist` as above. In `combineLibraries`, use
  `playlist: (id) => (id.startsWith(PREFIX) ? sp.playlist?.(id) : nav.playlist?.(id))`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm check`.
- [ ] **Step 5: Commit.** `Web: Spotify playlists open with their songs`

### Task 2: New Spotify scopes and the reconnect prompt

**Files:**
- Modify: `src/server/spotify.ts`:
  - `SPOTIFY_SCOPES` adds `user-library-modify`, `user-follow-read`, `user-follow-modify`,
    `user-top-read`, `user-read-recently-played`.
  - `POST /spotify/token` also returns `scopes: string[]`. Take them from the token response's
    `scope`, kept in memory with the access token. When Spotify omits it on a refresh, keep the last
    known value. When it was never known, return `[]` (unknown).
- Modify: `src/server/spotify.test.ts`
- Modify: `src/client/spotify/api.ts`:
  - `spotifyToken` keeps `scopes`.
  - Export `missingScopes(): string[]`, using `REQUIRED_SCOPES` (the same list, exported from a new
    `src/shared/spotify-scopes.ts` that both server and client import).
  - A 403 whose body `error.message` matches `/scope/i` throws
    `SpotifyError(err('spotify.scope', strings.spotify.reconnectScopes))`; every other 403 keeps
    `not_on_user_list`.
- Create: `src/client/spotify/api.test.ts`
- Modify: `src/client/strings.ts`, adding
  `spotify.reconnectScopes: 'Reconnect Spotify to finish setting it up.'` and
  `spotify.reconnect: 'Reconnect'`.
- Modify: `src/client/shell/SpotifyViews.tsx`: the Spotify connection row shows the prompt and a
  Reconnect button (the existing `/spotify/login` flow) when `missingScopes().length`.

**Interfaces:**
- Produces:
  - `REQUIRED_SCOPES: readonly string[]` (`src/shared/spotify-scopes.ts`). The server's
    `SPOTIFY_SCOPES` becomes this list.
  - `missingScopes(): string[]`, exported from `spotify/api.ts`; empty when scopes are unknown.
  - The error code `'spotify.scope'`.

- [ ] **Step 1: Write the failing tests.**
  - `spotify.test.ts`:
    - "token response carries the granted scopes": the mock accounts service answers with
      `scope: 'streaming user-library-read'`, and `POST /spotify/token` has
      `scopes: ['streaming','user-library-read']`.
    - "authorize asks for every required scope": the redirect's `scope` param equals
      `REQUIRED_SCOPES.join(' ')`.
  - `api.test.ts` (stub `fetch` and `spotifyToken` through `vi.stubGlobal`):
    - "403 insufficient scope → spotify.scope": the body is
      `{error:{status:403,message:'Insufficient client scope'}}`.
    - "other 403 → not_on_user_list".
    - "missingScopes lists what the token lacks".
- [ ] **Step 2: Run** `pnpm vitest run src/server/spotify.test.ts src/client/spotify/api.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `pnpm check`. Expected: PASS. Also add an e2e step to
  `spotify.spec.ts`: "an old token's missing scopes ask for a reconnect". The mock accounts service
  grants the old scope list, and Settings → Account shows "Reconnect Spotify to finish setting it
  up.". The accounts mock lives in `scripts/` or `tests/e2e/`; find it with
  `grep -rn "accounts" tests/e2e/global-setup.ts`.
- [ ] **Step 5: Commit.** `Web: Spotify asks for the new permissions and says when to reconnect`

### Task 3: The source store, two libraries, the desktop switch and cross-source links

**Files:**
- Create: `src/client/source.ts`, `src/client/source.test.ts`
- Modify: `src/client/main.tsx`:
  - Build `libraries = { navidrome: baseLibrary, spotify: spotify ? createSpotifyLibrary() : null }`.
  - Call `startSource(libraries, store)`.
  - Pass `libraries` to `Shell`.
  - `startCollections(libraries)`; `startAutoplay(controller, libraries.navidrome, …)`.
- Modify: `src/client/playback/context.tsx`: `useLibrary()` returns
  `libraries[useStore(sourceStore, s => s.source)]`.
- Modify: `src/client/shell/Shell.tsx`: takes `libraries`; `TopBar` renders `<SourceSwitch />`
  between Home and the search field.
- Create: `src/client/shell/SourceSwitch.tsx`
- Modify: `src/client/shell/collections.ts`: state is per source.
- Modify: `src/client/library-spotify.ts`: delete `combineLibraries`, `NAV_ONLY` and `eitherOf`;
  delete their test (`library-spotify.test.ts`) and replace it in Task 4.
- Modify: `src/client/main.css`, `src/client/tokens.css`: the segmented control's styles.
- Modify: `src/client/prefs.ts`: a per-device pref `library.source`, next to `playback.volume`.
- Test: `tests/e2e/source.spec.ts`

**Interfaces:**
- Produces in `source.ts`:
  - `type Source = 'navidrome' | 'spotify'`
  - `sourceStore: StoreApi<{ source: Source; available: Source[] }>`
  - `startSource(libs: Libraries, views: ViewStore): void`. It sets `available` from the non-null
    libraries, then picks the remembered pref when available, else `'navidrome'` when available,
    else `'spotify'`. It subscribes to route changes and calls `ensureSourceFor(route)`.
  - `setSource(s: Source): void`. It persists the pref and, when the current route's item belongs
    to the other source, navigates Home.
  - `sourceOf(id: string): Source`, which is `id.startsWith('spotify:') ? 'spotify' : 'navidrome'`.
  - `ensureSourceFor(route: Route): void`. For album, artist and playlist routes it switches to
    `sourceOf(route.id)` when that source is available. For genre, mix and wrapped routes it
    switches to Navidrome.
  - `type Libraries = { navidrome: Library | null; spotify: Library | null }`
- Produces in `collections.ts`:
  - `startCollections(libs: Libraries)`.
  - `usePlaylists()` and `useStarredAll()` read the active source.
  - `useStarred(kind, id)` reads `sourceOf(id)`'s set.
  - `setStar` and `canStar(id?)` route by `sourceOf(item.id)`.
  - `refreshPlaylists(source?)` and `refreshStarred(source?)`.

- [ ] **Step 1: Write the failing unit tests** (`source.test.ts`, with fake libraries and a fake
  view store):
  - "one source: no switch, that source": `available` is `['spotify']`, `source` is `'spotify'`.
  - "both: the remembered one".
  - "remembered spotify, now navidrome only → navidrome".
  - "a spotify album route switches to spotify".
  - "a genre route switches to navidrome".
  - "setSource on a page of the other source goes Home".
- [ ] **Step 2: Run** `pnpm vitest run src/client/source.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `source.ts`, the `main.tsx` wiring, `useLibrary`, per-source
  `collections.ts`, and `SourceSwitch`.
  - `SourceSwitch` is a `role="radiogroup"` labelled "Library source", with two `role="radio"`
    buttons ("Navidrome", "Spotify"). Arrow keys move and select. It is hidden when
    `available.length < 2`.
  - Styling is Fluent's segmented control: a `--fl-control` track, the selected segment `--green`
    with `--on-green`, `--r-control` corners, 32px height.
  - Add the strings to `strings.ts`: `source.label`, `source.navidrome`, `source.spotify`.
- [ ] **Step 4: Run** the unit tests and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Write `tests/e2e/source.spec.ts`**, using `fakeSpotify` + `signedInWithNavidrome` +
  `connectSpotify`:
  - `'the switch shows one library at a time'`:
    - In Navidrome mode, Your Library has "Harbour Lights" and no "Northern Static".
    - Click the "Spotify" radio: Your Library has "Northern Static" and no "Harbour Lights".
    - Reload: Spotify is still selected.
  - `'a Spotify link in Navidrome mode opens it and switches'`: go to
    `/library/album/spotify:<SP_ALBUM.id>` while in Navidrome mode. The heading is
    "Northern Static" and the "Spotify" radio is checked.
  - `'switching keeps the music playing'`: play Harbour Lights, switch to Spotify, and the dock
    still has `data-status="playing"`.
  - `'Navidrome only: no switch'`: `signedInWithNavidrome` without Spotify, and the radiogroup has
    count 0.
- [ ] **Step 6: Run** `pnpm test:e2e --project=chromium tests/e2e/source.spec.ts tests/e2e/spotify.spec.ts tests/e2e/pages.spec.ts tests/e2e/shell.spec.ts`.
  Expected: PASS. Fix specs that relied on merged results (SRCH-02) so they switch to Spotify
  first.
- [ ] **Step 7: Commit.** `Web: Navidrome or Spotify, one library at a time, switched in the top bar`

### Task 4: A full Spotify library (Liked Songs, artists, hearts, search)

**Files:**
- Modify: `src/client/library-spotify.ts`
- Create: `src/client/library-spotify.test.ts` (it replaces the deleted one; stub `spotifyApi` with
  `vi.mock('./spotify/api.ts')`)
- Modify: `src/client/shell/hearts.tsx`: `HeartButton` and `SaveAlbumButton` show for both
  providers when `canStar(id)`.
- Modify: `src/client/shell/LibraryViews.tsx`:
  - The artist page uses `library.artist` (and `artistInfo` for the image).
  - "Popular" (`topSongs`) is hidden when the library lacks it.
  - Spotify gets a "Your liked songs by this artist" section, from `useStarredAll().tracks`
    filtered by artist id, hidden when empty.
- Modify: any artist link that sends Spotify artists out to Spotify; route it to
  `{ view: 'artist', id: 'spotify:…' }` instead. Find these with `grep -rn "open.spotify.com/artist\|artist.*spotify" src/client/shell src/client/ui`.
- Modify: `tests/e2e/fake-spotify.ts`. Answer:
  - `GET /v1/me/tracks` (two saved tracks)
  - `GET /v1/me/following?type=artist` (Kite Weather)
  - `GET /v1/artists/{id}`
  - `GET /v1/artists/{id}/albums`
  - `PUT`/`DELETE /v1/me/library` (record the URIs)
  - `GET /v1/me/library/contains`
  - `/v1/search` with `type` including `artist`
- Test: `tests/e2e/spotify.spec.ts`

**Interfaces:**
- Consumes: Task 3's `sourceOf`, the per-source `collections`, and `PREFIX`.
- Produces on the Spotify library:
  - `starred(): Promise<Track[]>`, from saved tracks via `GET /v1/me/tracks`, paged by 50.
  - `starredAll(): Promise<Starred>`:
    - `tracks` from `starred()`;
    - `albums` from the saved albums already loaded;
    - `artists` from `GET /v1/me/following?type=artist`, as ArtistRef with id `PREFIX + id` and the
      first image.
  - `setStar(kind, id, on)`: `PUT` (on) or `DELETE` (off) `/v1/me/library`, with body
    `{ uris: ['spotify:<kind>:<raw>'] }`. If Spotify's current reference says artists still follow
    through `/v1/me/following`, use that for artists.
  - `artist(id): Promise<{ name: string; albums: Album[] } | undefined>`, from
    `GET /v1/artists/{raw}` and `GET /v1/artists/{raw}/albums?include_groups=album,single&limit=50`.
    If the albums endpoint is unavailable, use search `artist:"<name>"` with type album, limit 10.
  - `artistInfo(id): Promise<ArtistInfo>`, with the image only.
  - `searchRemote(q)` also returns `artists: ArtistRef[]` (type `track,album,artist`, limit 10).
  - `trackOf` maps artist ids to `PREFIX + a.id`. Playback reads `spotifyId` and track URIs, not
    artist ids. Check `playback/spotify.ts` for any use of `artists[].id`.

- [ ] **Step 1: Write the failing unit tests**:
  - "starredAll maps saved tracks, saved albums and followed artists with prefixed ids".
  - "setStar sends the right URI and method for track, album, artist".
  - "artist() returns name and albums; falls back to search when the albums call 404s".
  - "searchRemote returns artists".
  - "trackOf prefixes artist ids".
- [ ] **Step 2: Run** `pnpm vitest run src/client/library-spotify.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the pages and hearts as listed.
- [ ] **Step 4: Write the e2e tests** in `spotify.spec.ts`:
  - `'Spotify mode: Liked Songs, artists and an artist page'`: Your Library → Artists has Kite
    Weather; its page shows "Northern Static"; Liked Songs lists the 2 saved tracks.
  - `'hearting a Spotify song in Navidrome mode saves it in Spotify'`: play a Spotify track, switch
    to Navidrome, and click the player's heart. The fake recorded `PUT /v1/me/library` with
    `spotify:track:<id>`, and the heart is pressed.
- [ ] **Step 5: Run** `pnpm test:e2e --project=chromium tests/e2e/spotify.spec.ts tests/e2e/source.spec.ts tests/e2e/pages.spec.ts`
  and `pnpm check`. Expected: PASS.
- [ ] **Step 6: Commit.** `Web: Spotify mode has Liked Songs, artists, hearts and artist search`

### Task 5: Spotify Home

**Files:**
- Modify: `src/client/library.ts`: `Library` gains the optional `topArtists?(count: number): Promise<ArtistRef[]>`.
- Modify: `src/client/library-spotify.ts`:
  - `albumList(kind, size)`:
    - `recent`: unique albums of `GET /v1/me/player/recently-played?limit=50`;
    - `frequent`: unique albums of `GET /v1/me/top/tracks?limit=50&time_range=medium_term`;
    - `newest` and `starred`: saved albums;
    - `random` and `highest`: `[]`.
  - `topArtists(count)` from `GET /v1/me/top/artists`.
- Modify: `src/client/shell/HomeView.tsx`:
  - Shelf titles come from the source: Spotify uses `strings.home.spotify.{recent: 'Jump back in',
    frequent: 'From your top tracks', newest: 'Saved albums'}`.
  - In Spotify mode, Made For You and ECHO's Jump back in (server play history) are hidden.
  - `ArtistShelf` takes `library.topArtists` when present.
  - An `AlbumShelf` whose list is empty renders nothing (check that it already does).
- Modify: `tests/e2e/fake-spotify.ts`: answer `recently-played`, `top/tracks` and `top/artists`.
- Test: `src/client/library-spotify.test.ts`, `tests/e2e/spotify.spec.ts`

- [ ] **Step 1: Write the failing unit tests**:
  - "albumList recent dedupes recently played albums in play order".
  - "albumList frequent from top tracks".
  - "albumList random is empty".
  - "topArtists maps prefixed ids".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Write the e2e test** `'Spotify Home: Jump back in, top tracks, top artists, saved albums, playlists'`.
  Switch to Spotify; on Home, the headings "Jump back in", "From your top tracks", "Saved albums"
  and "Your playlists" are visible, the shelves contain "Northern Static", and "Made For You" has
  count 0. Run it with `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `Web: Spotify Home from your Spotify history`

### Task 6: Phone: the avatar and the account menu switch

**Files:**
- Modify: `src/client/shell/Shell.tsx`: extract `AccountMenu`'s items into a shared component.
  - The menu gains two `role="menuitemradio"` items, "Navidrome" and "Spotify", with
    `aria-checked`, under a "Library" group label. They are shown only when `available.length === 2`.
  - These items also show in the desktop account menu.
- Modify: `src/client/shell/HomeView.tsx`: on compact layouts (`useCompact()`), the greeting row
  gets an avatar button (the same `avatar-btn`) that opens `AccountMenu`.
- Modify: `src/client/main.css`: the avatar on Home is shown only under 720px.
- Test: `tests/e2e/source.spec.ts`

- [ ] **Step 1: Write the failing e2e test** `'phone: the switch lives in the account menu'`.
  - Viewport 390×844.
  - Click Home's avatar button (`getByRole('button', { name: 'Account' })`), then click the menu
    item radio "Spotify".
  - Your Library shows "Northern Static".
  - The radio item "Spotify" has `aria-checked="true"`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it with `ui.spec`, `a11y.spec` (A11Y-02 focus and A11Y-07 targets) and
  `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `Web: on phones the library switch is in the account menu`

### Task 7: Docs, baselines and review

**Files:**
- Modify:
  - `docs/PRODUCT_SPEC.md` (the switch)
  - `docs/PLAYBACK_ARCHITECTURE.md` §4.5 (the endpoints added; the scopes in §4.2)
  - `docs/DESIGN_SYSTEM.md` §2 (the switch in the top bar) and §9.5 (the segmented control)
  - `docs/ACCEPTANCE_CRITERIA.md` (SRCH-02 → per-source results; a new SRC-01 for the switch)
  - `README.md` (Spotify line)
  - `docs/README.md` status
- Modify: the visual baselines (`scripts/e2e-container.sh --project=chromium shell.visual ui.visual -u`;
  copy the PNGs back from `$ECHO_E2E_DIR/tree`).

- [ ] **Step 1: Update the docs.**
- [ ] **Step 2: Regenerate the baselines,** then check each changed PNG by eye: the switch in the
  top bar, nothing else moved.
- [ ] **Step 3: Run the full suite** in the CI image (`scripts/e2e-container.sh`). Expected:
  everything passes except the known Firefox LYR-17. Record any other failure in the ledger and fix
  it.
- [ ] **Step 4: Take screenshots** for the owner: both modes, desktop and phone (Home, Your
  Library, a Spotify playlist, a Spotify artist, and the phone account menu).
- [ ] **Step 5: Commit.** `Docs and baselines: the library source switch`
