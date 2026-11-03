# YouTube Music mode, Liner notes — design

Status: **approved** by the owner 2026-11-03; **built** on branch `liner-notes` (not deployed: the owner's word).
Builds on `2026-11-03-youtube-music-design.md` (live since 2026-11-03, `main` e8daea6), which this
replaces where it speaks about the look.
Mockups: https://claude.ai/artifact/8yTf8MWLVBU9TQqsDvfcWm, board **C** (Home) and board **F**
(the full-screen player with lyrics). Boards A, B, D and E are rejected directions.

## Intent

The owner looked at YouTube Music mode as built (mockup A: YouTube Music's own look) and asked to
"recreate the whole YouTube Music UI" as "a completely different UI": its own design, unlike
YouTube and unlike ECHO's Fluent look. Of three directions they chose **C, Liner notes**: a music
magazine on paper. They also want ECHO's lyrics in it, restyled for paper, and YouTube songs to get
word-by-word lyrics from Spicy Lyrics and the other word-synced sources, as Navidrome songs do.

## Owner decisions (2026-11-03)

- **Direction C, Liner notes**, for the whole of YouTube Music mode.
- **The full-screen player is paper too** (board F), not an ink-black page.
- **ECHO's lyrics, restyled for paper** (board F: "looks amazing"): the same lyric engine, timing
  and motion as Navidrome mode's lyrics view, drawn in ink on paper.
- **YouTube songs use Spicy Lyrics and the other word-synced providers.**

## The look (board C and F; my calls marked, the owner can veto)

- **Paper and ink.** Ground `#f3eee6` (paper), text `#1b1a17` (ink), secondary `#6f6a61` and
  `#4a463f`, rules `#d8d0c2`, one accent **vermilion** `#b8391a` (on the dark strip `#e0896f`).
  Thin rules separate things; no cards with shadows, no blur, no gradients. Light only: the mode
  is paper day and night (my call; ECHO's Navidrome mode stays dark).
- **Type.** **Fraunces** (serif; titles, artists in italic, lyrics) and **Instrument Sans** (UI),
  self-hosted like Selawik and Roboto (both SIL OFL). Roboto goes (my call).
- **Masthead** on every page: "ECHO" in Fraunces, under it "YouTube Music · <weekday> edition" in
  vermilion small capitals (the real weekday); the search as an underlined field; the switch as two
  words, the active one underlined in vermilion; the account. Under it the tabs **Today · Explore ·
  Your shelf** (Home, Explore and Library renamed, my call).
- **Today** (Home): "Now spinning" (the playing song, or the first Quick pick when nothing plays)
  with its cover, serif title, italic credit, "Start the radio" and Like; beside it **Quick picks as
  a numbered tracklist** (numbers in vermilion, dotted leaders to the artist and time); then the
  other shelves: songs as tracklists, albums, playlists and artists as captioned covers (artists
  round).
- **Search, Explore, Your shelf:** the same magazine page; the search tabs (All, Songs, Albums,
  Artists, Playlists) as underlined words.
- **Album, playlist, artist pages:** a spread: the big cover left, the serif title, credits, Play
  and Shuffle right, then the tracklist.
- **The player strip:** the ink strip along the bottom: play, the title in small capitals, a
  hairline progress line in vermilion with its times, then Previous, Next, Up next and Lyrics as
  words. Up next and Lyrics open the full-screen player on that tab. **Volume, repeat and shuffle
  stay** ("behaviour stays as built"; my call, the boards leave them out): at the strip's right end
  as the words Shuffle and Repeat (underlined when on) and a hairline volume slider, and beside the
  full-screen player's controls; the cover and Like stay in the strip on wide screens. ECHO's
  playback keys (space, arrows, M, S, R) work in this mode too.
- **The full-screen player** (board F): paper; a close chevron and "Playing from …" across the top;
  left the cover, serif title, italic credit, the progress line, the controls and Like; right the
  tabs **Up next · Lyrics · Related** as underlined words.
- **Lyrics on paper** (board F): ECHO's lyric field with its timing, springs and word sweep, in
  Fraunces, in ink: sung words solid ink, words still to come faded ink, the current word marked
  in vermilion, sung lines fading back, background vocals in italic, the source credit (and its
  menu) at the bottom. No glow, no blurred-cover room behind it. The untimed sheet and the
  Motion = Off sheet get the same paper colours.
- **Phone** (my call): one column; the tabs at the bottom; a slimmer ink strip above them; the
  full-screen player stacks the cover over the tabs.

Behaviour stays as built: radio on a tap, looking songs up ahead, likes, the queue, the sign-in,
the switch, the admin switch, failures and the bot check.

## Word-synced lyrics for YouTube songs

- NetEase (word-timed) and LRCLIB already answer YouTube songs: they search by title and artist.
- **Spicy Lyrics** looks lyrics up by Spotify track id. YouTube songs get one the way Navidrome
  songs do: ListenBrainz's metadata mapper (`lb-meta`: artist, album, title), kept in
  `spotify_matches` under the scope `youtube`, keyed by the video id.
- **The song's details come from YouTube, never from the browser** (my call): the server looks the
  video up through the catalogue (title, artists, album, duration) before matching, so nobody can
  pin a wrong Spotify id on a song for everyone (the rule `spotifyMatch.ts` already keeps for
  Navidrome).
- **Only songs are matched, not videos** (my call): a YouTube Music song with an album; music videos
  and uploads ("Official Video" titles, channel names as artists, intros) would match wrongly, and a
  match is shared by everyone. A user who still meets a wrong match pins another source in the
  lyrics source menu, as today; an admin "Fix match" for YouTube songs is later work.
- **Matching starts early** (my call): when a song is looked up ahead (`/youtube/prepare`: on a tap,
  a hover, a page's first song, the next songs in the queue) its match starts too, so its first
  play already has Spicy; a song that still has none when its lyrics are asked is matched then,
  inside the resolver's 1.5 s, as Navidrome songs are.
- Admin → Spotify matching keeps listing Navidrome songs only (my call: YouTube songs are matched on
  play; no background sweep of YouTube).

## Goals

1. Every screen of YouTube Music mode in the Liner notes look: masthead, tabs, Today, Explore, Your
   shelf, search, album/playlist/artist pages, the player strip, the full-screen player, the
   Settings sign-in card stays in Settings (Fluent) as it is.
2. ECHO's lyrics in the full-screen player's Lyrics tab, on paper, as board F.
3. A YouTube song that Spicy Lyrics knows gets its word-by-word lyrics from Spicy.
4. Phones work: one column, bottom tabs, the strip above them.
5. Accessible as now: real buttons and links, tab semantics, focus moves, contrast 4.5:1 (ink and
   vermilion on paper pass; check faded ink only where it is decorative or large).

## Non-goals

- Changes to Navidrome mode, its lyrics view, Android.
- A dark variant of the paper look.
- New features (moods & genres in Explore stays open, as before).
- A background sweep matching YouTube songs to Spotify ids.

## Anti-goals

- Anything that looks like YouTube or YouTube Music (logo, red, layout).
- Live blur, `backdrop-filter`, glows on paper.
- Breaking ECHO's own lyrics view: the paper look is scoped to YouTube Music mode.
- Trusting the browser's title or artist for a shared Spotify match.

## Constraints

- **DS-01** (`src/client/design-rules.test.ts`): no raw colours or px outside `tokens.css`; the
  paper palette, type and sizes become tokens (rename the `--yt-*` set or add a `--ln-*` one).
  **DS-02**: no `text-shadow`, no monospace.
- **The lyric field** (`src/client/stage/lyrics/field.ts`, `stage.css` `.ly-*`) takes its colours,
  font and glow from custom properties (`--text`, `--lyric-ink-active`, `--art-highlight`,
  `--art-room`, `--art-glow-solid`, `--font`, `--ly-active`); the paper look overrides them in a
  scope inside YouTube Music mode.
- **The Stage engine** (`src/client/stage/engine.ts` `mountStage`) draws the room on a WebGL canvas
  and runs the contrast solver against it; the paper look needs the engine **without the room**
  (an option, e.g. `room: false`, that skips the renderer and the solver and keeps the field, the
  loop and the song clock). Navidrome mode's lyrics view keeps the room.
- The lyrics route (`src/server/lyrics/routes.ts`) only asks `spotifyIdsFor` for Navidrome keys;
  YouTube keys need their own path, with the catalogue for the details.
- Fonts: Google Fonts' latin subsets, variable where offered, with their OFL texts in
  `src/client/fonts/`.
- Deploying needs the owner's word.

## Left to the builder

- Token names, component structure (a reskin of `src/client/youtube/` with new markup where the
  layout differs: masthead, tracklists, spreads).
- How the current word is marked (an underline as in board F, or the sweep's edge in vermilion if
  an underline fights the field's layout).
- Whether far lines keep their slight blur on paper.
- How the engine option is plumbed through `Stage`.
- Tests: unit tests for the YouTube Spotify matching (catalogue details, never request details) and
  the engine option; E2E updated for the new names (Today, Your shelf) and a lyrics check on paper;
  screenshots of each page in both browsers before handing over.
