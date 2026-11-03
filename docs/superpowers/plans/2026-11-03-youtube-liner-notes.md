# YouTube Music mode, Liner notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole of YouTube Music mode as "Liner notes" (paper and ink, a music magazine), put ECHO's lyrics on paper in its full-screen player, and give YouTube songs Spicy Lyrics through Spotify-id matching.

**Architecture:** The behaviour of `src/client/youtube/` stays; its markup and `yt.css` are rewritten to boards C and F, on new `--ln-*` tokens. The lyric field runs in a Stage without its WebGL room (`StageOptions.room: false`) under a paper scope of CSS overrides. On the server, the catalogue gains `meta(videoId)` (YouTube's own details, songs with an album only), the matcher gains `idsForTrack(scope, id, load)`, and the lyrics route and `/youtube/prepare` use them for YouTube keys.

**Tech Stack:** React 19, zustand, Hono, better-sqlite3, youtubei.js 18.2.0, Vitest, Playwright; fonts Fraunces and Instrument Sans (SIL OFL, self-hosted).

**Spec:** `docs/superpowers/specs/2026-11-03-youtube-liner-notes-design.md` (approved 2026-11-03); mockups: boards C and F at https://claude.ai/artifact/8yTf8MWLVBU9TQqsDvfcWm (local copies: the session scratchpad's `ytm-canvas/project/LinerNotes.dc.html`, `LinerPlayer.dc.html`).

## Global Constraints

- **Palette (spec):** paper `#f3eee6`, ink `#1b1a17`, secondary `#6f6a61` and `#4a463f`, rules `#d8d0c2`, faded ink `#c9c0b0` / `#b3aa9a` / `#a69d8c`, vermilion `#b8391a`, vermilion on ink `#e0896f`. Light only.
- **Type:** Fraunces (titles, artists in italic, lyrics) and Instrument Sans (UI); Google Fonts' latin variable woff2, OFL texts in `src/client/fonts/`. Roboto and `OFL-Roboto.txt` are removed.
- **DS-01/DS-02:** every colour, px size and font stack in `src/client/tokens.css` as `--ln-*` (the old `--yt-*` block goes, `--yt-red` and `--yt-dot` included: the Fluent switch's dot uses `--ln-vermilion`); no `text-shadow`, no monospace, no `backdrop-filter`, no glow on paper.
- **Names:** tabs **Today · Explore · Your shelf**; masthead line `YouTube Music · <Weekday> edition` (en-GB weekday, the browser's day); routes unchanged (`/yt`, `/yt/explore`, `/yt/library`, …).
- **Behaviour unchanged** (radio on a tap, lookahead hints, likes, queue slots, sign-in, switch, admin switch, failures, bot check), and **volume, repeat, shuffle stay**; keys space, ←/→, Shift+←/→, ↑/↓, M, S, R work in YouTube Music mode.
- **Scope:** Navidrome mode, its lyrics view (room on), Settings and Android do not change.
- **Spicy matching:** details only from the catalogue (`meta`), never from the request; only songs with an album; scope `youtube`, key = video id; early on `/youtube/prepare`, else inside the resolver's 1.5 s (`ON_PLAY_TIMEOUT_MS`).
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `pnpm typecheck && pnpm lint && pnpm test` before each.

## Review Focus

1. **A YouTube music video (no album) plays** → no Spotify match is attempted, NetEase/LRCLIB still answer. Pinned in Task 2 (`meta is null for a video`, `a video is never matched`).
2. **The browser sends a wrong title/artist with a YouTube lyrics request** → the shared match still uses YouTube's own details. Pinned in Task 2 (`matches from the catalogue, never from the request`).
3. **Paper lyrics while Navidrome mode's lyrics view was used before (and after)** → Navidrome's view keeps its room and dark look. Pinned in Task 1 (`the room is drawn unless room is false`) and Task 5 (e2e `ECHO's lyrics view keeps its room`).
4. **A phone at 390 px** → the masthead wraps without horizontal scroll, the tabs sit at the bottom, the strip fits. Pinned in Task 3 (e2e `phone: no sideways scroll, tabs at the bottom`).
5. **Keyboard in YouTube Music mode while typing in search** → space types a space, it does not pause. Pinned in Task 3 (e2e `keys: space pauses, but not while typing`).

---

### Task 1: The Stage without its room

**Files:**
- Modify: `src/client/stage/engine.ts` (`StageOptions`, `mountStage`), `src/client/shell/Stage.tsx` (prop)
- Test: `src/client/stage/stage.test.ts`

**Interfaces:**
- Produces: `StageOptions.room?: boolean` (default true); `<Stage room={false}>`. With `room: false` no `StageRenderer` is created, the contrast solver does not run, `stageStatus.renderer` is `'none'`, and the lyric field, loop and song clock run as before.

- [ ] **Step 1: Failing test** `the room is drawn unless room is false`: mount with a fake canvas whose `getContext` counts calls; `room: false` → never called and `stageStatus.getState().renderer === 'none'`; default → called. (Follow the file's existing fakes for `mountStage`.)
- [ ] **Step 2: Run** `pnpm vitest run src/client/stage/stage`. Expected: FAIL.
- [ ] **Step 3: Implement** the option (`renderer` stays null, the solver's `contrastAt` and palette→renderer paths skip when it is null) and `Stage`'s `room` prop passed into `mountStage`; add `'none'` to the `renderer` status union.
- [ ] **Step 4: Run** the same. Expected: PASS, and `pnpm vitest run src/client` green.
- [ ] **Step 5: Commit** `Stage: an option to run the lyric field without the room`.

### Task 2: Spicy Lyrics for YouTube songs

**Files:**
- Modify: `src/server/youtube/catalogue.ts` (`Catalogue.meta`), `src/server/youtube/fake.ts`, `src/server/lyrics/spotifyMatch.ts` (`idsForTrack`), `src/server/lyrics/routes.ts` (`LyricsDeps.youtubeSpotifyIdsFor`), `src/server/youtube/routes.ts` (`YoutubeDeps.matchAhead`), `src/server/index.ts`, `src/server/testing.ts`
- Test: `src/server/youtube/catalogue.test.ts`, `src/server/lyrics/spotifyMatch.test.ts`, `src/server/lyrics/routes.test.ts`, `src/server/youtube/routes.test.ts`

**Interfaces:**
- Produces:
```ts
// catalogue.ts
meta(videoId: string): Promise<{ title: string; artist: string; album: string; durationMs: number } | null>;
//   from Up next's seed (the song itself); null when it has no album (a video or an upload)
// spotifyMatch.ts (matcher)
idsForTrack(scope: string, id: string, load: () => Promise<TrackMeta | null>, timeoutMs?: number): Promise<string[]>;
//   idsFor(scope, navidromeId, client) becomes idsForTrack with a getSong loader
// lyrics/routes.ts
LyricsDeps.youtubeSpotifyIdsFor?: (videoId: string) => Promise<string[]>;
// youtube/routes.ts
YoutubeDeps.matchAhead?: (videoId: string) => void;   // called for each id /youtube/prepare takes
```
- Wiring (`index.ts`): `const ytMeta = (id) => anonymousCatalogue.meta(id)` (public details need no cookie); `youtubeSpotifyIdsFor: (id) => matcher.idsForTrack('youtube', id, () => ytMeta(id).then(toTrackMeta(id)))`; `matchAhead: (id) => void matcher.idsForTrack('youtube', id, …, Number.POSITIVE_INFINITY)`. The lyrics cache key adds `|sp:<id>` for YouTube keys as for Navidrome.

- [ ] **Step 1: Failing tests**
  - catalogue: `meta is null for a video`: `cat().meta('fJ9rUzIMcZQ')` (the recorded official video) → `null`; fake `meta('fakesong001')` → `{ title: 'Fake Song 1', artist: 'Kasimir Vale', album: 'Low Sun', durationMs: 180000 }`.
  - spotifyMatch: `idsForTrack loads once and keeps the match`: a loader counting calls and the existing lb-meta fake returning `[ID_A]` → `[ID_A]` twice, loader called once, a `spotify_matches` row with scope `youtube`.
  - spotifyMatch: `a video is never matched`: loader → `null` → `[]`, lb-meta never asked.
  - lyrics routes: `matches from the catalogue, never from the request`: deps with `youtubeSpotifyIdsFor` recording its argument and a source recording `input.spotifyId`; `GET /lyrics?trackKey=youtube:fakesong001&title=Wrong&artist=Wrong` → `youtubeSpotifyIdsFor` got `'fakesong001'` (no title or artist argument exists), the source saw `spotifyId` = its answer.
  - youtube routes: `prepare starts matching too`: `matchAhead` recorded `['fakesong001','fakesong002']`.
- [ ] **Step 2: Run** `pnpm vitest run src/server/youtube src/server/lyrics`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as in Interfaces (fake `meta` from its song list; `idsForTrack` takes the existing `idsFor` body with the loader injected; `idsFor` keeps its signature).
- [ ] **Step 4: Run** `pnpm vitest run src/server`. Expected: PASS (openapi unchanged: no new route).
- [ ] **Step 5: Commit** `Lyrics: YouTube songs get Spotify ids for Spicy Lyrics, from YouTube's own details`.

### Task 3: Paper foundation: tokens, fonts, masthead, tabs, keys

**Files:**
- Create: `src/client/fonts/fraunces-latin.woff2`, `instrument-sans-latin.woff2`, `OFL-Fraunces.txt`, `OFL-InstrumentSans.txt`; `src/client/youtube/keys.ts`
- Delete: `src/client/fonts/roboto-latin.woff2`, `OFL-Roboto.txt`
- Modify: `src/client/fonts.css`, `src/client/tokens.css` (`--ln-*` replaces `--yt-*`), `src/client/main.css` (`.mode-dot`), `src/client/youtube/yt.css` (rewritten, base and frame), `src/client/youtube/YtFrame.tsx` (masthead, tabs), `src/client/youtube/ModeSwitch.tsx` (unchanged markup), `src/client/strings.ts` (`youtube.home → 'Today'`, `library → 'Your shelf'`, `edition(day)`), `tests/e2e/smoke.spec.ts`, `tests/e2e/youtube.spec.ts`
- Test: e2e

**Interfaces:**
- Produces: `useYtShortcuts(open: (tab: 'next' | 'lyrics') => void): void` in `keys.ts`, mapping `shortcutFor` (from `shell/shortcuts.ts`, with `keyTarget`) actions toggle, seek*, volume*, mute, shuffle, repeat, previous, next onto the controller and ignoring the rest; frame classes `.yt-masthead`, `.yt-tabs` (top on wide screens, bottom on phones).
- [ ] **Step 1: Fonts:** fetch `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..800;1,9..144,400&family=Instrument+Sans:wght@400..600` with a Chrome User-Agent; download each family's latin woff2 (Fraunces normal and italic if separate) and the OFL texts from `github.com/google/fonts/ofl/<family>/OFL.txt`; `@font-face` beside Selawik's.
- [ ] **Step 2: Failing e2e** (rename the YouTube spec's Home/Library to Today/Your shelf, then add):
  - `the masthead names the edition`: `/yt` shows `ECHO`, `YouTube Music · <today's weekday> edition`, tabs `Today`, `Explore`, `Your shelf`; `Today` has `aria-current="page"`.
  - `phone: no sideways scroll, tabs at the bottom`: 390×844 → `document.documentElement.scrollWidth <= 390`, the tab nav's top > 700.
  - `keys: space pauses, but not while typing`: play a song, press Space on the page → status paused; focus search, type `a b` → the field holds `a b` and status unchanged.
  - smoke: families `['Fraunces', 'Instrument Sans', 'Selawik']`, loaded `['Selawik']`.
- [ ] **Step 3: Run** `pnpm test:e2e tests/e2e/youtube.spec.ts tests/e2e/smoke.spec.ts --project=chromium`. Expected: the new/renamed ones FAIL.
- [ ] **Step 4: Implement** tokens, fonts, the frame (board C masthead and tabs), `keys.ts` mounted in `YtFrame`, the paper base of `yt.css`.
- [ ] **Step 5: Run** the same, then `--project=firefox`, and `pnpm vitest run src/client` (DS-01/02). Expected: PASS.
- [ ] **Step 6: Commit** `Web: YouTube Music mode on paper: tokens, fonts, masthead, tabs, keys`.

### Task 4: The pages: Today, tracklists, covers, spreads

**Files:**
- Modify: `src/client/youtube/pages.tsx`, `src/client/youtube/parts.tsx`, `src/client/youtube/yt.css`
- Test: `tests/e2e/youtube.spec.ts`

**Interfaces:**
- Consumes: `YtPage`, `playItem`, `hintSong` (unchanged).
- Produces: `NowSpinning({ fallback }: { fallback?: YtItem })` (the playing track, else `fallback`: Today's first Quick pick); `Tracklist({ items, numbered, onPlay })` (rows: number in vermilion, title, dotted leader, italic artist, time; one `<ol>`); `Covers({ items })` (captioned covers; artists round); `Spread({ page, kind, id })` (album/playlist/artist header).
- [ ] **Step 1: Failing e2e:**
  - `Today: now spinning and a numbered tracklist`: `/yt` → region `Now spinning` shows `Fake Song 1` (nothing playing), list `Quick picks` has 8 items, the first starting `01`.
  - `a spread for an album`: `/yt/album/MPREb_fake1` → `h1` `Low Sun`, buttons `Play` and `Shuffle`, tracklist items numbered `01`…`04`.
  - Existing tests keep their button names (`Play Fake Song N, …`).
- [ ] **Step 2: Run** chromium. Expected: FAIL.
- [ ] **Step 3: Implement** boards C's Today and the other pages (search tabs as underlined words).
- [ ] **Step 4: Run** both browsers. Expected: PASS.
- [ ] **Step 5: Commit** `Web: YouTube Music pages as liner notes`.

### Task 5: The ink strip, the paper player, lyrics on paper

**Files:**
- Modify: `src/client/youtube/PlayerBar.tsx`, `src/client/youtube/NowPlaying.tsx`, `src/client/youtube/YtFrame.tsx`, `src/client/youtube/yt.css`
- Test: `tests/e2e/youtube.spec.ts`

**Interfaces:**
- Consumes: `<Stage room={false}>` (Task 1), `LyricsView` (exported), `useYtShortcuts` (Task 3).
- Produces: `PlayerBar({ onOpen }: { onOpen: (tab: 'next' | 'lyrics') => void; compact: boolean })`; `NowPlaying({ tab, onClose })` opens on the given tab; the paper lyrics scope `.ln-lyrics` (overrides `--text`, `--lyric-ink-active`, `--art-highlight` = vermilion, `--art-room` = paper, `--art-glow-solid` transparent, `--font` = Fraunces stack, and the sheet colours).
- [ ] **Step 1: Failing e2e:**
  - `the strip: play, title, hairline, words`: playing → region `Player` has buttons `Pause`, `Previous`, `Next`, `Up next`, `Lyrics`, `Shuffle`, `Repeat`, the `Seek` and `Volume` sliders (wide screens), and the time `0:0x` as its own text.
  - `Lyrics opens the paper player on its tab`: click `Lyrics` → dialog `Now playing`, tab `Lyrics` selected, `.ly-field` attached, no `.stage-canvas` drawing (`[data-renderer="none"]`), the transcript's first line `Glass in the morning, Fake Song N`; the dialog's background colour is paper (`rgb(243, 238, 230)`).
  - `ECHO's lyrics view keeps its room`: then flip to Navidrome and open `/listen` → `.stage` `data-renderer` is not `none`.
  - the existing radio, skip, flip and like tests pass with `Up next` in place of `Open the player`.
- [ ] **Step 2: Run** chromium. Expected: FAIL.
- [ ] **Step 3: Implement** board C's strip and board F's player (controls, Like, shuffle/repeat/volume beside them; phone stacks the cover over the tabs), the paper lyrics scope; the current word in vermilion via `--lit-edge` (or an underline if it lays out cleanly).
- [ ] **Step 4: Run** both browsers, plus `tests/e2e/lyrics.spec.ts`. Expected: PASS (known flakes aside: LYR-14 under load, Firefox LYR-17).
- [ ] **Step 5: Commit** `Web: the ink strip, the paper player and ECHO's lyrics on paper`.

### Task 6: Screenshots, the whole suite, docs

**Files:**
- Modify: `README.md` (YouTube Music line: "its own magazine look"), `docs/superpowers/specs/2026-11-03-youtube-liner-notes-design.md` (Status)
- [ ] **Step 1:** screenshots of Today, search, an album, the strip, the paper player with lyrics, and the phone layout in Chromium and Firefox; compare with boards C and F; fix what differs.
- [ ] **Step 2:** `pnpm check && pnpm test:e2e`. Expected: green apart from the known flakes (4 Home screenshots, LYR-14 under load, Firefox LYR-17); any other failure is fixed first.
- [ ] **Step 3:** docs, commit `Docs: YouTube Music mode, Liner notes`. Do not deploy: the owner's word.
