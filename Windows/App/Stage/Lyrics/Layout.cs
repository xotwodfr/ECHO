using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using SkiaSharp;
using SkiaSharp.HarfBuzz;

namespace Echo.Stage.Lyrics;

// Line layout (layout.ts; LYRICS_EXPERIENCE.md §3.3; Android's Layout.kt), measured with Skia and HarfBuzz:
// every line is measured once per document and per resize, at active size; depth is a transform, so
// nothing reflows when a line changes state. Each word (and each grapheme of a held word) is also set
// on its own, so the field can light, lift and glow it alone. Sizes are DIPs throughout.

/// One word as drawn: its text at its place in the line (the line box at scale 1), at `Size`.
public sealed record WordDraw(string Text, float X, float Y, float W, float H, float Size, IReadOnlyList<WordDraw> Graphemes);

public sealed record LineLayout(LineBox Box, bool Rtl, float Em, IReadOnlyList<WordDraw> Words,
    IReadOnlyList<IReadOnlyList<WordDraw>> Backing, bool Wash);

public sealed record DocLayout(float FontPx, IReadOnlyList<LineLayout> Lines);

public static partial class Layout
{
    public const float LineHeight = 1.12f;
    public const float LineHeightCjk = 1.2f;
    public const float BgSize = 0.62f;
    const double SizeStep = 0.02;

    /// The lyrics' face: Windows' own bold (the web's font token), else Android's Figtree, emboldened
    /// (it is a variable font, loaded at its default weight).
    public static readonly (SKTypeface Face, bool Embolden) Typeface = FindFace();
    public static readonly SKShaper Shaper = new(Typeface.Face);

    static (SKTypeface, bool) FindFace()
    {
        foreach (var family in new[] { "Segoe UI Variable Display", "Segoe UI" })
            if (SKFontManager.Default.MatchFamily(family, SKFontStyle.Bold) is { } found && found.FamilyName == family) return (found, false);
        using var stream = typeof(Layout).Assembly.GetManifestResourceStream("lyrics.figtree.ttf")!;
        return (SKTypeface.FromStream(stream), true);
    }

    public static SKFont Font(float size) =>
        new(Typeface.Face, size) { Subpixel = true, Edging = SKFontEdging.Antialias, Embolden = Typeface.Embolden };

    /// The shaped width of `text` at `size`.
    public static float Width(string text, float size)
    {
        if (text.Length == 0) return 0;
        using var font = Font(size);
        return Shaper.Shape(text, font).Width;
    }

    /// From a row's top to its baseline, the text centred in the row (LineHeightStyle center).
    public static float Baseline(float size, bool cjk = false)
    {
        using var font = Font(size);
        var m = font.Metrics;
        var lh = (cjk ? LineHeightCjk : LineHeight) * size;
        return (lh - (m.Descent - m.Ascent)) / 2 - m.Ascent;
    }

    static bool InRanges(string text, params (int Lo, int Hi)[] ranges) =>
        text.EnumerateRunes().Any(r => ranges.Any(x => r.Value >= x.Lo && r.Value <= x.Hi));

    static bool IsCjk(string text) =>
        InRanges(text, (0x3040, 0x30FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xAC00, 0xD7AF), (0xF900, 0xFAFF));

    /// Cursive scripts join their letters, so they are never set one box per grapheme.
    static bool IsJoined(string text) =>
        InRanges(text, (0x0600, 0x06FF), (0x0700, 0x074F), (0x0750, 0x077F), (0x07C0, 0x07FF), (0x08A0, 0x08FF), (0x1800, 0x18AF), (0x1E900, 0x1E95F));

    static bool IsRtl(string text)
    {
        foreach (var r in text.EnumerateRunes())
        {
            if (r.Value is >= 0x0590 and <= 0x08FF) return true;
            if (Rune.IsLetter(r)) return false;
        }
        return false;
    }

    public static IReadOnlyList<string> Graphemes(string text)
    {
        var out_ = new List<string>();
        var e = StringInfo.GetTextElementEnumerator(text);
        while (e.MoveNext()) out_.Add(e.GetTextElement());
        return out_;
    }

    /// Held-word emphasis (§5.5): ≥ 1000 ms and 2–7 graphemes (CJK: duration only), never joined scripts.
    public static Emphasis? EmphasisOf(LyricWord w, bool last)
    {
        double dur = w.End - w.Start;
        if (dur < 150 || dur < L.Emphasis.MinMs || IsJoined(w.Text)) return null;
        var n = Graphemes(w.Text).Count;
        if (!IsCjk(w.Text) && (n < L.Emphasis.MinG || n > L.Emphasis.MaxG)) return null;
        var a = Math.Min(1.2, (dur - L.Emphasis.MinMs) / 1500 + 0.6) * (last ? 1.4 : 1.0);
        return new Emphasis(Math.Min(L.Emphasis.SwellMax, 0.05 * a), 0.05, Math.Min(0.04, 0.03 * a), dur / 2.5 / n);
    }

    /// Line-timed sources mark backing vocals with parentheses (§5.6): `lead (backing)`.
    public static (string Lead, IReadOnlyList<string> Backing) SplitBacking(string text)
    {
        var backing = new List<string>();
        var lead = Parens().Replace(text, m =>
        {
            backing.Add(m.Groups[1].Value.Trim());
            return "";
        }).Trim();
        return lead.Length > 0 ? (lead, backing) : (text, []);
    }

    /// Duet sides, once per document (§4.4). Group agents stay centred.
    public static Func<LyricLine, Side> SidesOf(LyricsDoc doc)
    {
        var agents = doc.Lines.Select(l => l.Agent).OfType<string>().Distinct().ToList();
        var flagged = doc.Lines.Any(l => l.OppositeAligned);
        if (!flagged && agents.Count < 2) return _ => Side.Centre;
        var group = (doc.Agents ?? []).Where(a => a.Kind == "group").Select(a => a.Id).ToHashSet();
        return l =>
            l.Agent is { } a && group.Contains(a) ? Side.Centre
            : flagged ? (l.OppositeAligned ? Side.Right : Side.Left)
            : l.Agent is not null && l.Agent != agents[0] ? Side.Right : Side.Left;
    }

    /// The lead as tokens: (text, trailing space, word index), the words of a word-timed line or the
    /// lead's own words for a line-timed one (then the word index is -1).
    static List<(string Text, string Space, int Word)> Tokens(LyricLine line)
    {
        if (line.Words is { Count: > 0 } words)
            return words.Select((w, k) => (w.Text, !w.IsPartOfWord && k < words.Count - 1 ? " " : "", k)).ToList();
        var lead = SplitBacking(line.Text).Lead.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return lead.Select((t, k) => (t, k < lead.Length - 1 ? " " : "", -1)).ToList();
    }

    /// Greedy rows of token indices at `maxW`; a token wider than a row keeps a row of its own.
    static List<List<int>> Rows(List<(string Text, string Space, int Word)> tokens, float size, float maxW)
    {
        var rows = new List<List<int>> { new() };
        var x = 0f;
        for (var i = 0; i < tokens.Count; i++)
        {
            var w = Width(tokens[i].Text, size);
            if (rows[^1].Count > 0 && x + w > maxW)
            {
                rows.Add([]);
                x = 0;
            }
            rows[^1].Add(i);
            x += w + Width(tokens[i].Space, size);
        }
        return rows;
    }

    /// Measures every displayed line at the stage width `width`; `fontPx` is the active size.
    public static DocLayout MeasureDoc(LyricsDoc doc, IReadOnlyList<LyricLine> lines, float width, float fontPx)
    {
        var maxW = Math.Max(1f, (float)(L.MaxWidth * width));
        var side = SidesOf(doc);
        return new DocLayout(fontPx, lines.Select(line => MeasureLine(line, side(line), maxW, fontPx)).ToList());
    }

    static LineLayout MeasureLine(LyricLine line, Side lineSide, float maxW, float fontPx)
    {
        var cjk = IsCjk(line.Text);
        var rtl = IsRtl(line.Text);
        var end = lineSide == Side.Right;
        var tokens = Tokens(line);
        // Two rows at most: shrink by up to 12% (§3.3).
        var size = 1.0;
        var rows = Rows(tokens, (float)(fontPx * size), maxW);
        while (rows.Count > L.MaxRows && size > 1 - L.ShrinkMax + 1e-9)
        {
            size = Math.Max(1 - L.ShrinkMax, size - SizeStep);
            rows = Rows(tokens, (float)(fontPx * size), maxW);
        }
        var em = (float)(fontPx * size);
        var rowH = (cjk ? LineHeightCjk : LineHeight) * em;

        // Each token's place: rows from the start edge (its end for a duet's second voice or RTL).
        var widths = tokens.Select(t => Width(t.Text, em)).ToList();
        var spaces = tokens.Select(t => Width(t.Space, em)).ToList();
        var rowWidths = rows.Select(r => r.Sum(i => widths[i] + spaces[i]) - (r.Count > 0 ? spaces[r[^1]] : 0)).ToList();
        var leadW = rowWidths.DefaultIfEmpty(0).Max();
        var placed = new (float X, float Y)[tokens.Count];
        for (var r = 0; r < rows.Count; r++)
        {
            var start = end || rtl ? leadW - rowWidths[r] : 0;
            var x = 0f;
            foreach (var i in rows[r])
            {
                var lx = rtl ? rowWidths[r] - x - widths[i] : x;
                placed[i] = (start + lx, r * rowH);
                x += widths[i] + spaces[i];
            }
        }

        var words = line.Words is { Count: > 0 } lw
            ? lw.Select((w, k) =>
            {
                var gs = EmphasisOf(w, k == lw.Count - 1) is null ? [] : GraphemesOf(w.Text, em, rowH);
                return new WordDraw(w.Text, placed[k].X, placed[k].Y, widths[k], rowH, em, gs);
            }).ToList()
            // A line-timed line washes as one: its rows, each drawn whole.
            : rows.Where(r => r.Count > 0).Select(r => new WordDraw(string.Join("", r.Select(i => tokens[i].Text + (i == r[^1] ? "" : tokens[i].Space))),
                placed[rtl ? r[^1] : r[0]].X, placed[r[0]].Y, rowWidths[rows.IndexOf(r)], rowH, em, [])).ToList();

        // Backing vocals under the lead line, at 0.62 of its size (§5.6).
        var y = rows.Count * rowH;
        var bg = em * BgSize;
        var bgH = (cjk ? LineHeightCjk : LineHeight) * bg;
        var backing = new List<IReadOnlyList<WordDraw>>();
        if (line.Words is { Count: > 0 })
            foreach (var b in line.Background ?? [])
            {
                var x = 0f;
                var row = new List<WordDraw>();
                foreach (var w in b.Words ?? [new LyricWord(b.Text, b.Start ?? line.Start, b.End ?? line.Start)])
                {
                    var text = w.Text + (w.IsPartOfWord ? "" : " ");
                    var ww = Width(text, bg);
                    row.Add(new WordDraw(text, x, y, ww, bgH, bg, []));
                    x += ww;
                }
                backing.Add(row);
                y += bgH;
            }
        else
            foreach (var t in SplitBacking(line.Text).Backing)
            {
                backing.Add([new WordDraw(t, 0, y, Width(t, bg), bgH, bg, [])]);
                y += bgH;
            }
        var backW = backing.SelectMany(r => r).Select(d => d.X + d.W).DefaultIfEmpty(0).Max();
        var box = new LineBox(Math.Max(leadW, backW), y, lineSide,
            line.Words is { Count: > 0 } lw2
                ? words.Select((d, k) => new WordBox(new RectF(d.X, d.Y, d.W, d.H), EmphasisOf(lw2[k], k == lw2.Count - 1),
                    d.Graphemes.Select(g => new RectF(d.X + g.X, d.Y, g.W, g.H)).ToList())).ToList()
                : []);
        return new LineLayout(box, rtl, em, words, backing, line.Words is not { Count: > 0 });
    }

    static List<WordDraw> GraphemesOf(string text, float em, float rowH)
    {
        var x = 0f;
        var out_ = new List<WordDraw>();
        foreach (var g in Graphemes(text))
        {
            var w = Width(g, em);
            out_.Add(new WordDraw(g, x, 0, w, rowH, em, []));
            x += w;
        }
        return out_;
    }

    [GeneratedRegex(@"\s*\(([^()]+)\)")]
    private static partial Regex Parens();
}
