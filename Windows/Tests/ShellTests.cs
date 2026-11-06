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
        root.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text ?? "");

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
        foreach (var t in new[] { "Neon Tide", "Halcyon Drive", "Play", "Shuffle", "Afterglow", "Coda", "2024", "6 Songs, 22 minutes" })
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
        Assert.Contains("Halcyon Drive — Neon Tide", ShellTests.Texts(page));
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
        foreach (var t in new[] { "Recently Played", "Your Favorites", "Made For You", "Late Night Drive", "Prism Hours", "Daily Mix 1", "Discover Weekly" })
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
        Assert.Equal(12, page.GetVisualDescendants().OfType<CoverImage>().Count(c => c.Width == 190));
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
        foreach (var t in new[] { "Songs", "Albums", "Artists", "Monochrome", "Static Bloom", "Ostrava" })
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
        foreach (var t in new[] { "Mira Vale", "Latest Release", "Top Songs", "Albums", "Tidepool", "Low Orbit", "About Mira Vale" })
            Assert.True(texts.Contains(t), $"missing \"{t}\"");
    }
}
