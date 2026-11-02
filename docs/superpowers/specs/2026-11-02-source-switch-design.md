# Source switch: Navidrome or Spotify, one at a time — design

Status: **approved** by the owner 2026-11-02 · built 2026-11-02 (plan `docs/superpowers/plans/2026-11-02-source-switch.md`)

## Intent

The owner connected Spotify and found it "doesn't really work". Two Spotify playlists opened as
"This playlist does not exist", and most pages only know Navidrome. ECHO today merges both
libraries into one (`combineLibraries` in `src/client/library-spotify.ts`). That merged library
answers most questions only for Navidrome: Home shelves, artist pages, playlist pages, hearts,
genres, radio. Spotify ends up as a few saved albums mixed into a Navidrome app.

The owner wants a **switch in the top bar between Navidrome and Spotify**. With Navidrome on, ECHO
shows only Navidrome albums, tracks, artists and playlists. With Spotify on, it shows only
Spotify's. Everything else stays as it is: the player, the queue, the lyrics, the lyrics view and
Settings.

## Owner decisions (2026-11-02)

- **One source at a time**, chosen by a switch. Library pages show only that source.
- **Spotify Home is built from Spotify history**: recently played, top tracks and artists, saved
  albums and playlists. This needs new Spotify permissions, so each connected user reconnects once.
- **Hearts in Spotify mode save to Spotify**: Liked Songs for tracks, saved albums for albums, and
  followed artists for artists, as in the Spotify app.
- **Flipping the switch keeps playing.** The current song and the queue carry on, whichever source
  they come from. The switch only changes what you browse. The queue keeps today's rule: one source
  per queue, so playing something from the other source asks "Replace the queue?" first (QUE-03).
  That rule is also how ECHO meets Spotify Policy III.5.
- **Phone: the switch lives in the account menu**, not as chips.

## Goals

1. Every page that shows library content shows only the active source: Your Library (playlists,
   albums, artists, Liked Songs), Home, Search, and the album, artist, playlist, Liked Songs and
   genre pages.
2. Spotify mode is a full library, not a stripped one:
   - Spotify playlists open with their tracks, including the owner's two playlists in the screenshot
     (`/playlist/spotify:…`).
   - Liked Songs (saved tracks), saved albums and followed artists all appear.
   - Spotify artist pages show the artist and their albums (see "Spotify artist pages" below: the API
    has no artist top tracks in Development Mode).
   - Home shows Spotify shelves.
   - Search searches Spotify.
3. The switch appears only when the signed-in user has **both** sources connected. With one
   source, ECHO behaves as that source alone.
4. The choice is remembered.

## Non-goals

- Mixing both sources on one page (the current behaviour goes away).
- Navidrome-only features in Spotify mode: genres, song radio, Made For You mixes, Wrapped, and
  creating or editing playlists. In Spotify mode they are hidden, never shown broken. Editing
  Spotify playlists is a possible later project.
- Spotify podcasts, audiobooks, AI DJ, Canvas, charts (out of scope since the Spotify redesign).
- Android. This is the web client; Android is a later project.

## Anti-goals (a failure even if it works)

- A page in Spotify mode that says "does not exist", or comes up empty, for something Spotify does
  have.
- A Navidrome item showing in Spotify mode, or the reverse.
- Switching interrupting the music.
- Spotify data kept beyond memory. Spotify's Terms IV.3.b already govern
  `library-spotify.ts`: nothing from Spotify is stored on the server or in browser storage, apart
  from the choice of source itself.

## Constraints

- **Spotify Development Mode.**
  - At most 5 users.
  - Playlists owned by someone else can't be read. That is already handled: only owned and
    collaborative playlists are listed.
  - Search returns at most 10 per type.
  - Several endpoints are closed to new apps since November 2024 (recommendations, related
    artists, featured and category playlists, audio features). Home can't use them.
- **The Web API as of the February 2026 migration** (`PLAYBACK_ARCHITECTURE.md` §4.5) is the
  reference, not older docs. Saving and checking go through `PUT`/`DELETE /v1/me/library` and
  `GET /v1/me/library/contains` with Spotify URIs. Artist top tracks, new releases and browse are
  gone in Development Mode. The builder checks each endpoint this design uses (artist albums,
  followed artists, top items, recently played) against the current API. One that turns out
  unavailable is dropped from its page, never shown empty.
- **New scopes:** `user-library-modify` (hearts), `user-follow-read` (followed artists, and
  `user-follow-modify` if following still needs it), `user-top-read` and
  `user-read-recently-played` (Home). They are added to
  `SPOTIFY_SCOPES` in `src/server/spotify.ts`. A token that lacks a scope must not break the app.
  ECHO notices the missing scopes and shows "Reconnect Spotify to finish setting up" with a
  Reconnect button. Until then the affected shelf or heart is hidden.
- Spotify artwork rules (`DESIGN_SYSTEM.md` §8) still apply on every new Spotify page: no overlay
  play button on Spotify covers, no cropping, and Spotify's logo and links where required.
- DS-01 and the Fluent 2 design system (Draft 6) apply to the switch and to any new page.

## How it works

### The active source

- A small store holds `source: 'navidrome' | 'spotify'`.
- *As built:* the remembered choice is the existing per-account preference
  `playback.defaultProvider` (Settings → Default service, which had no effect before). So the
  switch and that setting are one, and the choice follows the account rather than the device.
- It is remembered per device, like volume. Per device is my call: a phone and a desktop can
  differ, and it needs no server change.
- It defaults to Navidrome when both are connected. With one connection, the source is that
  connection and the switch is hidden.
- If a remembered source gets disconnected, ECHO falls back to the other one.

### Two libraries, not one

- `combineLibraries` is retired. The shell holds both libraries and gives pages the active one.
- The Spotify library grows the `Library` methods the pages need: `playlist`, `starred` (saved
  tracks), `starredAll`, `setStar`, `artist`, `topSongs`, `albumList` (the Home shelves), and
  `searchRemote` with artists.
- Library methods Spotify can't answer stay undefined. Pages already hide what a library doesn't
  offer; that is checked page by page.
- Your Library's albums, playlists and artists, and its search and sort, read the active library.

### Following links across sources

- A link or route to an item of the other source switches the source and opens it. Examples: a
  Spotify album from the player's "Go to album" while in Navidrome mode, or a shared link. The
  route says which source owns it, because Spotify ids carry `spotify:`.
- That way "Go to album" and "Go to artist" from the player always work, and nothing says "does
  not exist".

### Spotify artist pages

These show the artist (name and picture) and their albums. "Your liked songs by this artist" comes
from Liked Songs and is hidden when there are none. It stands in for the Popular list, which the
API no longer offers. My call; the owner approved Spotify artist pages, not their exact sections.
If the artist's album list isn't available, the albums come from a search for the artist (at most
10).

### Spotify Home

Shelves, in order:
- Jump back in (recently played, unique albums)
- Your top tracks
- Your top artists
- Saved albums
- Your playlists

The greeting and the shortcut grid stay; the shortcuts become recently played albums and
playlists. Shelves are fetched live and kept only in memory.

### The switch

- **Desktop and tablet:** a Fluent segmented control, `Navidrome | Spotify`, in the top bar
  between Home and the search box. The active segment is the accent. It is keyboard reachable,
  with a radio-group role and arrow keys.
- **Phone:** ECHO gets an avatar button at the top of Home, as in Spotify's phone app. It opens the
  same account menu as on desktop, and the menu holds the switch (two radio items). This is my
  call: there is no account menu on phones today, and the owner chose the account menu.
- Switching goes to Home if the current page belongs to the other source, and otherwise stays.
  Playback is untouched.

### Hearts

- A heart saves to **the item's own source**, whatever the active mode. My call; it keeps the
  player's heart meaningful while you browse the other source.
  - A Spotify track, album or artist saves to or follows it in Spotify (`/v1/me/library`).
  - A Navidrome one stars it in Navidrome, as today.
  - The player and queue show hearts for songs of both sources. Today a Spotify song gets no
    heart.
- `collections.ts` keeps one saved-set per source.
- Spotify's saved state is checked in batches with `GET /v1/me/library/contains`.
- A failed save reverts the heart and shows a toast, the same as with Navidrome today.

### Unchanged

The player, queue, lyrics, the lyrics view, Settings, Mica and the Fluent look. The queue is one
source at a time, as today.

Autoplay follows the queue's source. With a Navidrome queue it works as now. With a Spotify queue
it stays off, because Spotify's recommendations are closed to this app. My call.

## Deliverables

1. Spotify playlist pages work (the screenshot bug), with a test.
2. The source store, the switch (desktop top bar; phone avatar and account menu) and the
   per-device memory.
3. A library chosen per source across all library pages; `combineLibraries` removed.
4. The fuller Spotify library: Liked Songs, followed artists, artist pages, Home shelves, search
   with artists, hearts.
5. The new scopes, missing-scope detection and the "Reconnect Spotify" prompt.
6. Updates to `PRODUCT_SPEC.md` and `PLAYBACK_ARCHITECTURE.md` §4.5 (the Spotify library
   subset), `DESIGN_SYSTEM.md` (the switch), `README.md` and the acceptance criteria. SRCH-02,
   which asks for merged results, is changed to per-source results.
7. Unit tests for the source store, the routing switch and each Spotify library method (against
   the existing fake Spotify, `tests/e2e/fake-spotify.ts`). E2E tests for the switch, Spotify
   mode's pages and cross-source links. Visual baselines for the switch.
8. Screenshots for the owner before deploying.

## Left to the builder

- How the Spotify library batches and caches calls in memory, and the size of each shelf.
- The exact layout of the segmented control within Fluent's tokens.
- Which Home shelves to drop when Spotify returns nothing for them.
- The order of work within the deliverables, apart from the playlist bug going first.
