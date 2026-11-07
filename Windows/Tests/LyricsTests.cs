using Echo.Stage;

namespace Echo.Tests;

public class TimelineTests
{
    static LyricLine Line(string text, long start, long end)
    {
        var words = text.Split(' ');
        var step = (end - start) / words.Length;
        return new(text, start, end, Words: words.Select((w, i) => new LyricWord(w, start + i * step, start + (i + 1) * step)).ToList());
    }

    static readonly LyricsDoc Doc = new("k", "word", "test", new Attribution(""),
    [
        Line("first line here", 9_000, 12_000),
        Line("second line", 12_500, 15_000),
        Line("after the break", 25_000, 28_000),
    ]);

    [Fact]
    public void LongGapsAndALateStartBecomeInterludes()
    {
        var tl = new Timeline(Doc);
        Assert.Equal([true, false, false, true, false], tl.Items.Select(i => i.Interlude));
        Assert.Equal((0d, 9_000d), (tl.Items[0].Start, tl.Items[0].End)); // before the first line
        Assert.Equal((15_000d, 25_000d), (tl.Items[3].Start, tl.Items[3].End)); // the 10 s break
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(9_100, 1)]
    [InlineData(12_400, 1)] // between lines the last one holds
    [InlineData(13_000, 2)]
    [InlineData(20_000, 3)] // the dots
    [InlineData(26_000, 4)]
    public void TheLastItemBegunHoldsTheColumn(double t, int active) => Assert.Equal(active, new Timeline(Doc).ActiveAt(t));

    [Fact]
    public void UntimedLyricsHaveNoCurrentLine()
    {
        var tl = new Timeline(Doc with { Sync = "none" });
        Assert.Equal(-1, tl.ActiveAt(10_000));
        Assert.DoesNotContain(tl.Items, i => i.Interlude);
    }

    [Fact]
    public void AWordFillsOverItsOwnTime()
    {
        var w = new LyricWord("hold", 1_000, 2_000);
        Assert.Equal(0, Timeline.Fill(w, 500));
        Assert.Equal(0.5, Timeline.Fill(w, 1_500));
        Assert.Equal(1, Timeline.Fill(w, 2_500));
    }

    [Fact]
    public void SpicysCurvesPassThroughTheirPoints()
    {
        var scale = new Spline((0, 0.95), (0.7, 1.0505), (1, 1));
        Assert.Equal(0.95, scale.At(-1));
        Assert.Equal(1.0505, scale.At(0.7), 9);
        Assert.Equal(1, scale.At(2));
        Assert.True(scale.At(0.5) > 1); // on its way up past full size
    }

    [Fact]
    public void ACriticallyDampedSpringArrivesWithoutOvershoot()
    {
        var s = new Spring(0);
        var max = 0.0;
        for (var i = 0; i < 120; i++)
        {
            s.Step(100, 16);
            max = Math.Max(max, s.X);
        }
        Assert.True(s.Settled(100));
        Assert.True(max <= 100.0001);
        var half = new Spring(0);
        for (var i = 0; i < 10; i++) half.Step(100, 16); // 160 ms in: well on the way, not there
        Assert.InRange(half.X, 40, 95);
    }
}

public class LyricsStageTests
{
    static (Avalonia.Controls.Window W, LyricsStage Stage, Func<double, double> Set) Open(double startMs)
    {
        var t = startMs;
        var stage = new LyricsStage(() => t, () => true, ms => t = ms);
        var w = new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage };
        w.Show();
        stage.Show(Fixtures.Lyrics);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        return (w, stage, v => t = v);
    }

    static double Middle(LyricsStage stage, int i) => stage.TopOf(i) + stage.Lines[i].Bounds.Height / 2;

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void TheSungLineIsCentredAndTheColumnGlidesToTheNext()
    {
        var (w, stage, set) = Open(79_500);
        stage.Tick(16);
        var current = stage.Active;
        Assert.Equal("Every echo finds its way home", string.Join(" ", stage.Lines[current].Words));
        Assert.Equal(300, Middle(stage, current), 1);
        Assert.Equal(LineState.Sung, stage.Lines[current - 1].State);
        Assert.Equal(LineState.NotSung, stage.Lines[current + 1].State);
        var nextWasAt = Middle(stage, current + 1);

        set(80_050); // the next line begins (half a second on: playing, not a seek)
        stage.Tick(16);
        Assert.Equal(current + 1, stage.Active);
        Assert.InRange(Middle(stage, current + 1), 301, nextWasAt); // on its way, not there yet
        for (var i = 0; i < 120; i++) stage.Tick(16);
        Assert.Equal(300, Middle(stage, current + 1), 1);
        set(80_900);
        for (var i = 0; i < 10; i++) stage.Tick(16);
        ShellTests.Shot(w, "lyrics-stage");
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void ASeekPutsTheColumnThereAtOnce()
    {
        var (_, stage, set) = Open(76_000);
        stage.Tick(16);
        set(66_500); // back to the first line
        stage.Tick(16);
        Assert.Equal("Streetlights hum a borrowed tune", string.Join(" ", stage.Lines[stage.Active].Words));
        Assert.Equal(300, Middle(stage, stage.Active), 1);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void TheBreakShowsDotsAndTheDuetVoiceSitsOnTheRight()
    {
        var (w, stage, set) = Open(95_000);
        stage.Tick(16);
        Assert.True(stage.Lines[stage.Active].Item.Interlude);
        ShellTests.Shot(w, "lyrics-dots");
        set(102_000);
        stage.Tick(16);
        Assert.True(stage.Lines[stage.Active].RightAligned);
        Assert.Equal("(hold on)", string.Join(" ", stage.Lines.Single(l => l.Item.Line?.Background is { Count: > 0 }).Words.Skip(4)));
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void PausedAndSettledTheStageStopsAskingForFrames()
    {
        var t = 76_000.0;
        var stage = new LyricsStage(() => t, () => false, _ => { });
        new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage }.Show();
        stage.Show(Fixtures.Lyrics);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        var busy = true;
        for (var i = 0; i < 200 && busy; i++) busy = stage.Tick(16);
        Assert.False(busy);
    }
}
