using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Echo.Glass;

namespace Echo.Tests;

public class GlassTests
{
    [Fact]
    public void BendMatchesTheWeb()
    {
        // The 10-28 web glass (git show 8cbc0bb^:src/client/ui/glass.ts), bend() at its defaults.
        var web = new Dictionary<double, double>
        {
            [0] = 26.794672753821157,
            [0.25] = 7.6324877126657968,
            [0.5] = 1.9060118618074910,
            [0.75] = 0.22959357921561743,
            [1] = 0,
        };
        foreach (var (t, expected) in web)
            Assert.Equal(expected, GlassMath.Bend(new GlassParams(), t), 9);
    }

    [Fact]
    public void ProfileIsEdgeFirstAndScaled()
    {
        var profile = GlassMath.BendProfile(new GlassParams(Refraction: 2), 32);
        Assert.Equal(32, profile.Length);
        Assert.Equal(2 * GlassMath.Bend(new GlassParams(), 0), profile[0], 4);
        Assert.Equal(0, profile[31], 4);
    }

    [Fact]
    public void TheShaderCompiles() => Assert.NotNull(GlassShader.Compiled); // a broken one renders the window black

    [AvaloniaFact]
    public void GlassBendsTheRimAndLeavesTheCentre()
    {
        // Black up to x = 90, white from x = 150, a steep ramp between: the panel's left rim (x = 100…120)
        // sits on the ramp, so a rim that shows what is further in shows a brighter grey.
        var ramp = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(90, 0, RelativeUnit.Absolute),
            EndPoint = new RelativePoint(150, 0, RelativeUnit.Absolute),
            GradientStops = { new GradientStop(Colors.Black, 0), new GradientStop(Colors.White, 1) },
        };
        var glass = new GlassPanel
        {
            Width = 200,
            Height = 100,
            CornerRadius = new CornerRadius(24),
            Params = new GlassParams(Specular: 0, Frost: 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var window = new Window { Width = 400, Height = 200, Background = ramp, Content = glass };
        window.Show();
        using var frame = window.CaptureRenderedFrame()!;

        double Backdrop(int x) => Math.Clamp((x + 0.5 - 90) / 60, 0, 1) * 255;
        var tint = 1 - new GlassParams().Tint;
        // 4 px inside the left rim: refracted, so brighter than the tinted ramp under it.
        Assert.True(Luma(frame, 104, 100) > Backdrop(104) * tint + 20,
            $"rim {Luma(frame, 104, 100):0} vs backdrop {Backdrop(104) * tint:0}");
        // The centre: on white, only tinted.
        Assert.InRange(Luma(frame, 200, 100), 255 * tint * 0.85, 255 * tint * 1.15);
    }

    static double Luma(WriteableBitmap bitmap, int x, int y)
    {
        using var fb = bitmap.Lock();
        unsafe
        {
            var p = (byte*)fb.Address + y * fb.RowBytes + x * 4; // Bgra8888 or Rgba8888: grey either way
            return 0.2126 * p[2] + 0.7152 * p[1] + 0.0722 * p[0];
        }
    }
}
