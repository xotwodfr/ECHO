# ECHO for Windows

A native Windows client for an ECHO server that looks and works like **Cider 1.6.4**
([github.com/ciderapp/Cider](https://github.com/ciderapp/Cider), the last open-source Cider, AGPL-3.0
like ECHO), without what needs Apple Music. Avalonia 12 on .NET 10. Server: `https://echo.folk3s.com`,
`ECHO_URL` for another.

Avalonia, not WPF or WinUI 3: it builds *and runs* on the Linux dev box, so every screen can be seen
and tested before it reaches Windows, and the Windows CI runs the real exe.

## Where the look comes from

Cider 4 (cider.sh today) is closed source; Cider 1 is the code the owner pointed to. Its sizes, colours
and layouts are taken from `src/renderer/style.less`, `less/*.less` and the templates in
`views/app`, `views/components`, `views/pages`; each class here names the Cider file it follows.
Cider's font, Pretendard (OFL, `App/Assets/Fonts`), and its own icons (Feather MIT, Font Awesome Free
CC BY 4.0, VS Code codicons CC BY 4.0, `App/Ui/Icons.cs` made by `tools/icons.py` from Cider's SVGs). The
logo is ECHO's.

Two departures, both for ECHO's rule against live blur: Cider's `backdrop-filter` surfaces (the drawer,
the menus, settings) are the colour that blur gives over its dark pages, opaque; its blurred artwork
backgrounds are baked once per cover. The window sits on Windows 11's Mica, which Windows draws.

## What it does

- **Sign in** with username, password and, with two-factor on, the code (`POST /api/v1/auth/device`);
  the device token is kept for this Windows user (DPAPI, `%LOCALAPPDATA%\ECHO`). **Sign out** ends the
  device's session on the server too.
- Cider's two layouts (Settings → Visual): **Mojave**, its default (tabs in the top chrome, the player at
  the bottom), and **Maverick** (the player in the top chrome).
- **Home**: Recently Played (ECHO's play history), Your Favorites (starred songs), Made For You (ECHO's
  mixes). **Library**: Recently Added, Songs, Albums (search, sort), Artists (Cider's split view), the
  playlists, Create New. **Album / playlist / mix** pages, **artist** pages, **search**.
- Playback through the queue: shuffle, repeat, volume, seek; scrobbles; the queue follows you across
  devices (`/me/queue`, cut to the server's 64 KB as the web cuts it; the position alone when the
  queue has not changed). A read the network dropped is asked again, twice at most. A song whose connection drops or
  goes quiet carries on from where it got to; a server that fails is said so, not skipped through. The
  **drawer**: the queue (its first hundred, and how many more) and history.
- **The next song is made ready while this one plays** (its request answered, cover art jumped, decoder open,
  download running), so Next and the end of a song start it at once instead of from a cold request; it is
  let go if the queue, Shuffle or Repeat change what comes next.
- **Windows' media controls**: the keyboard's media keys and a headset's buttons, and the song with its
  cover and time in the volume flyout and on the lock screen (`Ui/MediaControls.cs`).
- **Love** and **Unlove** for songs, albums and artists, knowing what is loved already.
- Kept between runs (`prefs.json`): the volume, the window's place and size (maximized too), the sidebar
  hidden or shown. An error nothing caught goes to `crash.log` beside it, with the version.
- **Lyrics** as Apple Music draws them, the look of Lyricify's Apple Music style with the numbers of
  AMLL (`App/Lyrics`; Apple Music-like Lyrics, github.com/amll-dev/applemusic-like-lyrics, AGPL-3.0,
  its numbers ported, not its code): the first line lit a third of the way down, each line on its own
  spring so the column ripples when the line changes; a line lit until a later one begins after it
  (duet lines light together), white where sung and half-bright to come, the light crossing each word
  with a soft edge; lines not lit dim, shrunk to 97 % and blurred 1 px plus a px a line away; each word
  rising as it is sung, and a held word (1 s or more, 2-7 letters) swelling, spreading and glowing
  letter by letter; background vocals sliding out under their line while it is sung, duets on
  opposite sides, interlude dots; click to seek.
- The **lyrics page**, where Spicy Lyrics puts it in Spotify: the lyrics button swaps the page for the
  lyrics on the cover's flowing background, the cover, title and artist beside them, with Full Screen
  and Close (Escape, or going to another page, closes it too).
- The **full-screen lyrics** as Apple Music lays them out (the cover with the title, artist and "…"
  under it, a thin progress bar with the time left, Apple's controls, a pill to go back; the lyrics
  beside it, over the cover's flowing colours) and Cider's **mini player**, from the artwork's
  popover. **Performance mode** (Settings → Visual), for slower computers: no blur or glow on the
  lyrics, and a still background.
- Album pages take their cover's colour; pages and the drawer move in as Cider's do.
- Where Apple Music does it better, its layout inside Cider's look: song tables (striped, columns,
  play on hover), the album header (artist in the page's colour, GENRE · YEAR), Home's shelves (Top
  Picks, Recently Played), the library grid, the artist banner, search's Top Results, Cider 4's queue
  drawer, red sidebar icons.
- Today's finish over Cider's layout: the page floats as a rounded card on the window's ground, the
  top bar has a round Home beside a wide search pill, the player bar is laid out as current players are
  (the controls over a thin progress bar, Play a white disc), album headers fade into their songs,
  Settings opens over a dimmed app in Windows 11's setting cards, menus are dark and rounded, empty
  pages say so centred, the sign-in screen is a card (and can be moved and closed).
- Keys: **Space** plays or pauses (not while typing; in full screen and the mini player too), **Ctrl+F**
  goes to the search field; keyboard focus shows as a rounded ring.

Left out as Apple Music's: Listen Now, Browse, Radio, Videos, Podcasts, Apple Music playlists, Add to
Library, Autoplay, Start Radio, Cast/AirPlay, social and Replay.

## Layout

| Folder | What |
|---|---|
| `App/Api` | The server: device token, songs from the stream endpoint (Range requests skip cover art), covers (the token goes to the server only); the models |
| `App/Library` | The library through the Subsonic proxy; lyrics; which formats play as stored |
| `App/Playback` | Audio out (SoundFlow, miniaudio), the queue and the player |
| `App/Ui` | Cider's window: `Shell`, `ChromeTop`, `Sidebar`, `ChromeBottom`, `Drawer`, the pages, `ModeViews`, `Menus`; `Cider.axaml` its colours and controls |
| `App/Fixtures.cs` | A built-in ECHO server and library for `--smoke`, the tests and the screenshots |
| `Tests` | xUnit: the library, queue, player, and every screen rendered headless |

## Build, test, run

With the .NET 10 SDK, on Linux or Windows:

```sh
dotnet test Windows/Tests
ECHO_SHOTS=/tmp/shots dotnet test Windows/Tests   # also saves each screen as a PNG, 1336×768
dotnet run --project Windows/App -f net10.0     # the dev box (needs a display)
dotnet publish Windows/App -c Release -f net10.0-windows10.0.19041.0 -r win-x64 --self-contained \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o Windows/publish
```

`ECHO.exe --smoke` opens the shell on the built-in library and exits 0 after 8 s. The Windows workflow
(`.github/workflows/windows.yml`) runs the tests and the smoke run on `windows-latest` and keeps a
screenshot as the `smoke` artifact; a `windows-v*` tag publishes the exe as a pre-release with
`Windows/RELEASE.md` as its notes, which is then made a normal release and marked Latest
(`gh release edit <tag> --prerelease=false --latest`).

(Earlier Windows apps stay on their branches as references: `windows-glass`, the liquid-glass app, and
the plain baseline this one grew from, `windows-v2.0.0`.)
