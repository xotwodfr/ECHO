using Echo.Stage.Lyrics;

namespace Echo.Tests;

// The lyric field's model, checked the way Android's PortsTest.kt checks it.
public class LyricsPortsTests
{
    static LyricsDoc Doc(params (string Text, long Start)[] lines) => new("navidrome:t", "word", "fixture", new Attribution("x"),
        lines.Select(l => new LyricLine(l.Text, l.Start, l.Start + 900, Words: [new LyricWord(l.Text, l.Start, l.Start + 900)])).ToList());

    [Fact]
    public void TheTimelineHandsOverBeforeEachLineAndCoalescesLinesTooCloseTogether()
    {
        var tl = Timing.BuildTimeline(Doc(("one", 10_000), ("two", 12_000), ("three", 12_100)));
        // "three" hands over 280 ms after "two" (its lead is clamped to 120 ms): "two" never takes the anchor (§9.9).
        Assert.Contains(1, tl.Coalesced);
        Assert.Equal(0, Timing.FieldAt(tl, 10_000).Active);
        Assert.Equal(-1, Timing.FieldAt(tl, 5_000).Active);
        Assert.True(Timing.FieldAt(tl, 5_000).Dots, "interlude dots before a long intro");
        Assert.Equal(2, Timing.FieldAt(tl, 12_100).Active);
    }

    [Fact]
    public void TheSweepEdgeCrossesEachWordInItsOwnTime()
    {
        var e = Field.LineEdges([new LyricWord("a", 0, 1000), new LyricWord("b", 1000, 2000)], [100f, 100f], 500);
        Assert.Equal(0.5, e[0], 9);
        Assert.True(e[1] < 0 && e[1] > -1, "the next word is reached by the fade ahead");
    }

    [Fact]
    public void SpringsLandInTheSamePlaceAtAnyFrameRate()
    {
        var p = new SpringParams(2.0, 0.8);
        var a = new Spring(0);
        var b = new Spring(0);
        for (var i = 0; i < 60; i++) Springs.Step(a, 1, p, 1000.0 / 60);
        for (var i = 0; i < 144; i++) Springs.Step(b, 1, p, 1000.0 / 144);
        Assert.Equal(a.X, b.X, 9);
    }
}
