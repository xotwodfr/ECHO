using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Avalonia.Threading;
using Echo.Ui;

namespace Echo.Tests;

/// Cider's shell on the built-in library. With ECHO_SHOTS set to a folder, each test also saves what it
/// drew there, for the side-by-side with Cider's own screenshots (1336×768).
public class ShellTests
{
    internal static async Task<MainWindow> Open()
    {
        var w = new MainWindow { Width = 1336, Height = 768 };
        w.Open(Session.ForFixtures());
        w.Show();
        await Settle();
        return w;
    }

    /// Lets the fixtures' answers and the covers arrive and the layout follow.
    internal static async Task Settle(int rounds = 12)
    {
        for (var i = 0; i < rounds; i++)
        {
            Dispatcher.UIThread.RunJobs();
            await Task.Delay(20);
        }
        Dispatcher.UIThread.RunJobs();
    }

    internal static IEnumerable<string> Texts(Control root) =>
        root.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible)
            .Select(t => t.Inlines is { Count: > 0 } runs ? string.Concat(runs.OfType<Avalonia.Controls.Documents.Run>().Select(r => r.Text)) : t.Text ?? "");

    internal static void Shot(Window w, string name)
    {
        if (Environment.GetEnvironmentVariable("ECHO_SHOTS") is not { Length: > 0 } dir) return;
        Directory.CreateDirectory(dir);
        w.CaptureRenderedFrame()?.Save(Path.Combine(dir, $"{name}.png"), new Avalonia.Media.Imaging.PngBitmapEncoderOptions());
    }

    [AvaloniaFact]
    public async Task TheShellOpensOnHomeWithTheLibraryAndPlaylistsInTheSidebar()
    {
        var w = await Open();
        Shot(w, "shell");
        Assert.Equal("home", w.Shell!.Nav.Current.Page);
        var texts = Texts(w.Shell).ToList();
        foreach (var item in new[] { "Home", "Library", "Recently Added", "Songs", "Albums", "Artists", "Playlists", "Create New", "Late Night Drive", "Focus" })
            Assert.Contains(item, texts);
        // Apple Music's places are not here.
        foreach (var apple in new[] { "Listen Now", "Browse", "Radio", "Podcasts", "Videos" })
            Assert.DoesNotContain(apple, texts);
    }

    [AvaloniaFact]
    public async Task SpacePlaysOrPausesAndCtrlFGoesToTheSearchField()
    {
        var w = await Open();
        var player = Session.Current!.Player;
        var changes = 0;
        player.PropertyChanged += (_, _) => changes++;
        void Space() => w.KeyPress(Avalonia.Input.Key.Space, Avalonia.Input.RawInputModifiers.None, Avalonia.Input.PhysicalKey.Space, " ");
        // (The fixtures serve no audio, so the player is seen to answer rather than heard to play.)
        Space();
        await Settle();
        Assert.True(changes > 0, "Space reached the player");
        w.KeyPress(Avalonia.Input.Key.F, Avalonia.Input.RawInputModifiers.Control, Avalonia.Input.PhysicalKey.F, "f");
        await Settle();
        Assert.IsType<TextBox>(w.FocusManager!.GetFocusedElement());
        changes = 0;
        Space();
        await Settle();
        Assert.Equal(0, changes); // Space in the field types, it does not pause
    }

    [AvaloniaFact]
    public async Task BackAndForwardWalkThePagesOpened()
    {
        var w = await Open();
        var nav = w.Shell!.Nav;
        nav.Open(new Route("library-albums"));
        nav.Open(new Route("album", "f11", "Neon Tide"));
        nav.Back();
        Assert.Equal("library-albums", nav.Current.Page);
        nav.Back();
        Assert.Equal("home", nav.Current.Page);
        Assert.False(nav.CanBack);
        nav.Forward();
        Assert.Equal("library-albums", nav.Current.Page);
    }

    [AvaloniaFact]
    public async Task TheBottomChromeShowsTheSavedSongAndItsTime()
    {
        var w = await Open();
        var bar = Texts(w.Shell!.Bottom).ToList();
        Assert.Contains("Afterglow", bar);
        Assert.Contains("Halcyon Drive", bar);
        Assert.Contains("Neon Tide", bar);
        Assert.Contains("1:18", bar);
        Assert.Contains("3:00", bar);
    }
}

public class CollectionPageTests
{
    [AvaloniaFact]
    public async Task AnAlbumListsItsSongsAndADoubleClickPlaysFromThere()
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route("album", "f11", "Neon Tide"));
        await ShellTests.Settle();
        ShellTests.Shot(w, "album");
        var page = Assert.IsType<CollectionPage>(w.Shell.Page);
        var texts = ShellTests.Texts(page).ToList();
        foreach (var t in new[] { "Neon Tide", "Halcyon Drive", "INDIE ROCK · 2024", "Play", "Shuffle", "Afterglow", "Coda", "2024", "6 Songs, 22 minutes" })
            Assert.True(texts.Contains(t), $"missing \"{t}\" in [{string.Join(" | ", texts)}]");
        Assert.Equal(6, page.List!.ItemCount);
        page.List.SelectedIndex = 2;
        await page.List.Play(2);
        Assert.Equal("Overpass", Session.Current!.Player.Track?.Title);
        Assert.Equal(3, Session.Current.Player.Queue.Upcoming.Count);
    }

    [AvaloniaFact]
    public async Task APlaylistShowsArtworkOnEachRow()
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route("playlist", "pl1", "Late Night Drive"));
        await ShellTests.Settle();
        ShellTests.Shot(w, "playlist");
        var page = Assert.IsType<CollectionPage>(w.Shell.Page);
        Assert.Equal(5, page.List!.ItemCount);
        var texts = ShellTests.Texts(page).ToList();
        foreach (var t in new[] { "Song", "Artist", "Album", "Time", "Halcyon Drive", "Neon Tide", "5 SONGS · 17 MINUTES" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
    }
}

public class LibraryPageTests
{
    static async Task<(MainWindow W, Control Page)> Open(string page)
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route(page));
        await ShellTests.Settle(20);
        ShellTests.Shot(w, page);
        return (w, w.Shell.Page!);
    }

    [AvaloniaFact]
    public async Task HomeShowsRecentlyPlayedFavoritesAndMadeForYou()
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route("library-songs"));
        w.Shell.Nav.Back(); // a fresh Home, with the fixtures' history loaded
        await ShellTests.Settle(20);
        ShellTests.Shot(w, "home");
        var texts = ShellTests.Texts(w.Shell.Page!).ToList();
        foreach (var t in new[] { "Home", "Top Picks for You", "Recently Played", "Your Favorites", "Late Night Drive", "Prism Hours", "Daily Mix 1", "Discover Weekly" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
    }

    [AvaloniaFact]
    public async Task RecentlyAddedAndAlbumsShowSquaresThatOpenTheAlbum()
    {
        var (w, page) = await Open("library-recentlyadded");
        Assert.Contains("Static Bloom", ShellTests.Texts(page)); // the newest
        (w, page) = await Open("library-albums");
        var texts = ShellTests.Texts(page).ToList();
        Assert.Contains("Albums", texts);
        Assert.Contains("Kaleido", texts);
        Assert.Equal(12, page.GetVisualDescendants().OfType<Tile>().Count());
    }

    [AvaloniaFact]
    public async Task SongsListsEverySongAndArtistsShowsTheirAlbums()
    {
        var (_, page) = await Open("library-songs");
        Assert.Equal(72, Assert.IsType<SongsPage>(page).List!.ItemCount);
        var (w, artists) = await Open("library-artists");
        var list = artists.GetVisualDescendants().OfType<ListBox>().First();
        list.SelectedIndex = 0; // Ada Sol
        await ShellTests.Settle();
        ShellTests.Shot(w, "library-artists");
        Assert.Contains("Honeycomb", ShellTests.Texts(artists));
    }
}

public class SearchAndArtistTests
{
    [AvaloniaFact]
    public async Task SearchShowsSongsAlbumsAndArtistsOrNoResults()
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route("search", "ostrava", "ostrava"));
        await ShellTests.Settle(20);
        ShellTests.Shot(w, "search");
        var texts = ShellTests.Texts(w.Shell.Page!).ToList();
        foreach (var t in new[] { "ostrava", "Top Results", "Songs", "Albums", "Artists", "Monochrome", "Static Bloom", "Ostrava", "Album · Ostrava" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
        w.Shell.Nav.Open(new Route("search", "zzz", "zzz"));
        await ShellTests.Settle();
        Assert.Contains("No Results", ShellTests.Texts(w.Shell.Page!));
    }

    [AvaloniaFact]
    public async Task AnArtistShowsLatestReleaseTopSongsAndAlbums()
    {
        var w = await ShellTests.Open();
        w.Shell!.Nav.Open(new Route("artist", "ar1", "Mira Vale"));
        await ShellTests.Settle(20);
        ShellTests.Shot(w, "artist");
        var texts = ShellTests.Texts(w.Shell.Page!).ToList();
        foreach (var t in new[] { "Mira Vale", "Latest Release", "Top Songs", "Albums", "Tidepool", "Low Orbit", "About Mira Vale", "Mira Vale · Low Orbit" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
    }
}

public class DrawerTests
{
    [AvaloniaFact]
    public async Task TheQueueButtonOpensTheQueueAndAgainClosesIt()
    {
        var w = await ShellTests.Open();
        var drawer = w.Shell!.Drawer;
        drawer.Toggle("queue");
        await ShellTests.Settle();
        ShellTests.Shot(w, "queue");
        var queue = Assert.IsType<QueuePanel>(drawer.Child);
        Assert.Equal(["Night Swim", "Overpass", "Glass Hours", "Low Tide", "Coda"], queue.Shown.Select(t => t.Title));
        var texts = ShellTests.Texts(drawer).ToList();
        foreach (var t in new[] { "Now Playing", "Playing Next", "From Neon Tide", "1 of 6", "5 items", "Clear" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
        drawer.Toggle("queue");
        Assert.Null(drawer.Panel); // it slides out, then hides
        await Task.Delay(400);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        Assert.False(drawer.IsVisible);
    }

    [AvaloniaFact]
    public async Task AWholeLibraryInTheQueueShowsItsFirstHundred()
    {
        // Played from Songs: 22,000 rows with covers froze the window.
        var w = await ShellTests.Open();
        var songs = QueueTests.Album(3000);
        Session.Current!.Player.Show(new QueueState(Now: songs[0], Context: songs.Skip(1).ToList(), ContextSource: new PlayContext("songs", null, "Songs")), TimeSpan.Zero);
        var drawer = w.Shell!.Drawer;
        drawer.Toggle("queue");
        await ShellTests.Settle();
        var queue = Assert.IsType<QueuePanel>(drawer.Child);
        Assert.Equal(100, queue.Shown.Count);
        var texts = ShellTests.Texts(drawer).ToList();
        Assert.Contains("2999 items", texts);
        Assert.Contains("And 2,899 more", texts);
    }

    [AvaloniaFact]
    public async Task TheLyricsLightTheLineThatIsSung()
    {
        var w = await ShellTests.Open();
        await ShellTests.Settle(30); // the lyrics loader waits 250 ms before it asks
        var drawer = w.Shell!.Drawer;
        drawer.Toggle("lyrics");
        await ShellTests.Settle();
        ShellTests.Shot(w, "lyrics");
        var stage = drawer.GetVisualDescendants().OfType<Echo.Stage.LyricsStage>().Single();
        stage.Tick(16);
        // 1:18 is inside "Every echo finds its way home" (75.0 s to 78.6 s), after the opening dots.
        Assert.Equal("Every echo finds its way home", string.Join(" ", stage.Lines[stage.Active].Words));
        Assert.True(stage.Lines[0].Item.Interlude);
    }
}

public class ModeTests
{
    [AvaloniaFact]
    public async Task FullscreenShowsTheSongWithItsLyricsAndEscapeGoesBack()
    {
        var w = await ShellTests.Open();
        await ShellTests.Settle(30);
        var shell = w.Shell!;
        w.Fullscreen(shell);
        await ShellTests.Settle();
        var view = Assert.IsType<ImmersiveView>(w.Content);
        foreach (var s in view.GetVisualDescendants().OfType<Echo.Stage.LyricsStage>()) for (var i = 0; i < 60; i++) s.Tick(16);
        ShellTests.Shot(w, "fullscreen");
        var texts = ShellTests.Texts(view).ToList();
        Assert.Contains("Afterglow", texts);
        var stage = view.GetVisualDescendants().OfType<Echo.Stage.LyricsStage>().Single();
        stage.Tick(16);
        Assert.Equal("Every echo finds its way home", string.Join(" ", stage.Lines[stage.Active].Words));
        view.RaiseEvent(new Avalonia.Input.KeyEventArgs { RoutedEvent = Avalonia.Input.InputElement.KeyDownEvent, Key = Avalonia.Input.Key.Escape });
        Assert.Same(shell, w.Content);
    }

    [AvaloniaFact]
    public async Task TheMiniPlayerIsASmallSquareThatClosesBackToTheShell()
    {
        var w = await ShellTests.Open();
        var shell = w.Shell!;
        w.Mini(shell);
        await ShellTests.Settle();
        Assert.IsType<MiniPlayer>(w.Content);
        Assert.Equal(300, w.Width);
        ((Control)w.Content!).GetVisualDescendants().OfType<Button>().Last().RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Same(shell, w.Content);
        Assert.Equal(1336, w.Width);
    }
}

public class SettingsTests
{
    [AvaloniaFact]
    public async Task SettingsSwitchesToMaverickWithThePlayerInTheTopChrome()
    {
        var w = await ShellTests.Open();
        var settings = w.Shell!.ShowSettings("Visual");
        await ShellTests.Settle();
        ShellTests.Shot(w, "settings");
        Assert.Contains("Window Layout", ShellTests.Texts(settings));
        var layout = settings.GetVisualDescendants().OfType<ComboBox>().Single();
        layout.SelectedIndex = 1;
        await ShellTests.Settle(20);
        var shell = w.Shell!;
        Assert.True(shell.Maverick);
        Assert.Equal("maverick", Session.Current!.Prefs.Layout);
        Assert.NotNull(shell.Top.Lcd);
        Assert.Null(shell.GetVisualDescendants().OfType<ChromeBottom>().FirstOrDefault());
        shell.Settings?.GetVisualDescendants().OfType<Button>().First(b => ToolTip.GetTip(b) as string == "Close")
            .RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        await ShellTests.Settle();
        ShellTests.Shot(w, "maverick");
        var texts = ShellTests.Texts(shell).ToList();
        Assert.Contains("Afterglow", texts);
        Assert.Contains("Halcyon Drive — Neon Tide", texts);
        Assert.Contains("ECHO", texts); // Maverick's sidebar holds Home under the app's name
    }

    [Fact]
    public void PrefsReadBackAndFallBackToCidersDefaults()
    {
        var file = Path.Combine(Path.GetTempPath(), $"echo-prefs-{Guid.NewGuid():N}.json");
        try
        {
            Assert.Equal(new Prefs(), Prefs.Load(file)); // none yet: Mojave, scrobbling
            new Prefs("maverick", false).Save(file);
            Assert.Equal(new Prefs("maverick", false), Prefs.Load(file));
            File.WriteAllText(file, "{not json");
            Assert.Equal(new Prefs(), Prefs.Load(file));
        }
        finally
        {
            File.Delete(file);
        }
    }
}

public class MinimumSizeTests
{
    [AvaloniaFact]
    public async Task AtTheSmallestWindowTheTopChromeStillFits()
    {
        var w = await ShellTests.Open();
        w.Width = 1024;
        w.Height = 640;
        await ShellTests.Settle();
        ShellTests.Shot(w, "minimum");
        var top = w.Shell!.Top;
        Rect Box(Control c) => new(c.TranslatePoint(new Point(0, 0), w)!.Value, c.Bounds.Size);
        var search = Box(top.GetVisualDescendants().OfType<TextBox>().Single());
        var tab = Box(top.GetVisualDescendants().OfType<Button>().Single(b => b.Theme == Kit.Res<Avalonia.Styling.ControlTheme>("TopNavItem")));
        var close = Box(top.GetVisualDescendants().OfType<Button>().Single(b => ToolTip.GetTip(b) as string == "Close"));
        Assert.True(close.Right <= w.Bounds.Width + 0.5, $"close at {close} in {w.Bounds} / {w.ClientSize} / top {top.Bounds}");
        Assert.True(search.Left >= tab.Right, $"search {search} over the tab {tab}");
        Assert.True(search.Right <= close.Left, $"search {search} under the window controls {close}");
    }
}

public class MaverickMinimumTests
{
    [AvaloniaFact]
    public async Task MaverickAlsoFitsTheSmallestWindow()
    {
        var w = await ShellTests.Open();
        Session.Current!.Set(Session.Current.Prefs with { Layout = "maverick" });
        w.Width = 1024;
        w.Height = 640;
        await ShellTests.Settle();
        ShellTests.Shot(w, "maverick-minimum");
        var top = w.Shell!.Top;
        var close = top.GetVisualDescendants().OfType<Button>().Single(b => ToolTip.GetTip(b) as string == "Close");
        Assert.True(close.TranslatePoint(new Point(close.Bounds.Width, 0), w)!.Value.X <= 1024.5);
    }
}
