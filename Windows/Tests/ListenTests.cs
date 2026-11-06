using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Echo.Glass;
using Echo.Stage.Lyrics;
using Echo.Ui;

namespace Echo.Tests;

public class ListenTests
{
    static readonly IReadOnlyList<(PixelRect Bounds, bool Primary)> TwoMonitors =
        [(new PixelRect(0, 0, 1920, 1080), true), (new PixelRect(1920, 0, 2560, 1440), false)];

    [Fact]
    public void PickFallsBackToThePrimaryScreen()
    {
        Assert.Equal(0, Monitors.Pick(TwoMonitors, new PixelPoint(5000, 0))); // unplugged since
        Assert.Equal(1, Monitors.Pick(TwoMonitors, new PixelPoint(2000, 10)));
        Assert.Equal(0, Monitors.Pick(TwoMonitors, null));
    }

    [Fact]
    public void ChromeHidesAfterThreeSecondsOfPlay()
    {
        var t = 0.0;
        var chrome = new ChromeTimer(() => t);
        Assert.True(chrome.Visible(playing: true));
        t = 3100;
        Assert.False(chrome.Visible(playing: true));
        Assert.True(chrome.Visible(playing: false), "paused, the chrome stays");
        chrome.Poke(); // a pointer move or a key
        Assert.True(chrome.Visible(playing: true));
    }

    [AvaloniaFact]
    public void TheLyricsAreNeverUnderGlass()
    {
        var session = Session.ForFixtures();
        var window = new Window { Width = 1280, Height = 800, Content = new ListenView(session) };
        window.Show();
        for (var i = 0; i < 3; i++)
        {
            Dispatcher.UIThread.RunJobs();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        }
        Shots.Save(window, "listen");

        var field = window.GetVisualDescendants().OfType<LyricsField>().Single();
        Assert.NotNull(field.ActiveLine);
        var line = field.ActiveLine!.Value.TransformToAABB(field.TransformToVisual(window)!.Value);
        foreach (var glass in window.GetVisualDescendants().OfType<GlassPanel>().Where(g => g.IsEffectivelyVisible))
        {
            var box = new Rect(glass.Bounds.Size).TransformToAABB(glass.TransformToVisual(window)!.Value);
            Assert.False(box.Intersects(line), $"{glass.Name} covers the sung line");
        }
    }
}
