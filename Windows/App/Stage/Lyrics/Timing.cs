namespace Echo.Stage.Lyrics;

// Time → field state (timing.ts; LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9; Android's Timing.kt): pure
// functions of the document and song time; springs only smooth the result (§6.2).

/// Who holds the anchor from `From`: a line, or nobody (−1); `Next` is the first line to come.
public sealed class Span(double from, int line, int next, double dotsUntil = double.NegativeInfinity)
{
    public double From { get; } = from;
    public int Line { get; } = line;
    public int Next { get; } = next;
    public double DotsUntil { get; set; } = dotsUntil;
}

public sealed record Timeline(IReadOnlyList<LyricLine> Lines, IReadOnlyList<double> Ends, IReadOnlyList<double> Handovers,
    IReadOnlySet<int> Coalesced, IReadOnlyList<Span> Spans);

public sealed record FieldState(int Active, int Next, double HandoverAt, double Phase, bool Dots, double From);

public static class Timing
{
    public static Timeline BuildTimeline(LyricsDoc doc)
    {
        if (doc.Sync == "none")
            return new Timeline(doc.Lines.Where(l => !string.IsNullOrWhiteSpace(l.Text)).ToList(), [], [], new HashSet<int>(), [new Span(0, -1, 0)]);
        // A line-timed line without `end` ends 100 ms before the next timed line, empty ones included.
        var all = doc.Lines;
        var ended = all.Select((l, i) =>
        {
            var next = i + 1 < all.Count ? all[i + 1] : null;
            var end = l.End is { } e ? e
                : l.Words is { Count: > 0 } w ? w[^1].End
                : next is not null ? next.Start - L.LineTimed.EndGapMs
                : l.Start + L.LineTimed.LastLineMs;
            return (Line: l, End: (double)end);
        }).ToList();
        var kept = ended.Where(x => !string.IsNullOrWhiteSpace(x.Line.Text)).ToList();
        var lines = kept.Select(x => x.Line).ToList();
        var ends = kept.Select(x => x.End).ToList();
        var n = lines.Count;
        if (n == 0) return new Timeline(lines, ends, [], new HashSet<int>(), [new Span(0, -1, 0)]);

        double Start(int i) => lines[i].Start;
        double SungEnd(int i) => lines[i].Words is { Count: > 0 } w ? w[^1].End : ends[i];

        var handovers = new List<double>(n);
        for (var i = 0; i < n; i++)
        {
            var lead = i == 0 ? L.Handover.LeadMaxMs : Math.Clamp(Start(i) - SungEnd(i - 1), L.Handover.LeadMinMs, L.Handover.LeadMaxMs);
            handovers.Add(Math.Max(Start(i) - lead, i > 0 ? handovers[i - 1] : double.NegativeInfinity));
        }
        bool IsGap(int i) => Start(i) - (i == 0 ? 0 : ends[i - 1]) >= L.Interlude.MinGapMs;
        // A line followed by the next hand-over within 350 ms never takes the anchor (§9.9).
        var coalesced = Enumerable.Range(0, n - 1).Where(i => handovers[i + 1] - handovers[i] < L.Handover.CoalesceMs).ToHashSet();

        var spans = new List<Span> { new(0, -1, 0) };
        if (IsGap(0)) spans[0].DotsUntil = handovers[0] - L.Interlude.LeaveMs;
        for (var i = 0; i < n; i++)
        {
            if (i > 0 && IsGap(i)) spans.Add(new Span(ends[i - 1], -1, i, handovers[i] - L.Interlude.LeaveMs));
            if (!coalesced.Contains(i)) spans.Add(new Span(handovers[i], i, i + 1));
        }
        spans.Add(new Span(Math.Max(ends[n - 1], handovers[n - 1]), -1, n));
        return new Timeline(lines, ends, handovers, coalesced, spans);
    }

    public static FieldState FieldAt(Timeline tl, double t)
    {
        var i = 0;
        while (i + 1 < tl.Spans.Count && tl.Spans[i + 1].From <= t) i++;
        var s = tl.Spans[i];
        var handoverAt = i + 1 < tl.Spans.Count ? tl.Spans[i + 1].From : double.PositiveInfinity;
        var from = s.Line >= 0 ? tl.Lines[s.Line].Start : s.From;
        var span = handoverAt - from;
        var phase = double.IsPositiveInfinity(handoverAt) ? 0 : span > 0 ? Math.Clamp((t - from) / span, 0, 1) : 1;
        return new FieldState(s.Line, s.Next, handoverAt, phase, t < s.DotsUntil, s.From);
    }
}
