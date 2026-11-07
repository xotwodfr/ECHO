using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Rendering.SceneGraph;
using Avalonia.Skia;
using SkiaSharp;

namespace Echo.Stage;

// The lyrics as Spicy Lyrics (github.com/Spikerko/spicy-lyrics, AGPL-3.0 like ECHO; its default mode,
// read from src/utils/Lyrics/Animator, css/Lyrics/Mixed.css, main.css, LyricsVirtualizer.ts) draws
// them, its numbers ported to Avalonia: the behaviour, not its code.

/// A natural cubic spline through (time, value) points, held flat outside them (Spicy's GetSpline).
public sealed class Spline
{
    readonly double[] x, y, m;

    public Spline(params (double T, double V)[] points)
    {
        x = points.Select(p => p.T).ToArray();
        y = points.Select(p => p.V).ToArray();
        var n = x.Length;
        m = new double[n];
        if (n < 3) return;
        // The second derivatives, natural ends (zero there).
        var b = new double[n];
        var c = new double[n];
        var r = new double[n];
        var a = new double[n];
        for (var i = 1; i < n - 1; i++)
        {
            a[i] = x[i] - x[i - 1];
            b[i] = 2 * (x[i + 1] - x[i - 1]);
            c[i] = x[i + 1] - x[i];
            r[i] = 6 * ((y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]));
        }
        for (var i = 2; i < n - 1; i++)
        {
            var k = a[i] / b[i - 1];
            b[i] -= k * c[i - 1];
            r[i] -= k * r[i - 1];
        }
        for (var i = n - 2; i >= 1; i--) m[i] = (r[i] - c[i] * m[i + 1]) / b[i];
    }

    public double At(double t)
    {
        if (t <= x[0]) return y[0];
        if (t >= x[^1]) return y[^1];
        var i = 0;
        while (t > x[i + 1]) i++;
        var h = x[i + 1] - x[i];
        var (u, w) = ((x[i + 1] - t) / h, (t - x[i]) / h);
        return u * y[i] + w * y[i + 1] + ((u * u * u - u) * m[i] + (w * w * w - w) * m[i + 1]) * h * h / 6;
    }
}

/// Spicy Lyrics' column: the lines left-aligned at 7 % of the width (between 29.6 and 56 px), bold;
/// the current line centred, the whole column gliding there as one block; the lines sung at 85 %
/// white, those to come at 50 %, each blurred 1.25 px (a text-shadow's radius) a line away from the
/// current one, at most 6.8 px; no line shrinks. A click seeks to a line; the wheel scrolls freely and
/// the column comes back 3 s later. Nothing moves while paused and settled.
public sealed class LyricsStage : Panel
{
    const double BackAfterMs = 3000;

    readonly Func<double> clock;
    readonly Func<bool> playing;
    readonly Action<double> seek;
    readonly double fixedSize;
    readonly List<LineView> views = [];
    LyricsDoc? doc;
    Timeline? timeline;
    Spring scroll;
    int active = -2;
    double now, lastT = double.NaN, manual, wheelAt = double.NegativeInfinity, builtSize;
    bool scheduled, hovered;

    /// `clock`: the song's time in ms with the lyrics' offsets applied; `seek` goes to such a time.
    /// `fontSize` 0: Spicy's size from the width.
    public LyricsStage(Func<double> clock, Func<bool> playing, Action<double> seek, double fontSize = 0)
    {
        this.clock = clock;
        this.playing = playing;
        this.seek = seek;
        fixedSize = fontSize;
        ClipToBounds = true;
        Background = Brushes.Transparent; // the wheel and hover reach the empty parts too
        PointerEntered += (_, _) => Hover(true);
        PointerExited += (_, _) => Hover(false);
        PointerWheelChanged += (_, e) =>
        {
            manual += e.Delta.Y * FontSize * 2;
            wheelAt = now;
            Wake();
        };
        AttachedToVisualTree += (_, _) => Wake();
        SizeChanged += (_, _) =>
        {
            if (Math.Abs(SizeFor(Bounds.Width) - builtSize) > 0.5) Build();
            Wake();
        };
    }

    /// Spicy's `clamp(1.85rem, 7cqw, 3.5rem)`.
    double SizeFor(double width) => fixedSize > 0 ? fixedSize : Math.Clamp(width * 0.07, 29.6, 56);

    public double FontSize => builtSize > 0 ? builtSize : SizeFor(Bounds.Width);

    /// The item holding the column (tests read it); −1 before the first, −2 before any frame.
    public int Active => active;

    /// A line's top as the column moves (tests read it).
    public double TopOf(int item) => views[item].Bounds.Y + scroll.X;

    public IReadOnlyList<LineView> Lines => views;

    public void Show(LyricsDoc? lyrics)
    {
        doc = lyrics;
        Build();
    }

    void Build()
    {
        Children.Clear();
        views.Clear();
        builtSize = SizeFor(Bounds.Width);
        timeline = doc is null ? null : new Timeline(doc);
        foreach (var item in timeline?.Items ?? [])
        {
            var view = new LineView(item, builtSize, !timeline!.Synced);
            view.PointerPressed += (_, e) =>
            {
                if (!e.GetCurrentPoint(view).Properties.IsLeftButtonPressed || !timeline.Synced) return;
                seek(item.Start);
                manual = 0;
                wheelAt = double.NegativeInfinity;
            };
            views.Add(view);
            Children.Add(view);
        }
        active = -2;
        lastT = double.NaN;
        manual = 0;
        InvalidateMeasure();
        Wake();
    }

    protected override Size MeasureOverride(Size available)
    {
        var width = double.IsInfinity(available.Width) ? 600 : available.Width;
        foreach (var v in views) v.Measure(new Size(Math.Max(1, width - Pad * 2), double.PositiveInfinity));
        return new Size(width, double.IsInfinity(available.Height) ? 400 : available.Height);
    }

    protected override Size ArrangeOverride(Size final)
    {
        // The lines one under another, a third of the font size apart; the column moves by transform.
        // An interlude takes room only while it plays.
        double y = 0;
        for (var i = 0; i < views.Count; i++)
        {
            var v = views[i];
            v.Arrange(new Rect(Pad, y, final.Width - Pad * 2, v.DesiredSize.Height));
            if (!v.Item.Interlude || i == active) y += v.DesiredSize.Height + FontSize * 0.34;
        }
        return final;
    }

    double Pad => Math.Max(16, Bounds.Width * 0.05);

    void Hover(bool on)
    {
        hovered = on;
        Wake();
    }

    /// Asks for frames until the column and its words settle (and the song is paused): after a seek,
    /// a new song, play.
    public void Wake()
    {
        if (scheduled || TopLevel.GetTopLevel(this) is not { } top) return;
        scheduled = true;
        var last = TimeSpan.Zero;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan at)
        {
            var dt = last == TimeSpan.Zero ? 16 : (at - last).TotalMilliseconds;
            last = at;
            var busy = Tick(dt);
            if (busy && TopLevel.GetTopLevel(this) is not null) top.RequestAnimationFrame(Frame);
            else scheduled = false;
        }
    }

    /// One frame of `dtMs`: the column follows the song. True while anything still moves.
    public bool Tick(double dtMs)
    {
        now += dtMs;
        if (timeline is null || views.Count == 0) return false;
        var t = clock();
        // A seek (backwards, or a jump of more than a second): the column is there at once.
        var jumped = double.IsNaN(lastT) || t < lastT - 200 || t > lastT + dtMs + 1000;
        lastT = t;
        var now1 = timeline.ActiveAt(t);
        if (now1 != active)
        {
            active = now1;
            InvalidateArrange(); // an interlude opens or folds
        }
        if (!IsMeasureValid || !IsArrangeValid || views.Any(v => !v.IsMeasureValid)) UpdateLayout();
        if (now - wheelAt > BackAfterMs) manual += (0 - manual) * Math.Min(1, dtMs / 120);

        // The current line's middle at the middle of the stage (Spicy scrolls it to "center").
        double target;
        if (!timeline.Synced) target = FontSize + manual;
        else
        {
            var holder = views[Math.Max(active, 0)];
            target = Bounds.Height / 2 - (holder.Bounds.Y + holder.Bounds.Height / 2) + manual;
        }
        if (jumped) scroll = new Spring(target);
        else scroll.Step(target, dtMs, f: 1.3, zeta: 1);
        var busy = playing() || !scroll.Settled(target) || Math.Abs(manual) > 0.5;
        var free = hovered || now - wheelAt < BackAfterMs;
        for (var i = 0; i < views.Count; i++)
        {
            var v = views[i];
            var d = Math.Abs(i - Math.Max(active, 0));
            // Spicy's blur is a text-shadow of 1.25 px a line, at most 6.8 px: a Gaussian of half that.
            v.Blur = !timeline.Synced || free || i == active ? 0 : Math.Min(1.25 * d, 1.25 * 5.465) / 2;
            v.RenderTransform = new MatrixTransform(Matrix.CreateTranslation(0, scroll.X));
            var state = !timeline.Synced ? LineState.Sung : i == active ? LineState.Active : v.Item.Start <= t ? LineState.Sung : LineState.NotSung;
            busy |= v.Step(t, state, jumped ? 1000 : dtMs);
        }
        return busy;
    }
}

public enum LineState { NotSung, Active, Sung }

/// One item of the column: a line (with its background vocals) or the interlude's dots. Each word (or,
/// held a second or more, each letter) has Spicy's three springs — scale (0.88 Hz, ζ 0.64), lift
/// (1.45 Hz, ζ 0.4) and glow (1.18 Hz, ζ 0.56) — chasing its curves as it is sung: from 95 % up past
/// 105 % to 100 %, from 1/100 em down to 1/60 em up and back, the glow up in its first 15 % and down
/// after 60 %. The sung part of a word is 85 % white, the rest 40 % (a 20 % fade between).
public sealed class LineView : Control
{
    static readonly FontFamily Face = new("avares://ECHO/Assets/Fonts#Pretendard Std");
    static readonly Spline Scale = new((0, 0.95), (0.7, 1.0505), (1, 1));
    static readonly Spline LetterScale = new((0, 0.95), (0.7, 1.175), (1, 1));
    static readonly Spline Lift = new((0, 1 / 100.0), (0.9, -1 / 60.0), (1, 0));
    static readonly Spline LetterLift = new((0, 1 / 100.0), (0.9, -1 / 56.0), (1, 0));
    static readonly Spline Glow = new((0, 0), (0.15, 1), (0.6, 1), (1, 0));
    static readonly Color Sung = Color.FromArgb(217, 255, 255, 255), Waiting = Color.FromArgb(128, 255, 255, 255), Unsung = Color.FromArgb(102, 255, 255, 255);
    static readonly IBrush HoverFill = new SolidColorBrush(Color.FromArgb(20, 255, 255, 255));

    /// A word or a letter of a held word, with its springs.
    sealed class Piece(string text, FormattedText shape, SKPath? outline, double x, double y, double w, double em, double start, double end, bool letter)
    {
        public readonly string Text = text;
        public readonly FormattedText Shape = shape;
        public readonly SKPath? Outline = outline;
        public readonly double X = x, Y = y, W = w, Em = em, Start = start, End = end;
        public readonly bool Letter = letter;
        public Spring S = new(0.95), L = new(1 / 100.0), G = new(0);
        /// Where a letter sits in its word, and how many there are (for the wave's falloff).
        public int Index, Of = 1;
        public double WordStart, WordEnd;
    }

    readonly Item item;
    readonly double size;
    readonly bool plain;
    readonly List<Piece> pieces = [];
    readonly List<string> words = [];
    double t;
    LineState state = LineState.NotSung;
    bool hover;
    double blur = -1;

    public LineView(Item item, double size, bool plain)
    {
        this.item = item;
        this.size = size;
        this.plain = plain;
        Cursor = plain ? Cursor.Default : new Cursor(StandardCursorType.Hand);
        RenderTransformOrigin = RelativePoint.TopLeft; // the stage's matrix places the line itself
        PointerEntered += (_, _) => { hover = true; InvalidateVisual(); };
        PointerExited += (_, _) => { hover = false; InvalidateVisual(); };
    }

    public Item Item => item;

    /// A duet's other voice sits on the right.
    public bool RightAligned => item.Line?.OppositeAligned == true;

    /// The words as laid out (tests read them).
    public IReadOnlyList<string> Words => words;

    public LineState State => state;

    /// Blur as a Gaussian's sigma in px; set only when it changes, each change is a new layer.
    public double Blur
    {
        set
        {
            if (Math.Abs(value - blur) < 0.05) return;
            blur = value;
            // Avalonia's radius r blurs with sigma ≈ 0.577 r + 0.5.
            Effect = value <= 0.5 ? null : new BlurEffect { Radius = (value - 0.5) / 0.57735 };
        }
    }

    /// Moves the springs on to `time`; true while any still moves.
    public bool Step(double time, LineState s, double dtMs)
    {
        var changed = s != state || Math.Abs(time - t) > 0.5;
        t = time;
        state = s;
        var busy = false;
        foreach (var p in pieces)
        {
            var (scale, lift, glow) = Targets(p);
            if (dtMs >= 1000)
            {
                (p.S, p.L, p.G) = (new Spring(scale), new Spring(lift), new Spring(glow)); // a seek: there at once
                continue;
            }
            p.S.Step(scale, dtMs, 0.88, 0.64);
            p.L.Step(lift, dtMs, 1.45, 0.4);
            p.G.Step(glow, dtMs, 1.18, 0.56);
            busy |= !p.S.Settled(scale) || !p.L.Settled(lift) || !p.G.Settled(glow);
        }
        if (busy || changed || item.Interlude && s == LineState.Active) InvalidateVisual();
        return busy || item.Interlude && s == LineState.Active;
    }

    /// Where a piece's springs head at time t: its curves at its progress (at rest before it, settled
    /// after); a letter's lean toward the one being sung (Spicy: 1 / (1 + d^2.8), glow 1 / (1 + 0.9 d)).
    (double Scale, double Lift, double Glow) Targets(Piece p)
    {
        if (plain) return (1, 0, 0);
        if (!p.Letter)
        {
            var x = Progress(p.Start, p.End);
            return (Scale.At(x), Lift.At(x), state == LineState.Active ? Glow.At(x) : 0);
        }
        var share = (p.WordEnd - p.WordStart) / p.Of;
        var lit = (int)Math.Floor((t - p.WordStart) / Math.Max(1, share));
        var mine = Progress(p.Start, p.End);
        if (lit < 0 || lit >= p.Of) return (LetterScale.At(mine), LetterLift.At(mine), 0);
        var d = Math.Abs(p.Index - lit);
        var fall = 1 / (1 + Math.Pow(d, 2.8));
        var glowFall = 1 / (1 + 0.9 * d);
        var at = (t - (p.WordStart + lit * share)) / Math.Max(1, share);
        double Lean(Spline s) => s.At(0) + (s.At(at) - s.At(0)) * fall;
        // Letters already sung keep their settled place; those to come lean toward the lit one.
        return p.Index < lit
            ? (LetterScale.At(1) + (LetterScale.At(at) - LetterScale.At(1)) * fall, LetterLift.At(1) + (LetterLift.At(at) - LetterLift.At(1)) * fall, state == LineState.Active ? Glow.At(at) * glowFall : 0)
            : (Lean(LetterScale), Lean(LetterLift), state == LineState.Active ? Glow.At(at) * glowFall : 0);
    }

    double Progress(double start, double end) => end <= start ? (t >= start ? 1 : 0) : Math.Clamp((t - start) / (end - start), 0, 1);

    protected override Size MeasureOverride(Size available)
    {
        pieces.Clear();
        words.Clear();
        if (item.Line is not { } line) return new Size(available.Width, size * 1.2);
        var width = double.IsInfinity(available.Width) ? 600 : available.Width;
        var y = Flow(Split(line.Words, line.Text, line.Start, line.End ?? line.Start + 4000), size, 0, width, line.Words is not { Count: > 0 });
        foreach (var bg in line.Background ?? [])
            y = Flow(Split(bg.Words, bg.Text, bg.Start ?? line.Start, bg.End ?? line.End ?? line.Start + 4000), size * 0.55, y + size * 0.1, width, bg.Words is not { Count: > 0 });
        return new Size(width, y);
    }

    /// The words with their times; a line timed only as a whole is spread over its length by
    /// characters, so the light runs across it as Spicy's line lyrics do.
    static List<(string Text, double Start, double End)> Split(IReadOnlyList<LyricWord>? timed, string text, double start, double end)
    {
        if (timed is { Count: > 0 })
            return timed.Select((w, i) => (w.IsPartOfWord || i == timed.Count - 1 ? w.Text : w.Text + " ", (double)w.Start, (double)w.End)).ToList();
        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var total = Math.Max(1, parts.Sum(p => p.Length + 1));
        var list = new List<(string, double, double)>();
        var at = start;
        foreach (var p in parts)
        {
            var span = (end - start) * (p.Length + 1) / total;
            list.Add((p + " ", at, at + span));
            at += span;
        }
        return list;
    }

    static FormattedText Shape(string text, double em) => new(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
        new Typeface(Face, FontStyle.Normal, FontWeight.Bold), em, Brushes.White);

    /// Lays the words in rows within `width` from `top`, as text wraps; returns the bottom.
    double Flow(List<(string Text, double Start, double End)> source, double em, double top, double width, bool lineTimed)
    {
        var row = new List<Piece>();
        double x = 0, y = top, lineHeight = em * 1.2;
        void End()
        {
            if (RightAligned && row.Count > 0)
            {
                var shift = width - row.Max(p => p.X + p.W);
                for (var i = 0; i < row.Count; i++) row[i] = Moved(row[i], shift);
            }
            pieces.AddRange(row);
            row.Clear();
        }
        foreach (var (text, start, end) in source)
        {
            words.Add(text.Trim());
            var whole = Shape(text, em);
            if (x > 0 && x + whole.Width > width)
            {
                End();
                x = 0;
                y += lineHeight;
            }
            // A word held a second or more is sung letter by letter (Spicy's IsLetterCapable).
            var letters = text.TrimEnd();
            if (!plain && !lineTimed && end - start >= 1000 && letters.Length > 1)
            {
                var share = (end - start) / letters.Length;
                for (var i = 0; i < letters.Length; i++)
                {
                    var before = i == 0 ? 0 : Shape(letters[..i], em).WidthIncludingTrailingWhitespace;
                    var shape = Shape(letters[i].ToString(), em);
                    row.Add(new Piece(letters[i].ToString(), shape, Outline(letters[i].ToString(), em, x + before, y + shape.Baseline), x + before, y, shape.WidthIncludingTrailingWhitespace, em,
                        start + i * share, start + (i + 1) * share, letter: true) { Index = i, Of = letters.Length, WordStart = start, WordEnd = end });
                }
            }
            else row.Add(new Piece(text, whole, plain ? null : Outline(text.TrimEnd(), em, x, y + whole.Baseline), x, y, whole.Width, em, start, end, letter: false));
            x += whole.WidthIncludingTrailingWhitespace;
        }
        End();
        return y + lineHeight;
    }

    static readonly Lazy<SKTypeface> Bold = new(() => SKTypeface.FromStream(AssetLoader.Open(new Uri("avares://ECHO/Assets/Fonts/PretendardStd-Bold.otf"))));

    /// The glyphs' outline at their place in the line, for the glow.
    static SKPath Outline(string text, double em, double x, double baseline)
    {
        using var font = new SKFont(Bold.Value, (float)em);
        return font.GetTextPath(text, new SKPoint((float)x, (float)baseline));
    }

    static Piece Moved(Piece p, double dx)
    {
        var outline = p.Outline is null ? null : new SKPath(p.Outline);
        outline?.Transform(SKMatrix.CreateTranslation((float)dx, 0));
        return new(p.Text, p.Shape, outline, p.X + dx, p.Y, p.W, p.Em, p.Start, p.End, p.Letter)
        {
            Index = p.Index, Of = p.Of, WordStart = p.WordStart, WordEnd = p.WordEnd,
        };
    }


    public override void Render(DrawingContext context)
    {
        if (hover && !plain)
            context.DrawRectangle(HoverFill, null, new RoundedRect(new Rect(Bounds.Size).Inflate(new Thickness(size * 0.3, size * 0.12)), size * 0.25));
        if (item.Interlude)
        {
            if (state == LineState.Active) Dots(context);
            return;
        }
        foreach (var p in pieces)
        {
            var box = new Rect(p.X, p.Y, p.W, p.Em * 1.2);
            // Scale from the piece's foot, lift by its em (Spicy's translate in --DefaultLyricsSize).
            var m = Matrix.CreateTranslation(-box.Center.X, -box.Bottom) * Matrix.CreateScale(p.S.X, p.S.X) * Matrix.CreateTranslation(box.Center.X, box.Bottom + p.L.X * p.Em);
            using var _ = context.PushTransform(m);
            if (p.G.X > 0.01 && p.Outline is { } outline) context.Custom(new GlowOp(box.Inflate(16), outline, p.G.X));
            p.Shape.SetForegroundBrush(Fill(p));
            context.DrawText(p.Shape, new Point(p.X, p.Y));
        }
    }

    /// The colour across a piece: past lines 85 %, lines to come 50 %; on the current line the sung
    /// part 85 % and the rest 40 %, the edge at −20 % + 120 % of the progress with a 20 % fade (Spicy's
    /// --gradient-position).
    IBrush Fill(Piece p)
    {
        if (plain || state == LineState.Sung) return new SolidColorBrush(Sung);
        if (state == LineState.NotSung) return new SolidColorBrush(Waiting);
        var pos = (-20 + 120 * Progress(p.Start, p.End)) / 100;
        if (pos <= -0.2) return new SolidColorBrush(Unsung);
        if (pos >= 1) return new SolidColorBrush(Sung);
        return new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative),
            EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(Sung, Math.Clamp(pos, 0, 1)),
                new GradientStop(Unsung, Math.Clamp(pos + 0.2, 0, 1)),
            },
        };
    }

    /// The interlude: three dots, at rest 35 %, lighting and swelling one after another over the gap,
    /// the group breathing (4 s) and shrinking away in its last half second.
    void Dots(DrawingContext context)
    {
        var span = Math.Max(1, item.End - item.Start);
        var p = Math.Clamp((t - item.Start) / span, 0, 1);
        var breathe = 1 + 0.06 * Math.Sin(2 * Math.PI * (t - item.Start) / 4000);
        var outro = Math.Clamp((item.End - t) / 500, 0, 1);
        for (var i = 0; i < 3; i++)
        {
            var lit = Math.Clamp(p * 3 - i, 0, 1);
            var r = size * 0.13 * breathe * outro * (1 + 0.2 * lit);
            var alpha = (byte)(255 * (0.35 + 0.5 * lit));
            var centre = new Point(size * 0.2 + i * size * 0.45, size * 0.6);
            if (lit > 0.01) context.DrawEllipse(new SolidColorBrush(Color.FromArgb((byte)(60 * lit), 255, 255, 255)), null, centre, r * 1.6, r * 1.6);
            context.DrawEllipse(new SolidColorBrush(Color.FromArgb(alpha, 255, 255, 255)), null, centre, r, r);
        }
    }

    /// Spicy's glow: a white text-shadow of (4 + 2g) px at 35 % × g, drawn as the glyphs' outline under
    /// Skia's blur mask (a Gaussian of half the radius), in the line's current transform.
    sealed class GlowOp(Rect bounds, SKPath outline, double g) : ICustomDrawOperation
    {
        public Rect Bounds => bounds;
        public bool HitTest(Point p) => false;
        public bool Equals(ICustomDrawOperation? other) => false;
        public void Dispose() { }

        public void Render(ImmediateDrawingContext context)
        {
            if (context.TryGetFeature<ISkiaSharpApiLeaseFeature>() is not { } feature) return;
            using var lease = feature.Lease();
            using var paint = new SKPaint
            {
                IsAntialias = true,
                Color = new SKColor(255, 255, 255, (byte)Math.Clamp(255 * 0.35 * g, 0, 255)),
                MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, (float)((4 + 2 * g) / 2)),
            };
            lease.SkCanvas.DrawPath(outline, paint);
        }
    }
}
