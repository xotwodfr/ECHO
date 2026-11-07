namespace Echo.Stage;

/// One place in the lyrics' column: a sung line, or an interlude's dots standing in a long gap.
public sealed record Item(LyricLine? Line, double Start, double End)
{
    public bool Interlude => Line is null;
}

/// What is sung when (Apple Music's lyrics as AMLL and Spicy Lyrics measure them, DESIGN_RESEARCH.md
/// §3.2): the column's items in order, with dots where the singing stops for 7 s or more (and before the
/// first line, when it comes that late); which item holds the column at a time; how far a word is sung.
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
    }

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

    /// How much of a word is sung at `t`, 0–1.
    public static double Fill(LyricWord w, double t) =>
        w.End <= w.Start ? (t >= w.Start ? 1 : 0) : Math.Clamp((t - w.Start) / (w.End - w.Start), 0, 1);

    /// A held word grows and lifts (≥ 1 s, 2–12 letters, as Spicy Lyrics and Beautiful Lyrics have it).
    public static bool Emphasised(LyricWord w) =>
        w.End - w.Start >= 1000 && w.Text.Count(char.IsLetter) is >= 2 and <= 12;

    /// When a line `steps` away from the new current one starts moving: 50 ms per line, each step 5 %
    /// shorter than the one before (AMLL).
    public static double StaggerMs(int steps)
    {
        double total = 0, step = 50;
        for (var k = 0; k < steps; k++, step /= 1.05) total += step;
        return total;
    }
}
