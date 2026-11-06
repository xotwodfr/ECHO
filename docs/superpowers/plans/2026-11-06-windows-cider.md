# ECHO for Windows as Cider 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Windows app (branch `windows-baseline`) looks and works exactly like Cider 1.6.4 (github.com/ciderapp/Cider, AGPL-3.0, the last open-source Cider), minus everything that needs Apple Music.

**Architecture:** Avalonia 12 / .NET 10, as the baseline. The library, queue and player logic come from `windows-glass` (Library.cs, Models.cs, Queue.cs, Player.cs, Covers.cs, CoverImage.cs, Lyrics.cs, Fixtures.cs). The look comes from Cider 1's source: `src/renderer/style.less`, `less/*.less`, `views/app/*.ejs`, `views/components/*.ejs`, `views/pages/*.ejs`; its default layout, "Mojave" (`windowLayout: "twopanel"`): top chrome with tabs, collapsible sidebar, player bar at the bottom, floating drawer for queue and lyrics.

**Tech Stack:** Avalonia 12.1.5, CommunityToolkit.Mvvm, SoundFlow, xUnit v3 + Avalonia.Headless (Skia).

**Spec:** the owner's words (2026-11-06): "i want the windows app to be exackt replica of https://cider.sh/, excludign the apple music only features" → "i want it look the exact same" → "look at cider 1.00 soruce code then". Cider 4 (cider.sh today) is proprietary; Cider 1 is the open source the owner pointed to.

## Global Constraints

- Values come from Cider 1's LESS, not guesses: key colour `#fc3c44`, text `#eee`, base `#1e1e1e` at 50 %, sidebar `#2e2e2e` at 50 %, app `rgba(20,20,20,.7)`, drawer 300 px / radius 12, sidebar 260 px, media radius 8, panel radius 10.
- Font: Pretendard (Std, OFL, `Assets/Fonts`, with its licence). Icons: Cider 1's own — Feather (MIT) for navigation, Font Awesome Free 5 (CC BY 4.0) for playback — as path geometry.
- Left out (Apple Music only): Listen Now, Browse, Radio, Apple Music playlists, Podcasts, Apple account/curator/social pages, AirPlay/cast, MusicKit lyrics/translations, Spatial/PPE badges. The tabs keep Home.
- Credit: Windows/README.md names Cider 1 (Cider Collective, AGPL-3.0) as the design source; ECHO is AGPL-3.0-only too.
- No live blur (owner, 2026-10-29): Cider's `backdrop-filter` becomes the flat colour under it; the fullscreen background is the cover blurred once per song.
- Every screen is checked against Cider 1's own screenshots (`src/renderer/assets/oobe/mojave.png`, `maverick.png`, 1336×768) with a headless render at the same size.

## Review Focus

- A long title or artist in the player bar or a row: ellipsis, never overflow (Cider: `text-overflow-elipsis`).
- No server / a refused token mid-session: the bar says so, sign-in comes back (baseline behaviour kept).
- A song with no lyrics: the lyrics button is dimmed to 30 % and does nothing (Cider's rule).
- An album with no cover: Cider's MissingArtwork look, not a hole.
- The window at its minimum (1024×640): the tabs, search and controls still fit.

---

### Task 1: Foundation — tokens, font, icons, the frameless window, the ported logic

**Files:** Create `App/Ui/Cider.axaml` (tokens, icons, control themes), `App/Assets/Fonts/*`; port from windows-glass `Api/Models.cs`, `Library/Library.cs`, `Playback/Queue.cs`, `Playback/Player.cs`, `Ui/Covers.cs`, `Ui/CoverImage.cs`, `Fixtures/Fixtures.cs`, `Stage/Lyrics/Lyrics.cs` (to `Library/Lyrics.cs`); modify `Echo.csproj`, `App.axaml`, `Program.cs`.
- [ ] Tests: the ported LibraryTests/QueueTests/PlayerTests from windows-glass pass; `TheWindowOpens` asserts the window draws its own chrome.
- [ ] Build, test, commit.

### Task 2: The shell — top chrome, sidebar, content, bottom player

**Files:** Create `App/Ui/Shell.cs` (layout + navigation history), `App/Ui/ChromeTop.cs`, `App/Ui/Sidebar.cs`, `App/Ui/ChromeBottom.cs`; replace `LibraryView.cs`.
- [ ] Test: after sign-in the shell shows Home, the sidebar lists Recently Added/Songs/Albums/Artists and the server's playlists; Back after opening an album returns to the page before; the bar shows the playing song and its time.
- [ ] Render 1336×768 beside `mojave.png`/`maverick.png`; fix what differs.
- [ ] Commit.

### Task 3: Collection page (album, playlist)

**Files:** Create `App/Ui/CollectionPage.cs` (cider-playlist.ejs: header with 260 px art, title, artist, Play/Shuffle/Add; rows: number, title, artist — album, duration).
- [ ] Test: opening an album lists its songs; double-click plays from that song; Shuffle plays shuffled.
- [ ] Commit.

### Task 4: Library pages and Home

**Files:** Create `App/Ui/LibraryPages.cs` (library-songs, library-albums (mediaitem-square grid), library-artists, library-recentlyadded), `App/Ui/HomePage.cs` (home.ejs minus Apple sections).
- [ ] Test: each page loads from the fixtures' server answers; an album square opens its collection page.
- [ ] Commit.

### Task 5: Search and the artist page

**Files:** Create `App/Ui/SearchPage.cs` (search.ejs), `App/Ui/ArtistPage.cs` (artist.ejs).
- [ ] Test: typing in the chrome search shows songs/albums/artists; an artist opens with their albums and top songs.
- [ ] Commit.

### Task 6: The drawer — queue and lyrics

**Files:** Create `App/Ui/Drawer.cs` (panels.ejs, queue.ejs, lyrics-view.ejs).
- [ ] Test: the queue button opens the queue listing Up Next; the lyrics button is dimmed without lyrics, opens synced lyrics with the active line lit.
- [ ] Commit.

### Task 7: Fullscreen and mini player

**Files:** Create `App/Ui/FullscreenView.cs` (fullscreen.ejs), `App/Ui/MiniPlayer.cs` (miniplayer.ejs).
- [ ] Test: the artwork popover's buttons switch modes; Escape returns.
- [ ] Commit.

### Task 8: Main menu, settings, Maverick layout

**Files:** Create `App/Ui/MainMenu.cs` (usermenu), `App/Ui/SettingsView.cs` (settings-window.ejs, the parts that apply), `App/Prefs.cs`; Maverick variant of ChromeTop.
- [ ] Test: Settings → Layout switches Mojave/Maverick and it is kept; Sign out signs out.
- [ ] Commit.

### Task 9: Docs, CI, release

- [ ] README/RELEASE, smoke screenshots of the shell; Windows CI green; tag `windows-v3.0.0` pre-release.
