# ECHO in Spotify's clothes — design and build plan (2026-10-29)

The owner asked for ECHO (web and Android) to look "very much like Spotify", with Spotify's features
too, keeping liquid glass. Agreed in a brainstorm with mockups (`.superpowers/brainstorm/`, not in
git); the owner then said "deploy it": build without further questions, and put it live.

## Decided by the owner

- **Both apps**: the web app and the Android app.
- **Glass, option B**: the player bar floats over the music as a liquid-glass pill (desktop); on
  phones the mini player and the tab bar float as glass. Glass also on things that float over
  content: the sticky page header, menus, dialogs, sheets.
- **Lyrics view after the owner's reference** (a Spicy/Beautiful-Lyrics style screenshot): full
  window, the cover hugely blurred as the background, cover + progress + title + artist on the left,
  the lyric column on the right (bold, start-aligned, distance dims and blurs, word-by-word light,
  interlude dots). Controls appear as the glass pill on pointer movement and fade again. On phones
  the cover shrinks to a small header above the lyrics. No lyrics: cover and title centred.
- **Not missed**: the Stage visualiser (the "visual" mode), ECHO's Material 3 look.
- **Scope**, in order:
  1. The redesign + the Spotify features Navidrome can already supply.
  2. Mixes from listening history (Made For You, Daily Mixes, Discover-Weekly-like, Daylist, Smart
     Shuffle, Jump back in, a yearly Wrapped). Needs a server-side play history.
  3. Devices: control another of your devices (Connect-like), offline downloads (Android),
     crossfade, equaliser, desktop mini player window.
  4. Podcasts (ECHO reads RSS itself; Navidrome has none).
- **Out**: all social features (Friend Activity, Jam, Blend, collaborative playlists, profiles,
  share links); AI DJ, Canvas videos, concerts and merch, audiobooks, charts and editorial
  playlists.

## My calls (owner may overrule)

- Name and logo stay ECHO (a bold wordmark); nothing of Spotify's brand marks. Spotify's green
  (`#1ED760`) is used as the accent, as in the mockups the owner approved.
- Typeface: **Figtree** (OFL, self-hosted), a free face close to Spotify's Circular, everywhere.
- Colour: Spotify's fixed neutrals (`#000` frame, `#121212` panels, `#1F1F1F`/`#2A2A2A` raised,
  `#B3B3B3` secondary text) and green; the album palette (already computed server-side) only tints:
  page headers, the Now Playing backgrounds, the phone mini player.
- The Stage engine stays as the lyrics view's machinery (the room drawn on the blurred cover is the
  reference's background; the lyric column is the reference's column). The "visual" mode and its
  button go; the brightness control goes.
- `/` becomes Home. The lyrics / Now Playing view moves to `/listen`. Deterministic mode keeps
  `/?frame=…` (tests and screenshots).
- DS-01 stays: every raw value lives in `tokens.css`.

## Project 1 — the redesign (web)

Frame (≥ 720 px): black frame; top bar (wordmark, Home button, search pill "What do you want to
play?", avatar menu → Settings, Account, Admin, Sign out); three rounded `#121212` panels: Your
Library (left), the page (middle, scrolls), Now Playing (right, ≥ 1280 px, toggled from the
player); the glass player pill floating over the bottom of the middle panel.

Compact (< 720 px): no top bar, no side panels; the page full width; glass mini player and glass
tab bar (Home, Search, Your Library) at the bottom; tapping the mini player opens the Now Playing
view (the lyrics view, phone layout).

Pages:
- **Home**: filter chips; an 8-tile shortcut grid (Liked Songs + most recent albums/playlists);
  shelves: Recently played, New in your library, Most played, Random picks, Your playlists,
  Artists you play.
- **Your Library** (left panel, and a full page on compact): chips Playlists / Albums / Artists,
  search within, sort (Recents, Recently added, Alphabetical, Year), list rows (48 px art, title,
  "Album • Artist"), Liked Songs pinned first; "+" creates a playlist. Windowed for big libraries.
- **Album**: header tinted by the album palette (gradient into the page), 232 px cover, type label,
  big bold title (size steps down for long titles), meta "Artist • year • N songs, M min"; action
  row: 56 px green play, shuffle, heart (star the album), ⋯ menu; track table with hover row,
  number → play glyph on hover, green title when playing, heart, duration, ⋯ menu (Play next, Add
  to queue, Add to playlist, Go to song radio, Go to artist, Go to album).
- **Artist**: header with the artist image (Navidrome artist info) or a tint; name; play + follow
  (star artist); Popular (top songs); Discography; Fans also like; About (bio).
- **Playlist**: header with cover (mosaic of four), name, description, owner, count; edit name and
  description, delete, remove a track, add from any track menu.
- **Liked Songs**: Spotify's purple-blue gradient header, starred tracks, hearts unstar.
- **Search**: empty → "Browse all" genre cards; results → Top result card + Songs, then Artists,
  Albums, Playlists. **Genre** page: its albums.
- **Queue** and **Now Playing** in the right panel on desktop (a sheet on compact).
- **Lyrics / Now Playing view**: as decided above.
- **Settings, Account, Admin, sign-in, setup, invite**: Spotify's plain style (bold section titles,
  green toggles, white/green pill buttons).

New features in project 1: playlists (create, rename, describe, delete, add, remove), hearts on
every track (star/unstar) and albums/artists, song radio (Navidrome `getSimilarSongs2`, falling
back to random songs of the genre), autoplay when the queue runs out (a preference, on by
default), artist info (bio, image, similar artists, top songs), genres, a sleep timer (minutes or
end of track). Server: the Navidrome proxy allows the extra read methods (`getArtistInfo2`,
`getTopSongs`, `getSimilarSongs2`, `getGenres`, `getRandomSongs`, `getSongsByGenre`,
`getAlbumInfo2`) and write methods (`createPlaylist`, `updatePlaylist`, `deletePlaylist`); the mock
Navidrome answers them.

## Project 1 — Android

The same screens in the phone layout of the mockups: Home with the shortcut grid and shelves, Search
with genre cards, Your Library, album/artist/playlist pages, glass mini player tinted by the
album, glass tab bar, Now Playing screen (colour gradient, big art, title + heart, seek, controls
with the white round play, queue/share row, lyrics card) that opens the lyrics view. Same features.

## Build order and checks

1. Tokens, font, base styles (DS-01 kept).
2. Frame: top bar, panels, glass player pill, compact tab bar and mini player; routes (`/` Home,
   `/listen`, `/playlist/:id`, `/collection/tracks`, `/genre/:name`).
3. Pages: Home, Library panel, Album, Artist, Playlist, Liked Songs, Search + genres, Queue / Now
   Playing panel, Settings/auth restyle.
4. Lyrics view layout.
5. Features: hearts, playlists, radio + autoplay, artist info, genres, sleep timer (server proxy +
   mock + client).
6. Unit tests and E2E updated; visual baselines regenerated in the CI image
   (`scripts/e2e-container.sh`); deploy the web app (`~/docker/echo`).
7. Android, then the APK.
8. Projects 2, 3, 4.

Each step: `pnpm check` green, commit, continue.
