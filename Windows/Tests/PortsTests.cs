using Echo.Playback;
using Echo.Stage;

namespace Echo.Tests;

// The ported pure logic, checked the way Android's PortsTest.kt checks it (and the web's tests the originals).
public class PortsTests
{
    [Fact]
    public void ReverbNeverChangesTheLightFasterThanThePhotosensitivityLimit()
    {
        var r = new Reverb();
        var last = r.Step(new Features(Available: true, Intensity: 0.9), 16.7, 0.5, 0.4);
        for (var i = 0; i < 120; i++)
        {
            var f = new Features(Available: true, Bass: i % 2 == 0 ? 1.0 : 0.0, Onset: 1.0, Intensity: 0.9);
            var next = r.Step(f, 16.7, 0.5, 0.4);
            // Rising light (exposure up) stays inside the budget per frame.
            Assert.True(next.Exposure - last.Exposure <= Reverb.LumaSlewPerS * 0.0167 + 1e-9);
            last = next;
        }
    }

    [Fact]
    public void CssColoursParseLikeTheWebs()
    {
        Assert.Equal(0xFFE3B26Bu, Oklab.ParseCss("#E3B26B").ToArgb());
        var glow = Oklab.ParseCss("oklch(0.68 0.10 75 / 0.35)");
        Assert.Equal(0.35f, glow.A, 6);
    }

    [Fact]
    public void TheFftFindsASineInItsBin()
    {
        const int n = 2048;
        var re = Enumerable.Range(0, n).Select(i => Math.Sin(2 * Math.PI * 64 * i / n)).ToArray();
        var im = new double[n];
        AnalyserFeatures.Fft(re, im);
        var peak = Enumerable.Range(0, n / 2).MaxBy(i => Math.Sqrt(re[i] * re[i] + im[i] * im[i]));
        Assert.Equal(64, peak);
        Assert.True(Math.Abs(Math.Sqrt(re[64] * re[64] + im[64] * im[64]) - n / 2.0) < 1e-6);
    }

    [Fact]
    public void GovernorStepsDownAfterASecondOfSlowFrames()
    {
        var t = 0.0;
        var g = new Governor(Tier.T0, manual: false, () => t);
        for (var i = 0; i < 60; i++) Assert.Null(g.Sample(16.7, 10_000, false)); // learns 60 Hz
        Tier? changed = null;
        for (var i = 0; i < 40 && changed is null; i++)
        {
            t += 40;
            changed = g.Sample(40, 10_000, false);
        }
        Assert.Equal(Tier.T1, changed);
    }

    [Fact]
    public void TheTapHandsOverWhatIsAudibleNow()
    {
        long now = 0;
        var tap = new AudioTap(() => now);
        var block = new float[4410 * 2]; // 100 ms of stereo at 44.1 kHz, left = right = 0.5
        Array.Fill(block, 0.5f);
        for (var i = 0; i < 10; i++)
        {
            tap.Write(block, 2, 44_100);
            now += 100_000_000; // 100 ms
        }
        var window = new float[2048];
        Assert.True(tap.Window(window));
        Assert.All(window, s => Assert.Equal(0.5f, s));
        now += 2_000_000_000; // nothing written for 2 s: paused
        Assert.False(tap.Window(window));
    }
}
