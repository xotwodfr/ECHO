namespace Echo.Stage;

/// One place in the lyrics' column: a sung line, or an interlude's dots standing in a long gap.
public sealed record Item(LyricLine? Line, double Start, double End)
{
    public bool Interlude => Line is null;
}

/// What is sung when: the column's items in order, with dots where the singing stops for 7 s or more (and
/// before the first line, when it comes that late); which item holds the column at a time; how far a
/// word is sung.
public sealed class Timeline
{
    public const double InterludeMs = 7000;

    public Timeline(LyricsDoc doc)
    {
        Synced = doc.Sync != "none";
        var items = new List<Item>();
        var lines = doc.Lines;
        for (var i = 0; i < lines.Count; i++)
        {
            var start = lines[i].Start;
            var gapFrom = i == 0 ? 0 : EndOf(lines[i - 1], start);
            if (Synced && start - gapFrom >= InterludeMs) items.Add(new Item(null, gapFrom, start));
            items.Add(new Item(lines[i], start, EndOf(lines[i], i + 1 < lines.Count ? lines[i + 1].Start : start + 5000)));
        }
        Items = items;
        // A line stays lit past its end until a line begins after it ended.
        litUntil = new double[items.Count];
        for (var i = 0; i < items.Count; i++)
        {
            litUntil[i] = double.PositiveInfinity;
            for (var j = i + 1; j < items.Count; j++)
                if (!items[j].Interlude && items[j].Start >= items[i].End)
                {
                    litUntil[i] = items[j].Start;
                    break;
                }
        }
        lastEnd = items.Count == 0 ? 0 : items.Max(i => i.End);
        HasDuet = lines.Any(l => l.OppositeAligned);
    }

    readonly double[] litUntil;
    readonly double lastEnd;

    /// Some lines are the other voice's (they sit on the right).
    public bool HasDuet { get; }

    public IReadOnlyList<Item> Items { get; }

    /// Untimed lyrics (`sync: none`) only list.
    public bool Synced { get; }

    /// A line ends with its last word, or its own end, or where the next begins.
    static double EndOf(LyricLine l, double next) =>
        l.Words is { Count: > 0 } w ? w[^1].End : l.End ?? next;

    /// The item holding the column at `t` (ms, offsets applied): the last one begun; −1 before any. An
    /// interlude holds only until its line, which then takes over.
    public int ActiveAt(double t)
    {
        if (!Synced) return -1;
        var active = -1;
        for (var i = 0; i < Items.Count && Items[i].Start <= t; i++) active = i;
        return active;
    }

    /// The lines lit at `t`, in order (AMLL's highlighted lines): each from its start until a line begins
    /// after it has ended, so a finished line stays readable through the gap and overlapping lines (a
    /// duet) light together; none while an interlude's dots hold the column, nor after the last line.
    public IReadOnlyList<int> LitAt(double t)
    {
        var lit = new List<int>();
        var active = ActiveAt(t);
        if (active < 0 || Items[active].Interlude || t >= lastEnd) return lit;
        for (var i = 0; i < Items.Count && Items[i].Start <= t; i++)
            if (!Items[i].Interlude && t < litUntil[i]) lit.Add(i);
        return lit;
    }

    /// How much of a word is sung at `t`, 0–1.
    public static double Fill(LyricWord w, double t) =>
        w.End <= w.Start ? (t >= w.Start ? 1 : 0) : Math.Clamp((t - w.Start) / (w.End - w.Start), 0, 1);
}
