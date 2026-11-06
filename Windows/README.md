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
  devices (`/me/queue`). The **drawer**: the queue (and history) and synced **lyrics**, word by word.
- Cider's **fullscreen view** and **mini player**, from the artwork's popover.

Left out as Apple Music's: Listen Now, Browse, Radio, Videos, Podcasts, Apple Music playlists, Add to
Library, Autoplay, Start Radio, Cast/AirPlay, social and Replay.

## Layout

| Folder | What |
|---|---|
| `App/Api` | The server: device token, signed stream URLs, covers (the token goes to the server only); the models |
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
screenshot as the `smoke` artifact; a `windows-v*` tag publishes the exe as a pre-release.

(Earlier Windows apps stay on their branches as references: `windows-glass`, the liquid-glass app, and
the plain baseline this one grew from, `windows-v2.0.0`.)
