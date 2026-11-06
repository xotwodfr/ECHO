using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
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
        root.GetLogicalDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text ?? "");

    internal static void Shot(Window w, string name)
    {
        if (Environment.GetEnvironmentVariable("ECHO_SHOTS") is not { Length: > 0 } dir) return;
        Directory.CreateDirectory(dir);
        w.CaptureRenderedFrame()?.Save(Path.Combine(dir, $"{name}.png"));
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
