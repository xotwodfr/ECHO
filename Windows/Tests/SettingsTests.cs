using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Echo.Glass;
using Echo.Stage;

namespace Echo.Tests;

// GlassPanel.Enabled is one switch for the app: the tests that read glass pixels run one at a time.
[Collection("glass")]
public class SettingsTests
{
    [Fact]
    public void PrefsRoundTripWithDefaults()
    {
        var file = Path.Combine(Path.GetTempPath(), $"echo-prefs-{Guid.NewGuid():N}.json");
        try
        {
            var store = new PrefsStore(file);
            Assert.Equal(new Prefs(), store.State);
            store.Update(p => p with { LyricScale = 1.25f, Intensity = Intensity.Subtle, WindowX = 2000, FullScreen = true });
            var again = new PrefsStore(file).State;
            Assert.Equal(1.25f, again.LyricScale);
            Assert.Equal(Intensity.Subtle, again.Intensity);
            Assert.Equal(2000, again.WindowX);
            Assert.True(again.FullScreen);
            Assert.True(again.Scrobble); // untouched: the default
        }
        finally
        {
            File.Delete(file);
        }
    }

    [AvaloniaFact]
    public void GlassDarkensOverAWhiteBackdrop()
    {
        var glass = new GlassPanel { Width = 200, Height = 100, CornerRadius = new CornerRadius(24), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var window = new Window { Width = 400, Height = 200, Background = Brushes.White, Content = glass };
        window.Show();
        for (var i = 0; i < 40 && glass.Darken <= 0.3; i++)
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(25);
        }
        Assert.True(glass.Darken > 0.3, $"darken {glass.Darken:0.00}");
    }

    [AvaloniaFact]
    public void GlassIsOpaqueWhenTransparencyIsOff()
    {
        GlassPanel.Enabled = false;
        try
        {
            var glass = new GlassPanel { Width = 200, Height = 100, CornerRadius = new CornerRadius(24), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var window = new Window { Width = 400, Height = 200, Background = Brushes.White, Content = glass };
            window.Show();
            using var frame = window.CaptureRenderedFrame()!;
            using var fb = frame.Lock();
            unsafe
            {
                var p = (byte*)fb.Address + 100 * fb.RowBytes + 200 * 4;
                Assert.Equal((0x15, 0x15, 0x1C), fb.Format == Avalonia.Platform.PixelFormat.Rgba8888 ? (p[0], p[1], p[2]) : (p[2], p[1], p[0]));
            }
        }
        finally
        {
            GlassPanel.Enabled = true;
        }
    }
}
