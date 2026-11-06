# ECHO for Windows with liquid glass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Windows ECHO (one `ECHO.exe`) with clear liquid glass, the Listen room for a second monitor, and the web's Navidrome features. It is released through GitHub pre-releases.

**Architecture:** An Avalonia 12 app on .NET 10 in `Windows/App`, ported module by module from the Android app; the pure modules keep Android's names. Glass is a Skia runtime shader that refracts a snapshot of what is under each glass panel, using the 10-28 bend model. The room runs the web's GLSL shaders in Avalonia's OpenGL control. Audio uses SoundFlow (miniaudio) with a sample tap for the FFT features.

**Tech Stack:** .NET 10 (SDK 10.0.113), Avalonia 12.1.5 (+ Desktop, Skia, Themes.Fluent, Headless.XUnit), SkiaSharp 3.119 (from Avalonia), SoundFlow 1.4.2, CommunityToolkit.Mvvm 8.4.2, xUnit, GitHub Actions `windows-latest`.

**Spec:** `docs/superpowers/specs/2026-11-06-windows-glass-design.md`

## Global Constraints

- Platforms: Windows 10 (1809+) and 11, x64. The dev box runs the `net10.0` target only (Linux, no X server).
- Target frameworks: `net10.0` (dev, tests) and `net10.0-windows10.0.19041.0` (the exe, SMTC). `EnableWindowsTargeting=true`.
- Default server `https://echo.folk3s.com`; `ECHO_URL` overrides it. Device token: DPAPI file `%LOCALAPPDATA%\ECHO\token` on Windows; a 0600 file `$XDG_STATE_HOME/echo-windows/token` on Linux.
- Dark only. Font: `Segoe UI Variable Text, Segoe UI, Inter`.
- Glass A defaults: thickness 24, bezel 20, IOR 1.5, refraction 1.0, specular 0.5, light 135°, saturate 1.5, frost ≤ 1 px, fill about 10% dark tint. The bend band has a fixed width in DIPs.
- The lyrics are never under glass. Rendering stops when minimised or fully covered; audio and SMTC continue.
- Never above the display's refresh rate. Android's governor tiers apply.
- Formats: FLAC, MP3 and WAV play as stored. Everything else is requested as MP3 320 (the existing `stream-url` rule).
- No server changes. Tests use built-in fixtures or a throwaway server, never echo.folk3s.com.
- The repo is public: no tokens, keys or personal data in commits.
- Branch `windows-glass`. Push the branch and `windows-v*` tags (agreed delivery); merging to `main` waits for the owner.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Same words as the web (`src/client/strings.ts`) wherever a screen exists on both.

## Review Focus

1. **A revoked or expired device token (HTTP 401) mid-session:** playback stops, the queue clears, and the sign-in screen returns with "You were signed out." There is no crash or retry loop. Pinned in Task 8.
2. **The server unreachable at start or mid-song:** an offline state with Retry. The current song keeps playing from what is buffered. Pinned in Task 8 (Player) and Task 16 (states).
3. **A song in a format miniaudio cannot decode (M4A/AAC, Opus, Ogg, WMA):** it is requested as MP3 320, never fed raw to miniaudio. Pinned in Task 7 (`StreamFormat`).
4. **A song with no lyrics, unsynced lyrics only, or no cover art:** Missing / unsynced text / the DS §8 fallback square. Never blank, never a throw. Pinned in Tasks 10 and 13.
5. **The remembered full-screen monitor is gone (unplugged, or a different layout after a game changes the resolution):** the window opens on the primary monitor. Pinned in Task 11.

---

## Stage 1 — Prove it (pre-release `windows-v0.1.0`)

### Task 1: Avalonia app and test project replace the WPF baseline

**Files:**
- Delete: `Windows/App.xaml`, `Windows/App.xaml.cs`, `Windows/MainWindow.xaml`, `Windows/MainWindow.xaml.cs`, `Windows/Echo.csproj`
- Move: `Windows/Api.cs` → `Windows/App/Api/Api.cs`, `Windows/TokenStore.cs` → `Windows/App/Api/TokenStore.cs` (namespace `Echo.Api`)
- Create: `Windows/App/Echo.csproj`, `Windows/App/Program.cs`, `Windows/App/App.axaml(.cs)`, `Windows/App/Ui/Theme.axaml`, `Windows/App/Ui/MainWindow.axaml(.cs)`
- Create: `Windows/Tests/Echo.Tests.csproj`, `Windows/Tests/TestApp.cs`, `Windows/Tests/StartupTests.cs`
- Modify: `.gitignore` (`Windows/**/bin/`, `Windows/**/obj/` exist; add `Windows/publish/`)

**Interfaces:**
- Produces: `Echo.Api.Api(string baseUrl)` and `Echo.Api.TokenStore` (behaviour unchanged). `Echo.Ui.MainWindow : Window` (Title "ECHO", min size 1024×640, background `Ground`). `Theme.axaml` brushes: `Ground #0B0B10`, `Surface1 #15151C`, `Text #FFFFFF`, `Muted #FFFFFF99`, `Focus #FFFFFF`. `Echo.Program.Main(string[] args)` parses `--smoke` (bool) into the static `Echo.App.Smoke`.

- [ ] **Step 1: Write the failing test** `StartupTests.MainWindowOpens`, an `[AvaloniaFact]`. Create a `MainWindow`, `Show()` it, and assert `Title == "ECHO"` and `MinWidth == 1024`.
- [ ] **Step 2: Run it.** `dotnet test Windows/Tests` → FAIL (no project).
- [ ] **Step 3: Create the projects.** `Echo.csproj`: `OutputType WinExe`, `AssemblyName ECHO`, `TargetFrameworks net10.0;net10.0-windows10.0.19041.0`, `Nullable enable`, `ApplicationManifest` omitted. PackageReferences: Avalonia, Avalonia.Desktop, Avalonia.Skia, Avalonia.Themes.Fluent (12.1.5), Avalonia.Fonts.Inter (12.1.5), CommunityToolkit.Mvvm 8.4.2, SoundFlow 1.4.2. Tests: `net10.0`, xunit, xunit.runner.visualstudio, Microsoft.NET.Test.Sdk, Avalonia.Headless.XUnit 12.1.5, and a ProjectReference to App with `SetTargetFramework=TargetFramework=net10.0`. `TestApp.cs` holds `[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]`, with `UseHeadless(new() { UseHeadlessDrawing = false })` and Skia, so the pixels are real. FluentTheme is `RequestedThemeVariant="Dark"`.
- [ ] **Step 4: Run it.** `dotnet test Windows/Tests` → PASS. `dotnet build Windows/App -f net10.0-windows10.0.19041.0` → 0 warnings.
- [ ] **Step 5: Commit** "Windows: Avalonia app and tests replace the WPF baseline".

### Task 2: Liquid glass

**Files:**
- Create: `Windows/App/Glass/GlassMath.cs`, `Windows/App/Glass/glass.sksl` (EmbeddedResource), `Windows/App/Glass/GlassShader.cs`, `Windows/App/Glass/GlassPanel.cs`
- Test: `Windows/Tests/GlassTests.cs`

**Interfaces:**
- Produces:
  - `record GlassParams(double Thickness = 24, double Bezel = 20, double Ior = 1.5, double Refraction = 1.0, double Specular = 0.5, double Light = 135, double Saturate = 1.5, double Frost = 0.75, double Tint = 0.10)`
  - `static class GlassMath { double Rim(double t); double Bend(GlassParams g, double t); float[] BendProfile(GlassParams g, int n = 32); }`. Port `rim`, `bend` and `bendProfile` from `git show 8cbc0bb^:src/client/ui/glass.ts`.
  - `GlassPanel : Decorator`, with StyledProperties `CornerRadius CornerRadius`, `GlassParams Params`, `double Darken` (0…1, the adaptive tint added on top of `Tint`; Task 15 drives it). It renders the glass through an `ICustomDrawOperation`, then its child.
  - `static bool GlassPanel.Enabled` (default true; false → opaque `Surface1` fill, Task 15).
- Shader contract (`glass.sksl`): `uniform shader backdrop; uniform float2 size; uniform float4 radii; uniform float bezel; uniform float profile[32]; uniform float2 light; uniform float specular; uniform float saturate; uniform float tint; half4 main(float2 p)`. It computes the rounded-box depth and the outward normal exactly as `glassMaps` does in the old `glass.ts`. Where depth < bezel it samples `backdrop` at `p - normal * profile[t*31]` (linear interpolation between steps). Then saturation, then the dark tint, then the rim light `specular * |dot(n, light)| * (1-t)^6` in white.
- Backdrop: in `Render`, lease `ISkiaSharpApiLeaseFeature`, take `lease.SkSurface.Snapshot(deviceBounds)` and use it as the `backdrop` child through `ToShader()`, with the local matrix mapping device to local. If `SkSurface` is null, draw `Surface1` at 85% and log once.

- [ ] **Step 1: Write the failing tests.**
  - `BendMatchesTheWeb`: `GlassMath.Bend(new(), t)` for `t` in {0, 0.25, 0.5, 0.75, 1} equals the old `glass.ts` values to 1e-9. Get the expected numbers by running the old function with node and paste them as literals.
  - `ProfileIsEdgeFirstAndScaled`: `BendProfile(new(Refraction: 2), 32)[0] == 2 * Bend(new(), 0)` and `.Length == 32`.
  - `[AvaloniaFact] GlassBendsTheRimAndLeavesTheCentre`: a 400×200 window, background 1-px black/white vertical stripes, a 200×100 `GlassPanel` (radius 24) centred. Capture `window.CaptureRenderedFrame()`. Assert that the pixel 4 px inside the panel's left edge does **not** match the stripe there (refracted). Assert that the pixel at the panel's centre has luminance within 15% of the background's, darkened by the tint (not refracted, only tinted).
- [ ] **Step 2: Run them.** `dotnet test Windows/Tests --filter Glass` → FAIL.
- [ ] **Step 3: Implement** `GlassMath`, `glass.sksl`, `GlassShader` (compiles once with `SKRuntimeEffect.BuildShader`; throws with the compiler error text on failure) and `GlassPanel`.
- [ ] **Step 4: Run them.** `dotnet test Windows/Tests --filter Glass` → PASS. Save a capture of the stripe test to the scratchpad and look at it: the rim bends and the rim light shows top left.
- [ ] **Step 5: Commit** "Windows: liquid glass from the 10-28 bend model".

### Task 3: The room (ported stage logic, GL renderer)

**Files:**
- Create: `Windows/App/Api/Oklab.cs`, `Windows/App/Stage/StagePalette.cs`, `Windows/App/Stage/Features.cs`, `Windows/App/Stage/Reverb.cs`, `Windows/App/Stage/Governor.cs`, `Windows/App/Stage/StageRenderer.cs`, `Windows/App/Stage/StageView.cs`, `Windows/App/Stage/FallbackRoom.cs`
- Modify: `Windows/App/Echo.csproj`: `<EmbeddedResource Include="../../Android/app/src/main/assets/stage/*.glsl" LogicalName="stage.%(Filename).glsl" />` and the blue-noise texture from `Android/app/src/main/res/drawable*/blue_noise_64.png`
- Test: `Windows/Tests/PortsTests.cs`, `Windows/Tests/ShaderTests.cs`

**Interfaces:**
- Consumes: Android sources of the same names (port line for line; keep constants and comments' references).
- Produces:
  - `Oklab`: `record struct Linear(float R, float G, float B, float A = 1)`, `double[] OklabToLinear(double l, double a, double b)`, `double[] LinearToOklab(double r, double g, double b)`, `double SrgbToLinear(double c)`, `double LinearToSrgb(double c)`, `Linear ParseCss(string css)`.
  - `record StagePalette(Linear Room, Linear Accent, Linear Highlight, Linear Glow, Linear Shadow, Linear InkActive)` with `static StagePalette Fallback` and `static StagePalette Of(Palette p)` (`Palette` is from Task 7; until then a local record of the five CSS strings).
  - `record Features(...)` (Android's fields) with `static Features Silent`, and `class AnalyserFeatures(AudioTap tap) { Features Sample(double dtMs); }` (`AudioTap` from Task 4; build this task against its interface `int ReadAudible(Span<float> mono, out int sampleRate)`). `internal static void Fft(double[] re, double[] im)`.
  - `enum Intensity`, `class Reverb(Intensity s = Intensity.Expressive, long seed = 1) { ReverbFrame Step(Features f, double dtMs, double keyX, double keyY); }`.
  - `enum Tier`, `class Governor(Tier tier, bool manual, Func<double> now) { Tier? Sample(double dtMs, double trackMs, bool scrubbing); }`, `static Tier FirstTier(string? renderer)`.
  - `record FrameInput(float Flow, float Drift, float Cover, float KeyX, float KeyY, float Chrome, float Seed, ReverbFrame? Reverb)`.
  - `class StageRenderer { void Init(GlInterface gl, bool es); void SetSize(int w, int h, double scale); void SetTier(Tier t); void SetPalette(StagePalette p); void SetBrightness(float b); void SetCover(SKBitmap? blurredCover); void Draw(FrameInput f); void Dispose(); }`. Shader header: `"#version 300 es\n"` when `es` (ANGLE on Windows), else `"#version 330 core\n"` (desktop GL), the rest byte-identical.
  - `enum RoomMode { Ambient, Reverb, Still }` and `class StageView : OpenGlControlBase` with properties `RoomMode Mode`, `Intensity Intensity`, `float Brightness`, `StagePalette Palette` (crossfaded over 1200 ms in OKLab, as Android does), `bool Chrome`, `SKBitmap? Cover`, `bool Playing`, `Func<double> TrackMs`, and `event Action<Tier> TierChanged`. `RequestNextFrameRendering` runs only while visible (Task 11 adds the occlusion check).
  - `FallbackRoom : Control` draws the palette's room colour as a radial gradient. `StageView` swaps itself for it when GL init throws (headless, no GL).

- [ ] **Step 1: Write the failing tests**, ported from `Android/app/src/test/kotlin/com/folk3s/echo/PortsTest.kt` with the same names and assertions:
  - `ReverbNeverChangesTheLightFasterThanThePhotosensitivityLimit`
  - `CssColoursParseLikeTheWebs`
  - `TheFftFindsASineInItsBin`
  - Plus `GovernorStepsDownAfterSlowFrames`: feed 1200 ms of 40 ms frames at `Tier.T0`, expect `T1`.
  - Plus `ShaderTests.EveryStageShaderIsEmbedded`: for each Android `.glsl`, the embedded resource `stage.<name>.glsl` equals the file's text.
- [ ] **Step 2: Run them.** `dotnet test Windows/Tests --filter "Ports|Shader"` → FAIL.
- [ ] **Step 3: Port** Oklab, StagePalette, Features, Reverb, Governor (pure). Then StageRenderer and StageView from `StageRenderer.kt`/`StageView.kt`: Avalonia's `GlInterface` replaces `GLES30`, and `OnOpenGlInit`, `OnOpenGlRender` and `OnOpenGlDeinit` replace the `GLSurfaceView.Renderer` callbacks. Then FallbackRoom.
- [ ] **Step 4: Run them.** `dotnet test Windows/Tests` → PASS. The GL path is verified by the Task 6 smoke screenshot.
- [ ] **Step 5: Commit** "Windows: the room, ported from Android, on the shared shaders".

### Task 4: Audio out with a sample tap

**Files:**
- Create: `Windows/App/Playback/AudioTap.cs`, `Windows/App/Playback/AudioOut.cs`
- Test: `Windows/Tests/AudioTests.cs`

**Interfaces:**
- Produces:
  - `sealed class AudioTap { const int LatencyMs = 120; void Write(ReadOnlySpan<float> interleaved, int channels, int sampleRate); int ReadAudible(Span<float> mono, out int sampleRate); }`. It is a mono ring of the last ~1.5 s with timestamps, ported from Android's `AudioTap.kt`. `LatencyMs` is a starting estimate for WASAPI shared mode; the constant carries a `ponytail:` comment saying to measure it on Windows.
  - `sealed class AudioOut : IDisposable { AudioOut(AudioTap tap, bool nullDevice = false); Task Open(string url); void Play(); void Pause(); void Seek(TimeSpan t); TimeSpan Position { get; } TimeSpan Duration { get; } float Volume { get; set; } bool Muted { get; set; } event Action? Ended; event Action<Exception>? Failed; }`. It is built on SoundFlow's `MiniAudioEngine` (`MiniAudioBackend.Null` when `nullDevice`), a `NetworkDataProvider` for URLs (`StreamDataProvider` for `file://` paths in tests), a `SoundPlayer` on the master mixer, and an analyzer or modifier on the player that calls `tap.Write`. Find SoundFlow 1.4.2's exact constructors by reflecting over `~/.nuget/packages/soundflow/1.4.2` (the scratchpad probe in this session shows the type list).
- [ ] **Step 1: Write the failing test** `TheTapHearsTheSong`: write a 2 s, 1 kHz, 44.1 kHz stereo WAV to a temp file. Open it with `new AudioOut(tap, nullDevice: true)`, `Play()`, wait 600 ms. `new AnalyserFeatures(tap)`'s FFT peak bin is within ±1 bin of 1000 Hz. Then `Pause()`: `Position` stops advancing (two reads 200 ms apart are equal).
- [ ] **Step 2: Run it.** `dotnet test Windows/Tests --filter Audio` → FAIL.
- [ ] **Step 3: Implement** AudioTap and AudioOut. If SoundFlow cannot do what the test needs (the null backend, a sample hook, HTTP streaming), stop and report: the spec allows swapping it, and that choice goes to the owner's design notes.
- [ ] **Step 4: Run it.** `dotnet test Windows/Tests --filter Audio` → PASS.
- [ ] **Step 5: Commit** "Windows: audio out through SoundFlow with the FFT tap".

### Task 5: Shell, sign-in, albums, an album, play: the first usable app

**Files:**
- Create: `Windows/App/Ui/Shell.axaml(.cs)` (sidebar, top capsules, player pill, content host), `Windows/App/Ui/SignInView.axaml(.cs)`, `Windows/App/Ui/AlbumsView.axaml(.cs)`, `Windows/App/Ui/AlbumView.axaml(.cs)`, `Windows/App/Ui/PlayerPill.axaml(.cs)`, `Windows/App/Ui/Covers.cs`, `Windows/App/Ui/Nav.cs`, `Windows/App/Fixtures/Fixtures.cs`
- Modify: `Windows/App/Api/Api.cs` (add `Task<Stream> GetStream(string path)` with the bearer header, for covers)
- Test: `Windows/Tests/ShellTests.cs`

**Interfaces:**
- Consumes: `Api`, `TokenStore`, `GlassPanel`, `StageView`, `AudioOut`, `AudioTap`.
- Produces:
  - `class Nav : ObservableObject { object Current; void Go(object page); void Back(); }`. The pages are view-model records: `AlbumsPage`, `AlbumPage(string Id)`, `ListenPage`.
  - `class Covers { Covers(Api api); Task<Bitmap?> Get(string? coverId, int size); }`, an LRU of 300 bitmaps (`ponytail:` LRU by count, by bytes if memory matters).
  - `static class Fixtures { Album[] Albums; Bitmap Cover(int i, int size); StagePalette Palette; }`. The covers are generated with Skia gradients, like the mockup's ten.
  - Layout as spec "Shell layout" (board A). Sidebar 192 wide, 12 inset, radius 22. Search capsule 220×34. Account 34. Player pill 560×66, radius 33, centred in the content area, 16 from the bottom. Content scrolls under all of them; the scroll padding keeps the last row clear of the pill.
- Sign-in reuses the WPF flow (username, password, two-factor code), with the same strings as the web's sign-in (`strings.ts`). The device name is "ECHO for Windows (<machine name>)".
- `--smoke` (from Task 1) skips sign-in, shows `AlbumsView` on `Fixtures` with the pill showing fixture song 0, opens `ListenPage` (StageView in Visual view, fixture palette) after 3 s, and exits with code 0 after 10 s.

- [ ] **Step 1: Write the failing tests.**
  - `[AvaloniaFact] SmokeShellShowsGlassOverCovers`: a MainWindow in smoke mode at 1280×800. The visual tree has 1 sidebar `GlassPanel`, 1 pill `GlassPanel` and ≥ 10 cover `Image`s. Capture the frame to the scratchpad.
  - `[AvaloniaFact] SignInShowsTheCodeFieldOnlyAfterTheServerAsks`: a fake `HttpMessageHandler` answers `401 {"code":"totp_required"}`, and the code field appears.
- [ ] **Step 2: Run them.** FAIL.
- [ ] **Step 3: Implement.** Look at the captured frame against board A (`.superpowers/brainstorm/*/content/glass-style-v2.html`) and fix spacing until it reads the same.
- [ ] **Step 4: Run them.** `dotnet test Windows/Tests` → PASS.
- [ ] **Step 5: Commit** "Windows: shell with glass, sign-in, albums, an album, play".

### Task 6: Windows CI, smoke screenshot, first pre-release

**Files:**
- Create: `.github/workflows/windows.yml`
- Modify: `Windows/README.md` (rewrite: Avalonia, build, run, download from Releases, SmartScreen note)

**Interfaces:**
- Workflow: `on: push` with `paths: ['Windows/**', 'Android/app/src/main/assets/stage/**', '.github/workflows/windows.yml']`, and `push: tags: ['windows-v*']`. Job `windows` on `windows-latest`, `permissions: contents: write`:
  1. `actions/setup-dotnet` 10.0.x.
  2. `dotnet test Windows/Tests`.
  3. `dotnet publish Windows/App -c Release -f net10.0-windows10.0.19041.0 -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish`.
  4. PowerShell: start `publish/ECHO.exe --smoke`, sleep 7 s, capture the primary screen with `System.Drawing` `CopyFromScreen` into `smoke.png`, `Wait-Process` with a 20 s timeout, and fail unless the exit code is 0.
  5. `actions/upload-artifact` `smoke.png` and `ECHO.exe`.
  6. On a tag only: `gh release create $tag publish/ECHO.exe --prerelease --title "ECHO for Windows $tag" --notes-file Windows/RELEASE.md`.
- Create `Windows/RELEASE.md`: what this stage does, and "Windows may say it protected your PC: More info → Run anyway."

- [ ] **Step 1:** Write the workflow and the README; commit "Windows: CI builds, smoke-tests and releases the exe".
- [ ] **Step 2:** `git push -u origin windows-glass` using the gh credential helper. Wait for the run: `gh run watch` → success.
- [ ] **Step 3:** `gh run download <id> -n smoke` and look at `smoke.png`: glass over the fixture covers, and the room drawn. A blank or black room means the GL path failed on ANGLE/WARP: fix it, push, and repeat.
- [ ] **Step 4:** `git tag windows-v0.1.0 && git push origin windows-v0.1.0`. The run creates the pre-release. Check `gh release view windows-v0.1.0` lists `ECHO.exe`.
- [ ] **Step 5:** Tell the owner the release link and what to try (sign in, play an album, open the room). Carry on with Stage 2 without waiting; fold their findings in when they arrive.

---

## Stage 2 — The Listen room (pre-release `windows-v0.2.0`)

### Task 7: Models and Library core

**Files:**
- Create: `Windows/App/Api/Models.cs`, `Windows/App/Api/Json.cs`, `Windows/App/Library/Library.cs`, `Windows/App/Library/StreamFormat.cs`
- Modify: `Windows/App/Api/Api.cs` (generic `Get`/`Send` returning `JsonNode`; `StreamUrl(Track t)`)
- Test: `Windows/Tests/LibraryTests.cs`

**Interfaces:**
- Produces: records mirroring `Android/…/api/Models.kt` with the same field names in PascalCase, serialised camelCase through a `JsonSerializerContext` in `Json.cs`: `Track` (with `Artist` and `Cover` computed), `ArtistRef`, `AlbumRef`, `Artwork`, `ReplayGain`, `Album` (`Key => "navidrome:" + Id`), `Playlist`, `ArtistCard`, `ArtistInfo`, `PlaylistDetail`, `Starred`, `QueueState`, `PlayContext`, `Palette`, `LyricWord`, `BackgroundLine`, `LyricLine`, `LyricsDoc`, `Mix`, `PlayedContext`.
  - `class Library(Api api) { Task<IReadOnlyList<Album>> Albums(AlbumSort sort, int offset = 0, int size = 60); Task<Album> Album(string id); Task<ArtistPage> Artist(string id); Task<IReadOnlyList<ArtistCard>> Artists(); Task<IReadOnlyList<Playlist>> Playlists(); Task<PlaylistDetail> Playlist(string id); Task<Starred> Starred(); Task<SearchResult> Search(string q); Task Star(StarKind kind, string id, bool on); Task<Palette?> Palette(string albumKey); }`, from `Library.kt`. `AlbumSort`, `StarKind`, `ArtistPage` and `SearchResult` as there.
  - `static class StreamFormat { static bool PlaysRaw(string? suffix); }`: true only for `flac`, `mp3`, `wav` (case-insensitive). `Api.StreamUrl` asks for raw when `PlaysRaw`, else `format=mp3&maxBitRate=320`.
- [ ] **Step 1: Failing tests.**
  - `ASubsonicAlbumBecomesTracksWithCoverAndIsrc`: parse a fixture `getAlbum` JSON (copy one from `src/server/navidrome/mock.ts`'s data). The track `Key == "navidrome:<id>"`, `Cover` is the `/api/v1/navidrome/cover/…?size=600` URL, and `Isrc` is read from a string *and* from an array.
  - `OnlyFlacMp3AndWavStreamRaw`: m4a, opus, ogg, wma, aac → MP3 320; FLAC, Mp3, wav → raw.
  - `ASavedQueueRoundTripsTheWebsShape`: the two cases of Android's `QueueTest`.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit "Windows: models and library from Android".

### Task 8: Queue and Player

**Files:**
- Create: `Windows/App/Playback/Queue.cs`, `Windows/App/Playback/Player.cs`
- Test: `Windows/Tests/QueueTests.cs`, `Windows/Tests/PlayerTests.cs`

**Interfaces:**
- Consumes: `AudioOut`, `Api`, `Library`, `QueueState`, `PlayContext`.
- Produces:
  - `enum Repeat { Off, All, One }`.
  - `sealed class Queue { IReadOnlyList<Track> History, NextUp, Context; Track? Now; PlayContext? Source; bool Shuffle; Repeat Repeat; void PlayList(IReadOnlyList<Track> list, int index, PlayContext ctx); Track? Advance(bool userSkip); Track? Back(); void PlayNext(Track t); void AddToQueue(Track t); void Move(int from, int to); void Remove(int index); void Clear(); void SetShuffle(bool on, Random rng); QueueState ToState(); static Queue FromState(QueueState s); }`. Next up plays before the context. `Repeat.One` replays only on an automatic advance; a user skip moves on. History is capped at 20 in `ToState`.
  - `sealed partial class Player : ObservableObject` with observable `Track? Track`, `bool Playing`, `bool Buffering`, `TimeSpan Position`, `TimeSpan Duration`, `string? Notice`, `bool SignedOut`. Methods: `PlayList`, `Toggle()`, `Next()`, `Previous()` (restart if > 3 s in), `Seek(TimeSpan)`, `PlayNext(Track)`, `AddToQueue(Track)`, `Task Restore()`, `Task SignOut()`. Server sync as `Playback.kt`: `PUT /me/queue` with `{queue, positionMs, baseUpdatedAt}`, debounced 2 s. On 409, "Your queue changed on another device." and the playing device keeps its queue. A scrobble (`/navidrome/rest/scrobble`) at half the song or 4 min. `/me/plays` is posted on start, as Android does.
- [ ] **Step 1: Failing tests.**
  - `NextUpPlaysBeforeTheContext`.
  - `RepeatOneRepeatsOnlyWhenTheSongEnds`.
  - `ShuffleKeepsTheCurrentSongAndEveryOtherOnce`.
  - `MoveAndRemoveIndexNextUp`.
  - `PlayerTests.A401StopsPlaybackAndSignsOut` (Review Focus 1): a fake handler returns 401 on the next call. `SignedOut` is true, `Playing` is false and the queue is empty.
  - `PlayerTests.AnOfflineServerKeepsTheSongPlaying` (Review Focus 2): the handler throws `HttpRequestException` on the queue PUT. `Playing` stays true and `Notice` is "Can't reach the server." (the web's string).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit "Windows: the queue and the player with the saved queue".

### Task 9: Lyrics, the pure port

**Files:**
- Create: `Windows/App/Stage/Lyrics/Config.cs`, `Springs.cs`, `Timing.cs`, `Beat.cs`, `Model.cs`
- Test: `Windows/Tests/LyricsPortsTests.cs`

**Interfaces:**
- Consumes: `LyricsDoc`, `LyricLine`, `LyricWord`, `Features`.
- Produces: the Kotlin files' declarations with the same names. `static class L` (Config, the nested classes as nested static classes), `Spring`, `SpringParams`, `Springs`, `Step(...)`, `Snap(...)`, `LineNormal(...)`, `Timeline`, `BuildTimeline(LyricsDoc)`, `FieldState FieldAt(Timeline, double t)`, `Beat`, `BeatTerms`, `VocalAt`, `GlowFor`, `Rect`, `Emphasis`, `Side`, `WordBox`, `LineBox`, `Mode`, `Inst`, `Dots`, `FieldModel(Timeline tl, List<LineBox> boxes, double dotsH)` with `Relayout(...)` and `Update(double t, double dt, bool playing, Mode mode, double W, double H, Features features, bool reduced)`, plus `OpacityAt`, `BlurAt`, `UnlitMixAt`, `SweepAt`, `LineEdges`, `WordMotion`, `WashAt`.
- [ ] **Step 1: Failing tests**, ported from `PortsTest.kt` with the same names and numbers:
  - `TheTimelineHandsOverBeforeEachLineAndCoalescesLinesTooCloseTogether`
  - `TheSweepEdgeCrossesEachWordInItsOwnTime`
  - `SpringsLandInTheSamePlaceAtAnyFrameRate`
- [ ] **Step 2:** FAIL. **Step 3:** Port line for line. **Step 4:** PASS. **Step 5:** Commit "Windows: the lyric field's model, ported from Android".

### Task 10: Lyrics fetch, layout and drawing

**Files:**
- Create: `Windows/App/Stage/Lyrics/Lyrics.cs`, `Layout.cs`, `LyricsField.cs`
- Test: `Windows/Tests/LyricsFieldTests.cs`

**Interfaces:**
- Consumes: `Api`, `Player`, the Task 9 model, `StagePalette`, `Features`.
- Produces:
  - `enum LyricsStatus { Idle, Waiting, Ready, Missing }`.
  - `sealed partial class Lyrics : ObservableObject { LyricsStatus Status; LyricsDoc? Doc; string? Credit; Lyrics(Api api, Player player); }`. It fetches `/lyrics?…` (`lyricsQuery` as Android), with a 250 ms debounce, a 6 s give-up → Missing, and a prefetch of the next song 2 s before the end.
  - `DocLayout MeasureDoc(SKFont font, LyricsDoc doc, IReadOnlyList<LyricLine> lines, float width, float fontPx)`. Shaping uses `SKShaper` (SkiaSharp.HarfBuzz, which Avalonia ships). It keeps `Graphemes`, `EmphasisOf`, `SplitBacking`, `SidesOf`, `LINE_HEIGHT 1.12`, `LINE_HEIGHT_CJK 1.2` and `BG_SIZE 0.62`. Width shrinks to `shrinkMax` before wrapping, since there is no width axis, like Figtree on Android.
  - `LyricsField : Control`: a custom draw op on its own frame clock. Each frame it calls `FieldModel.Update` with `player.Position + prefs.LyricOffsetMs`, then draws the depth (opacity, blur via `SKImageFilter.CreateBlur`), the sweep (a gradient shader per word between the lit and unlit ink), the glow, the emphasis, backing vocals, duets (sides), the interlude dots, the line washes, the unsynced text and the credit.
- [ ] **Step 1: Failing tests.**
  - `[AvaloniaFact] AFieldDrawsTheActiveLineLit`: a fixture doc of 3 timed lines, position mid-line-2. The capture's brightest text row lies within the band at `L.anchorY` ±5% of the height.
  - `NoLyricsMeansMissingNotBlank` (Review Focus 4): the handler answers 404, and after 6 s of fake time `Status == Missing`.
  - `UnsyncedLyricsShowAsText`.
- [ ] **Step 2:** FAIL. **Step 3:** Port and draw; compare the capture with the web's lyrics (a screenshot of `/` in the web with the mock song is fine). **Step 4:** PASS. **Step 5:** Commit "Windows: the lyric field".

### Task 11: The Listen room screen

**Files:**
- Create: `Windows/App/Ui/ListenView.axaml(.cs)`, `Windows/App/Ui/ListenChrome.axaml(.cs)`, `Windows/App/Ui/Screens.cs`
- Modify: `Windows/App/Ui/MainWindow.axaml.cs` (full screen, monitor memory, occlusion)
- Test: `Windows/Tests/ListenTests.cs`

**Interfaces:**
- Consumes: `StageView`, `LyricsField`, `Player`, `Library.Palette`, `GlassPanel`, `Covers`.
- Produces:
  - `enum StageViewMode { Lyrics, Cover, Visual }`. `ListenView` layers StageView, then LyricsField or the cover (DS §8 sizes, opacity crossfade 420/640 ms), then `ListenChrome`. The chrome is a glass top bar (back, view switch, queue, full screen) and a glass transport, and hides after 3 s of play, coming back on pointer move or a key. There is no sidebar.
  - Palette: `Library.Palette(album.Key)` → `StageView.Palette`. The blurred cover for the room is made once per album (96 px, 5 px blur, from `coverBitmap` in `StageView.kt`).
  - `static class Screens { PixelPoint? Remembered; Screen Pick(IReadOnlyList<Screen> all, PixelPoint? remembered); }` returns the screen containing `remembered`, else the primary (Review Focus 5). Full screen comes from `F`, F11 or a double-click on the room. `Esc` leaves it. The window's position is saved in prefs on leaving full screen and on close.
  - Occlusion: StageView and LyricsField stop requesting frames when `WindowState == Minimized`, or when the window is fully covered. On Windows that is `IsWindowVisible` / `DwmGetWindowAttribute(DWMWA_CLOAKED)` plus a 1 s `WindowFromPoint` sample of the client rect's centre and corners (`ponytail:` a 5-point sample, a real occlusion region if it misjudges). Elsewhere, minimised only.
- [ ] **Step 1: Failing tests.**
  - `PickFallsBackToThePrimaryScreen`: remembered (5000, 0) with screens at 0 and 1920 → primary; (2000, 10) → the second.
  - `[AvaloniaFact] ChromeHidesAfterThreeSecondsOfPlay`: fake clock; at 3.1 s the chrome's opacity is 0, and a pointer move brings it back.
  - `[AvaloniaFact] TheLyricsAreNeverUnderGlass`: for every `GlassPanel` in ListenView, its bounds do not intersect the active line's bounds in the fixture doc.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit "Windows: the Listen room, full screen on any monitor".

### Task 12: SMTC, media keys, second pre-release

**Files:**
- Create: `Windows/App/Playback/Smtc.cs` (compiled only for the Windows TFM: `#if WINDOWS`)
- Modify: `Windows/App/Playback/Player.cs` (calls `Smtc.Update`), `Windows/RELEASE.md`

**Interfaces:**
- Produces: `static class Smtc { void Attach(IntPtr hwnd, Player p); void Update(Track? t, bool playing, TimeSpan pos, TimeSpan dur, Bitmap? cover); }`. It uses `SystemMediaTransportControlsInterop.GetForWindow(hwnd)` (WinRT interop). Play/Pause/Next/Previous/seek-position map to the Player. The display updater has the title, artist, album and cover thumbnail (the PNG bytes as a `RandomAccessStreamReference`).
- [ ] **Step 1:** Implement. This cannot be unit-tested on Linux. `dotnet build -f net10.0-windows10.0.19041.0` must have 0 warnings, and the smoke run in CI must still exit 0 (Attach is called in smoke mode too).
- [ ] **Step 2:** Commit "Windows: media keys and the Windows media overlay". Push. CI must be green, with a fresh `smoke.png` showing the Listen room.
- [ ] **Step 3:** Tag `windows-v0.2.0` and push the tag; check the release. Tell the owner (sign in, play, full screen on the second monitor, media keys during a game).

---

## Stage 3 — Library and search (pre-release `windows-v0.3.0`)

### Task 13: Library pages and Home

**Files:**
- Create: `Windows/App/Ui/HomeView`, `ArtistsView`, `ArtistView`, `PlaylistsView`, `PlaylistView`, `StarredView`, `MixView` (`.axaml(.cs)` each), `Windows/App/Ui/TrackList.axaml(.cs)` (shared rows), `Windows/App/Ui/Menus.cs`
- Modify: `Windows/App/Ui/Shell.axaml` (sidebar: Home, Search, Your Library; the playlists list), `AlbumsView` (the four sorts as glass capsules)
- Test: `Windows/Tests/LibraryViewTests.cs`

**Interfaces:**
- Consumes: `Library`, `Player`, `Covers`, `Nav`, `Api` (`/me/mixes?tz=`, `/me/plays/contexts`).
- Produces: pages `HomePage`, `ArtistsPage`, `ArtistPage(string Id)`, `PlaylistsPage`, `PlaylistPage(string Id)`, `StarredPage`, `MixPage(string Id)`. `Menus.TrackMenu(Track t)` returns a glass `ContextMenu` with Play next, Add to queue, Go to album, Go to artist and Like. The Home sections and strings are as the web's `HomeView.tsx` minus YouTube: Made For You, Jump back in, Recently added. A missing cover is the DS §8 square: `Surface1`, the album title at 600 weight, 18% of the side, `Muted`, inset 8% (Review Focus 4).
- [ ] **Step 1: Failing tests.**
  - `[AvaloniaFact] AnAlbumWithoutCoverShowsItsTitleSquare`.
  - `[AvaloniaFact] TheSidebarListsThePlaylists` (fake handler).
  - `MixesParseLikeAndroid`: port `MixesTest.kt`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit "Windows: home, artists, playlists, starred and mixes".

### Task 14: Search, queue sheet, Wanted list, third pre-release

**Files:**
- Create: `Windows/App/Ui/SearchView`, `QueueSheet`, `WantedView` (`.axaml(.cs)` each), `Windows/App/Library/Wanted.cs`
- Test: `Windows/Tests/SearchQueueWantedTests.cs`

**Interfaces:**
- Consumes: `Library.Search`, `Queue`, `Player`, `Api` (`/wanted`, `/wanted/{id}`).
- Produces:
  - `SearchView`: the top capsule focuses on `/` or Ctrl+K. It searches what is loaded at once, then `search3` 250 ms after typing stops. Groups: songs, albums, artists. With nothing found: "Add to Wanted" and the YouTube Music link (it opens the browser; this is not the YouTube Music mode, which stays out).
  - `QueueSheet`: a glass sheet from the right (360 wide). It shows Now, Next up (drag to move, remove) and Next from <context>, with Clear. Shuffle and repeat buttons sit in the player pill.
  - `class Wanted(Api api) { Task<IReadOnlyList<WantedItem>> List(); Task Add(string artist, string? title, string? album); Task Remove(string id); }` with `record WantedItem(...)` from `openapi.yaml` `/wanted`. `WantedView` is Your Library → Wanted: the items, found ones are playable, and the others link to YouTube Music search.
- [ ] **Step 1: Failing tests.**
  - `SearchDebouncesThenAsksTheServer` (fake clock and handler: one `search3` call after 3 quick keystrokes).
  - `[AvaloniaFact] QueueSheetMovesAndRemoves`.
  - `WantedRoundTrips` (fake handler).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit "Windows: search, the queue sheet and the Wanted list". Push, CI green, tag `windows-v0.3.0`, push the tag, tell the owner.

---

## Stage 4 — Settings and finish (pre-release `windows-v1.0.0`)

### Task 15: Settings, devices, transparency, adaptive tint

**Files:**
- Create: `Windows/App/Prefs.cs`, `Windows/App/Ui/SettingsView.axaml(.cs)`, `Windows/App/Ui/DevicesView.axaml(.cs)`, `Windows/App/Ui/Transparency.cs`
- Modify: `Windows/App/Glass/GlassPanel.cs` (sets `Darken` from the backdrop's luminance)
- Test: `Windows/Tests/SettingsTests.cs`

**Interfaces:**
- Produces:
  - `record Prefs(VisualMode Mode, Intensity Intensity, Quality Quality, Motion Motion, float Backdrop, float LyricScale, long LyricOffsetMs, bool ShowUnsynced, bool Scrobble, PixelPoint? Window, bool FullScreen)`, with Android's defaults from `Prefs.kt`. `class PrefsStore { Prefs State; void Update(Func<Prefs, Prefs> f); }` stores JSON next to the token.
  - `DevicesView` lists `/me/sessions` (this device is marked), revokes one with `DELETE /me/sessions/{id}`, and has "Sign out other devices" (`/me/sessions/revoke-others`). Sign out → `Player.SignOut()`.
  - `static class Transparency { static bool Enabled(); }`: on Windows it reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency` (1 = on) and watches it with `SystemEvents.UserPreferenceChanged`. Elsewhere it returns true. It feeds `GlassPanel.Enabled`.
  - Adaptive tint: GlassPanel measures the mean luminance of its backdrop snapshot (a 4×4 downscale) every 250 ms. `Darken = clamp((lum - 0.55) / 0.35, 0, 1) * 0.35`, eased over 300 ms.
- [ ] **Step 1: Failing tests.**
  - `PrefsRoundTripWithDefaults`.
  - `[AvaloniaFact] GlassDarkensOverAWhiteBackdrop`: a panel over pure white, and after 600 ms `Darken > 0.3`.
  - `[AvaloniaFact] GlassIsOpaqueWhenTransparencyIsOff`: with `GlassPanel.Enabled = false`, the centre pixel equals `Surface1`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Settings sections as the web's Settings → Visuals / Lyrics / Playback / Account, minus admin, Navidrome connection and Performance mode. **Step 4:** PASS. **Step 5:** Commit "Windows: settings, devices, and glass that respects Windows".

### Task 16: Keyboard, states, icon, docs, the 1.0 pre-release

**Files:**
- Create: `Windows/App/Ui/Shortcuts.cs`, `Windows/App/Ui/ShortcutSheet.axaml(.cs)`, `Windows/App/Ui/States.axaml` (loading, empty, offline/reconnecting, error templates), `Windows/App/Assets/echo.ico`
- Modify: `Windows/App/Echo.csproj` (`ApplicationIcon`), `Windows/README.md`, `Windows/RELEASE.md`, `docs/PRODUCT_SPEC.md` (§3 Platform and F14: Windows is a full app with liquid glass), `docs/TECHNICAL_ARCHITECTURE.md` (the Windows client section), `docs/DESIGN_SYSTEM.md` §7.11 (one paragraph: "No glass" holds for web and Android; the Windows app is the owner's exception, 2026-11-06)
- Test: `Windows/Tests/ShortcutTests.cs`

**Interfaces:**
- Produces: `static class Shortcuts { static ShortcutAction? Map(Key key, KeyModifiers mods, bool textFocused); }`, implementing `PRODUCT_SPEC.md` §7. The differences: `F` and F11 are the window's full screen; `[`/`]` move the global `LyricOffsetMs` by 50 ms, since per-track nudges stay on the web; `G` then `L`/`S`/`P` is a two-key chord within 1 s. `Esc` closes the top overlay, then leaves full screen. Nothing fires in a text field except `Esc`.
- The icon is the ECHO wordmark's "E" in white on `Ground`, rendered by a one-off Skia snippet at 16/32/48/256 and saved as `.ico`.
- [ ] **Step 1: Failing tests.**
  - `SpaceTogglesOutsideTextFields`.
  - `NothingButEscapeFiresInATextField`.
  - `GThenLGoesToTheLibraryWithinASecond`.
  - `BracketsMoveTheOffsetBy50`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement the shortcuts, the sheet (`?`), the states on every page that loads, the icon and the docs. **Step 4:** `dotnet test Windows/Tests` → all PASS.
- [ ] **Step 5:** Commit "Windows: keyboard, states, icon and docs". Push, CI green, look at the last `smoke.png`. Tag `windows-v1.0.0` and push it. The release stays a pre-release until the owner says otherwise. Tell the owner, with the release link and the list of what to check on the gaming PC.
