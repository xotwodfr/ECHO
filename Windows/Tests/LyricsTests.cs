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

    [Theory]
    [InlineData(12_200, new[] { 1 })] // sung through, still lit in the gap
    [InlineData(12_600, new[] { 2 })] // the next line put it out
    [InlineData(20_000, new int[0])] // the dots hold the column
    [InlineData(26_000, new[] { 4 })]
    [InlineData(29_000, new int[0])] // after the last line
    public void ALineStaysLitUntilALaterOneBegins(double t, int[] lit) => Assert.Equal(lit, new Timeline(Doc).LitAt(t));

    [Fact]
    public void OverlappingLinesLightTogether()
    {
        var duet = new Timeline(Doc with { Lines = [Line("one two", 1_000, 4_000), Line("three four", 3_000, 6_000), Line("five six", 6_500, 8_000)] });
        Assert.Equal([0, 1], duet.LitAt(3_500));
        Assert.Equal([0, 1], duet.LitAt(4_500)); // the first has ended, but nothing began after it
        Assert.Equal([2], duet.LitAt(6_600));
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
    public void ACubicBezierEasesAsCssDoes()
    {
        var ease = CubicBezier.EaseOut;
        Assert.Equal(0, ease.At(-1));
        Assert.Equal(1, ease.At(2));
        Assert.Equal(0.5, new CubicBezier(0.25, 0.25, 0.75, 0.75).At(0.5), 3); // a straight line
        Assert.True(ease.At(0.5) > 0.6); // ease-out: most of the way by halfway
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
    // An 800 × 600 window: 30 px lines (5 % of its height), the anchor's middle at 210 (35 % down).
    static (Avalonia.Controls.Window W, LyricsStage Stage, Func<double, double> Set) Open(double startMs, bool playing = true)
    {
        var t = startMs;
        var stage = new LyricsStage(() => t, () => playing, ms => t = ms);
        var w = new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage };
        w.Show();
        stage.Show(Fixtures.Lyrics);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        return (w, stage, v => t = v);
    }

    static double Middle(LyricsStage stage, int i) => stage.TopOf(i) + stage.Lines[i].DesiredSize.Height / 2;

    static void Run(LyricsStage stage, int frames)
    {
        for (var i = 0; i < frames; i++) stage.Tick(16);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void TheSungLineSitsAThirdDownAndTheColumnRipplesToTheNext()
    {
        var (w, stage, set) = Open(79_500);
        stage.Tick(16);
        var current = stage.Active;
        Assert.Equal("Every echo finds its way home", string.Join(" ", stage.Lines[current].Words));
        Assert.Equal(210, Middle(stage, current), 1);
        // Sung through, it stays lit until the next line begins; the line before has gone dim.
        Assert.True(stage.Lines[current].IsLit);
        Assert.False(stage.Lines[current - 1].IsLit);
        Assert.False(stage.Lines[current + 1].IsLit);

        set(80_050); // the next line begins (half a second on: playing, not a seek)
        var before = stage.Lines.Select(l => l.Top).ToArray();
        Run(stage, 10);
        Assert.Equal(current + 1, stage.Active);
        Assert.False(stage.Lines[current].IsLit);
        // The lines at the top have set off; three lines below the new one still wait their turn.
        Assert.True(before[current - 2] - stage.TopOf(current - 2) > 2);
        Assert.Equal(before[current + 3], stage.TopOf(current + 3), 3);
        Run(stage, 150);
        Assert.Equal(210, Middle(stage, current + 1), 1);
        set(80_900);
        Run(stage, 10);
        ShellTests.Shot(w, "lyrics-stage");
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void ASeekGlidesTheColumnThereWithoutTheRipple()
    {
        var (_, stage, set) = Open(76_000);
        stage.Tick(16);
        set(66_500); // back to the first line
        var before = stage.Lines.Select(l => l.Top).ToArray();
        stage.Tick(16);
        Assert.Equal("Streetlights hum a borrowed tune", string.Join(" ", stage.Lines[stage.Active].Words));
        // Every line set off together, the same way.
        var moved = stage.Lines.Select((l, i) => l.Top - before[i]).ToArray();
        Assert.True(moved[1] > 1);
        Assert.All(moved, m => Assert.Equal(moved[1], m, 3));
        Run(stage, 200);
        Assert.Equal(210, Middle(stage, stage.Active), 1);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void LinesNotSungShrinkAndBlurByTheirDistance()
    {
        var (_, stage, _) = Open(79_500);
        Run(stage, 120);
        var current = stage.Active;
        Assert.Equal(100, stage.Lines[current].ScaleNow, 1);
        Assert.Equal(0, stage.Lines[current].BlurNow, 1);
        Assert.Equal(97, stage.Lines[current + 1].ScaleNow, 1);
        // 1 px, plus a line for each line below the sung one, or plus one more above it.
        Assert.Equal(2, stage.Lines[current + 1].BlurNow, 1);
        Assert.Equal(3, stage.Lines[current + 2].BlurNow, 1);
        Assert.Equal(3, stage.Lines[current - 1].BlurNow, 1);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void PerformanceModeNeitherBlursNorRipples()
    {
        var t = 79_500.0;
        var stage = new LyricsStage(() => t, () => true, _ => { }, lite: () => true);
        new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage }.Show();
        stage.Show(Fixtures.Lyrics);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        Run(stage, 60);
        Assert.All(stage.Lines, l => Assert.Equal(0, l.BlurNow, 2));
        t = 80_050;
        var before = stage.Lines.Select(l => l.Top).ToArray();
        stage.Tick(16);
        var moved = stage.Lines.Select((l, i) => l.Top - before[i]).ToArray();
        Assert.True(moved[1] < -0.5);
        Assert.All(moved, m => Assert.Equal(moved[1], m, 3));
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void BackgroundVocalsTakeRoomOnlyWhileTheirLineIsSung()
    {
        var (_, stage, set) = Open(83_000);
        Run(stage, 5);
        var line = stage.Lines.Single(l => l.Item.Line?.Background is { Count: > 0 });
        Assert.False(line.ShowBackground);
        var without = line.DesiredSize.Height;
        set(84_600);
        Run(stage, 5);
        Assert.True(line.ShowBackground);
        Assert.True(line.DesiredSize.Height > without + 20);
        Assert.Equal("(hold on)", string.Join(" ", line.Words.Skip(4)));
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void TheBreakShowsDotsAndTheDuetVoiceSitsOnTheRight()
    {
        var (w, stage, set) = Open(95_000);
        stage.Tick(16);
        Assert.True(stage.Lines[stage.Active].Item.Interlude);
        Assert.Empty(stage.Lit);
        ShellTests.Shot(w, "lyrics-dots");
        set(102_000);
        stage.Tick(16);
        Assert.True(stage.Lines[stage.Active].RightAligned);
    }

    static LineView Laid(params (string Word, long Ms)[] words)
    {
        var at = 10_000L;
        var timed = words.Select(w => { var word = new LyricWord(w.Word, at, at + w.Ms); at += w.Ms; return word; }).ToList();
        var line = new LyricLine(string.Join(" ", words.Select(w => w.Word)), 10_000, at, Words: timed);
        var view = new LineView(new Item(line, 10_000, at), 30, plain: false);
        view.Measure(new Avalonia.Size(2000, double.PositiveInfinity));
        return view;
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void WordsHeldASecondOrMoreWithTwoToSevenLettersGlow()
    {
        // Too short a letter, too long a word, held long enough, and the last word sung quickly.
        var view = Laid(("I", 1_000), ("beautiful", 2_000), ("stay", 2_500), ("now", 500));
        var stay = Assert.Single(view.Held);
        Assert.Equal("stay", stay.Word);
        // 2.5 s: swells by √1.25 × 0.6, glows by (2.5/3)³ × 0.5.
        Assert.Equal(Math.Sqrt(1.25) * 0.6, stay.Swell, 6);
        Assert.Equal(Math.Pow(2.5 / 3, 3) * 0.5, stay.Glow, 6);
        // Any held CJK word glows, however short.
        Assert.Equal("爱", Assert.Single(Laid(("爱", 1_500)).Held).Word);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void ALongHeldWordSwellsAndGlowsHalfwayThrough()
    {
        // "long" held 2.8 s as the line's last word: its first letter peaks 1.68 s in.
        var at = 10_000L;
        var timed = new[] { ("I've", 300L), ("been", 300L), ("waiting", 400L), ("so", 300L), ("long", 2_800L) }
            .Select(w => { var word = new LyricWord(w.Item1, at, at + w.Item2); at += w.Item2; return word; }).ToList();
        var doc = Fixtures.Lyrics with { Lines = [new LyricLine("I've been waiting so long", 10_000, at, Words: timed), new LyricLine("Comes back to me", 15_000, 18_000)] };
        var t = 12_900.0;
        var stage = new LyricsStage(() => t, () => true, _ => { });
        var w = new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage };
        w.Show();
        stage.Show(doc);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        Run(stage, 30);
        var line = stage.Lines[stage.Active];
        Assert.True(line.IsLit);
        Assert.Equal("long", Assert.Single(line.Held).Word);
        ShellTests.Shot(w, "lyrics-held");
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void ALinesLastHeldWordGlowsMore()
    {
        var mid = Assert.Single(Laid(("on", 1_200), ("and", 300)).Held);
        var last = Assert.Single(Laid(("and", 300), ("on", 1_200)).Held);
        Assert.Equal(mid.Swell * 1.6, last.Swell, 6);
        Assert.Equal(mid.Glow * 1.5, last.Glow, 6);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void ALineTimedOnlyAsAWholeLightsAllAtOnce()
    {
        // LRCLIB's lines have a start and nothing else.
        var doc = Fixtures.Lyrics with { Sync = "line", Lines = [new LyricLine("Streetlights hum a borrowed tune", 66_000), new LyricLine("We drive until the city's gone", 72_500)] };
        var t = 66_050.0;
        var stage = new LyricsStage(() => t, () => true, _ => { });
        new Avalonia.Controls.Window { Width = 800, Height = 600, Content = stage }.Show();
        stage.Show(doc);
        Avalonia.Threading.Dispatcher.UIThread.RunJobs();
        stage.Tick(16);
        Assert.Equal(1, stage.Lines[stage.Active].SungShare, 3);
        Assert.Equal(0, stage.Lines[stage.Active + 1].SungShare, 3);
        // Word by word, a line is part sung part way through.
        var (_, words, _) = Open(76_800);
        words.Tick(16);
        Assert.InRange(words.Lines[words.Active].SungShare, 0.2, 0.8);
    }

    [Avalonia.Headless.XUnit.AvaloniaFact]
    public void PausedAndSettledTheStageStopsAskingForFrames()
    {
        var (_, stage, _) = Open(76_000, playing: false);
        var busy = true;
        for (var i = 0; i < 300 && busy; i++) busy = stage.Tick(16);
        Assert.False(busy);
        // Paused, nothing is shrunk and every line's background vocals show.
        Assert.All(stage.Lines, l => Assert.Equal(100, l.ScaleNow, 1));
        Assert.True(stage.Lines.Single(l => l.Item.Line?.Background is { Count: > 0 }).ShowBackground);
    }
}
