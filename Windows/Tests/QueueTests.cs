using Echo.Playback;

namespace Echo.Tests;

public class QueueTests
{
    internal static IReadOnlyList<Track> Album(int n, string id = "a") => Enumerable.Range(0, n)
        .Select(i => new Track($"navidrome:{id}{i}", $"{id}{i}", $"Song {i}", [new ArtistRef(null, "Artist")],
            new AlbumRef(id, "Album", $"navidrome:{id}"), 200_000, ContentType: "audio/flac"))
        .ToList();

    static readonly PlayContext Ctx = new("album", "a", "Album");

    [Fact]
    public void ShuffleOffOverAWholeLibraryIsQuick()
    {
        // Played from Songs: 22,000 songs, each looked for in a list of 22,000 froze the window.
        var q = new Queue();
        q.PlayList(Album(22_000), 0, Ctx);
        q.SetShuffle(true, new Random(1));
        var clock = System.Diagnostics.Stopwatch.StartNew();
        q.SetShuffle(false, new Random(1));
        Assert.True(clock.ElapsedMilliseconds < 200, $"{clock.ElapsedMilliseconds} ms");
        Assert.Equal("a1", q.Context[0].Id);
        Assert.Equal("a21999", q.Context[^1].Id);
    }

    [Fact]
    public void NextUpPlaysBeforeTheContext()
    {
        var q = new Queue();
        q.PlayList(Album(3), 0, Ctx);
        var extra = Album(1, "x")[0];
        q.AddToQueue(extra);
        Assert.Equal(extra, q.Advance(userSkip: true));
        Assert.Equal("a1", q.Advance(userSkip: true)!.Id);
    }

    [Fact]
    public void PlayNextGoesFirstAndAddToQueueLast()
    {
        var q = new Queue();
        q.PlayList(Album(2), 0, Ctx);
        var (x, y) = (Album(1, "x")[0], Album(1, "y")[0]);
        q.AddToQueue(x);
        q.PlayNext(y);
        Assert.Equal([y, x], q.NextUp);
    }

    [Fact]
    public void RepeatOneRepeatsOnlyWhenTheSongEnds()
    {
        var q = new Queue { Repeat = Repeat.One };
        q.PlayList(Album(3), 0, Ctx);
        Assert.Equal("a0", q.Advance(userSkip: false)!.Id);
        Assert.Equal("a1", q.Advance(userSkip: true)!.Id);
    }

    [Fact]
    public void TheEndStopsUnlessRepeatAll()
    {
        var q = new Queue();
        q.PlayList(Album(2), 1, Ctx);
        Assert.Null(q.Advance(userSkip: false));
        q.Repeat = Repeat.All;
        Assert.Equal("a0", q.Advance(userSkip: false)!.Id);
    }

    [Fact]
    public void ShuffleKeepsTheCurrentSongAndEveryOtherOnce()
    {
        var all = Album(10);
        var q = new Queue();
        q.PlayList(all, 3, Ctx);
        q.SetShuffle(true, new Random(7));
        Assert.Equal("a3", q.Now!.Id);
        Assert.Equal(all.Skip(4).Select(t => t.Id).Order(), q.Context.Select(t => t.Id).Order());
        Assert.NotEqual(all.Skip(4).Select(t => t.Id), q.Context.Select(t => t.Id)); // seed 7 moves something
        q.SetShuffle(false, new Random(7));
        Assert.Equal(all.Skip(4).Select(t => t.Id), q.Context.Select(t => t.Id));
    }

    [Fact]
    public void MoveAndRemoveIndexNextUpThenTheContext()
    {
        var q = new Queue();
        q.PlayList(Album(4), 0, Ctx);
        var x = Album(1, "x")[0];
        q.AddToQueue(x); // upcoming: x | a1 a2 a3
        q.Move(0, 2); // Next up keeps its size (1): x moves into the context, a1 into Next up
        Assert.Equal(["a1", "a2", "x0", "a3"], q.Upcoming.Select(t => t.Id));
        q.Remove(1);
        Assert.Equal(["a1", "x0", "a3"], q.Upcoming.Select(t => t.Id));
    }

    [Fact]
    public void TheSavedStateRoundTrips()
    {
        var q = new Queue();
        q.PlayList(Album(5), 2, Ctx);
        q.PlayNext(Album(1, "x")[0]);
        var back = Queue.FromState(q.ToState());
        Assert.Equal(q.Now, back.Now);
        Assert.Equal(q.Upcoming.Select(t => t.Id), back.Upcoming.Select(t => t.Id));
        Assert.Equal(q.History.Select(t => t.Id), back.History.Select(t => t.Id));
        Assert.Equal(Ctx, back.Source);
    }
}
