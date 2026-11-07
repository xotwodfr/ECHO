using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace Echo.Stage;

/// Apple Music's lyrics, as Cider 4 shows them (numbers in docs/DESIGN_RESEARCH.md §3.2, from AMLL and
/// Spicy Lyrics): a left-aligned column of bold lines, the current one's top at 35 % of the height; when
/// the singing moves on, the lines glide on springs one after another (50 ms apart, each step 5 %
/// shorter); the others at 35 %, a little smaller, blurred by distance (1 + d px, at most 5) until the
/// pointer is over them. Word-timed lines light word by word with a soft edge, each word lifting as it
/// is sung, held words swelling; long gaps show three breathing dots. A click seeks to a line; the wheel
/// scrolls freely and the column comes back 3 s later. Nothing moves while paused and settled.
public sealed class LyricsStage : Panel
{
    const double Anchor = 0.35, Rest = 0.35, Smaller = 0.96, BackAfterMs = 3000;

    readonly Func<double> clock;
    readonly Func<bool> playing;
    readonly Action<double> seek;
    readonly List<LineView> views = [];
    Timeline? timeline;
    Spring[] y = [];
    double[] scale = [];
    double[] moveAt = [];
    int active = -2;
    double now, lastT = double.NaN, manual, wheelAt = double.NegativeInfinity;
    bool scheduled, hovered;

    /// `clock`: the song's time in ms with the lyrics' offsets applied; `seek` goes to such a time.
    public LyricsStage(Func<double> clock, Func<bool> playing, Action<double> seek, double fontSize)
    {
        this.clock = clock;
        this.playing = playing;
        this.seek = seek;
        FontSize = fontSize;
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
        SizeChanged += (_, _) => Wake();
    }

    public double FontSize { get; }

    /// The item holding the column (tests read it); −1 before the first, −2 before any frame.
    public int Active => active;

    /// A line's top as it moves (tests read it).
    public double TopOf(int item) => y[item].X;

    public IReadOnlyList<LineView> Lines => views;

    public void Show(LyricsDoc? doc)
    {
        Children.Clear();
        views.Clear();
        timeline = doc is null ? null : new Timeline(doc);
        var items = timeline?.Items ?? [];
        foreach (var item in items)
        {
            var view = new LineView(item, FontSize, !timeline!.Synced);
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
        y = new Spring[items.Count];
        scale = Enumerable.Repeat(Smaller, items.Count).ToArray();
        moveAt = new double[items.Count];
        active = -2;
        lastT = double.NaN;
        manual = 0;
        InvalidateMeasure();
        Wake();
    }

    protected override Size MeasureOverride(Size available)
    {
        var w = Math.Max(1, (double.IsInfinity(available.Width) ? 600 : available.Width) - Pad * 2);
        foreach (var v in views) v.Measure(new Size(w, double.PositiveInfinity));
        return new Size(double.IsInfinity(available.Width) ? 600 : available.Width, double.IsInfinity(available.Height) ? 400 : available.Height);
    }

    protected override Size ArrangeOverride(Size final)
    {
        foreach (var v in views) v.Arrange(new Rect(Pad, 0, final.Width - Pad * 2, v.DesiredSize.Height));
        return final;
    }

    double Pad => Math.Max(16, Bounds.Width * 0.05);

    void Hover(bool on)
    {
        hovered = on;
        Wake();
    }

    /// Asks for frames until the column settles (and the song is paused): after a seek, a new song,
    /// play.
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
        // New lines (a song, a resize) are measured before anything is placed by them.
        if (!IsMeasureValid || views.Any(v => !v.IsMeasureValid)) UpdateLayout();
        var t = clock();
        // A seek (backwards, or a jump of more than a second): no glide, the column is there at once.
        var jumped = !double.IsNaN(lastT) && (t < lastT - 200 || t > lastT + dtMs + 1000);
        var first = double.IsNaN(lastT);
        lastT = t;
        var now1 = timeline.ActiveAt(t);
        if (now1 != active)
        {
            for (var i = 0; i < views.Count; i++) moveAt[i] = now + Timeline.StaggerMs(Math.Max(0, i - Math.Max(now1, 0) + 1));
            active = now1;
        }
        if (now - wheelAt > BackAfterMs) manual += (0 - manual) * Math.Min(1, dtMs / 120);

        // Where each line belongs: the current one's top at 35 %, the others stacked from it.
        // An interlude takes room only while it plays (Apple Music folds the dots away otherwise).
        var gap = FontSize * 0.45;
        var tops = new double[views.Count];
        for (var i = 1; i < views.Count; i++)
            tops[i] = tops[i - 1] + (views[i - 1].Item.Interlude && i - 1 != active ? 0 : views[i - 1].DesiredSize.Height + gap);
        var holder = timeline.Synced ? Math.Max(active, 0) : 0;
        var anchor = timeline.Synced ? Bounds.Height * Anchor : FontSize;
        var busy = playing() || Math.Abs(manual) > 0.5;
        var free = hovered || now - wheelAt < BackAfterMs;
        for (var i = 0; i < views.Count; i++)
        {
            var target = anchor + tops[i] - tops[holder] + manual;
            if (first || jumped) y[i] = new Spring(target);
            else if (now >= moveAt[i]) y[i].Step(target, dtMs);
            busy |= !y[i].Settled(target);

            var v = views[i];
            var current = i == active;
            var d = Math.Abs(i - Math.Max(active, 0));
            var sTarget = current || !timeline.Synced ? 1 : Smaller;
            scale[i] += (sTarget - scale[i]) * (first || jumped ? 1 : Math.Min(1, dtMs / 90));
            busy |= Math.Abs(scale[i] - sTarget) > 0.001;
            var o = current || !timeline.Synced ? 1 : Rest;
            v.Opacity += (o - v.Opacity) * (first || jumped ? 1 : Math.Min(1, dtMs / 110));
            busy |= Math.Abs(v.Opacity - o) > 0.005;
            v.Blur = !timeline.Synced || free || current ? 0 : Math.Min(1 + d, 5);
            var h = v.DesiredSize.Height;
            var originX = v.RightAligned ? v.Bounds.Width : 0;
            v.RenderTransform = new MatrixTransform(
                Matrix.CreateTranslation(-originX, -h / 2) * Matrix.CreateScale(scale[i], scale[i]) * Matrix.CreateTranslation(originX, h / 2 + y[i].X));
            v.Show(t, current);
        }
        return busy;
    }
}

/// One item of the column: a line (with its background vocals) or the interlude's dots, drawn word by
/// word so that each word can light and lift on its own.
public sealed class LineView : Control
{
    static readonly FontFamily Face = new("avares://ECHO/Assets/Fonts#Pretendard Std");
    static readonly IBrush Lit = Brushes.White, Dim = new SolidColorBrush(Color.FromArgb(90, 255, 255, 255));
    static readonly IBrush HoverFill = new SolidColorBrush(Color.FromArgb(20, 255, 255, 255));

    sealed record Word(LyricWord? Timing, string Source, FormattedText Text, double X, double Y, double Width, double Size);

    readonly Item item;
    readonly double size;
    readonly bool plain;
    readonly List<Word> words = [];
    double t;
    bool current, hover;
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
    public IReadOnlyList<string> Words => words.Select(w => w.Source.Trim()).ToList();

    /// Blur in px (CSS's sense); set only when it changes, each change is a new layer.
    public double Blur
    {
        set
        {
            if (Math.Abs(value - blur) < 0.01) return;
            blur = value;
            Effect = value <= 0 ? null : new BlurEffect { Radius = value * 2 };
        }
    }

    /// The song's time; the current line redraws its words each frame, the rest only when that changes.
    public void Show(double time, bool isCurrent)
    {
        var redraw = isCurrent || isCurrent != current || item.Interlude && time >= item.Start && time <= item.End + 500;
        t = time;
        current = isCurrent;
        if (redraw) InvalidateVisual();
    }

    protected override Size MeasureOverride(Size available)
    {
        words.Clear();
        if (item.Line is not { } line) return new Size(available.Width, size * 1.2);
        var width = double.IsInfinity(available.Width) ? 600 : available.Width;
        var y = Flow(Split(line.Words, line.Text), size, 0, width);
        foreach (var bg in line.Background ?? [])
            y = Flow(Split(bg.Words, bg.Text), size * 0.6, y + size * 0.15, width);
        return new Size(width, y);
    }

    static IEnumerable<(LyricWord? Timing, string Text)> Split(IReadOnlyList<LyricWord>? timed, string text) =>
        timed is { Count: > 0 }
            ? timed.Select((w, i) => ((LyricWord?)w, w.IsPartOfWord || i == timed.Count - 1 ? w.Text : w.Text + " "))
            : text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w => ((LyricWord?)null, w + " "));

    /// Lays words in rows within `width` from `top`, as text wraps; returns the bottom.
    double Flow(IEnumerable<(LyricWord? Timing, string Text)> source, double em, double top, double width)
    {
        var row = new List<Word>();
        double x = 0, y = top, lineHeight = em * 1.22;
        void End()
        {
            if (RightAligned && row.Count > 0)
            {
                var shift = width - row.Max(w => w.X + w.Width);
                for (var i = 0; i < row.Count; i++) row[i] = row[i] with { X = row[i].X + shift };
            }
            words.AddRange(row);
            row.Clear();
        }
        foreach (var (timing, text) in source)
        {
            var f = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
                new Typeface(Face, FontStyle.Normal, FontWeight.Bold), em, Lit);
            var w = f.WidthIncludingTrailingWhitespace;
            if (x > 0 && x + f.Width > width)
            {
                End();
                x = 0;
                y += lineHeight;
            }
            row.Add(new Word(timing, text, f, x, y, f.Width, em));
            x += w;
        }
        End();
        return y + lineHeight;
    }

    public override void Render(DrawingContext context)
    {
        if (hover && !plain)
            context.DrawRectangle(HoverFill, null, new RoundedRect(new Rect(Bounds.Size).Inflate(new Thickness(size * 0.35, size * 0.15)), size * 0.3));
        if (item.Interlude)
        {
            if (current) Dots(context);
            return;
        }
        var synced = !plain;
        var lineTimed = item.Line?.Words is not { Count: > 0 };
        foreach (var w in words)
        {
            // Off the current line every word is plain white (the line's opacity dims it).
            var fill = !current || !synced ? 1.0
                : w.Timing is { } timing ? Timeline.Fill(timing, t)
                : lineTimed && t >= item.Start ? 1.0 : 0.0;
            var lift = 0.0;
            var grow = 1.0;
            if (current && synced && w.Timing is { } tw && fill > 0)
            {
                lift = -0.05 * w.Size * Ease(fill);
                if (Timeline.Emphasised(tw) && fill < 1)
                {
                    var swell = Math.Sin(Math.PI * fill);
                    grow = 1 + 0.08 * swell;
                    lift -= 0.06 * w.Size * swell;
                }
            }
            var box = new Rect(w.X, w.Y, w.Width, w.Size * 1.22);
            var centre = box.Center;
            using var _ = context.PushTransform(Matrix.CreateTranslation(-centre.X, -centre.Y) * Matrix.CreateScale(grow, grow) * Matrix.CreateTranslation(centre.X, centre.Y + lift));
            if (fill >= 1)
            {
                w.Text.SetForegroundBrush(Lit);
                context.DrawText(w.Text, new Point(w.X, w.Y));
                continue;
            }
            w.Text.SetForegroundBrush(Dim);
            context.DrawText(w.Text, new Point(w.X, w.Y));
            if (fill <= 0) continue;
            // The sung part, its edge soft over half the font size, running on into the next word.
            var edge = w.Size * 0.5;
            var at = w.X + fill * w.Width;
            var mask = new Rect(w.X - edge, w.Y, w.Width + edge * 2, box.Height);
            var a = (at - edge / 2 - mask.X) / mask.Width;
            var b = (at + edge / 2 - mask.X) / mask.Width;
            var brush = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative),
                EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Colors.Black, Math.Clamp(a, 0, 1)), new GradientStop(Colors.Transparent, Math.Clamp(b, 0, 1)) },
            };
            using (context.PushOpacityMask(brush, mask))
            {
                w.Text.SetForegroundBrush(Lit);
                context.DrawText(w.Text, new Point(w.X, w.Y));
            }
        }
    }

    static double Ease(double f) => 1 - Math.Pow(1 - f, 3);

    /// The interlude: three dots that breathe (4 s) and light one by one over the gap, shrinking away
    /// in its last half second.
    void Dots(DrawingContext context)
    {
        var span = Math.Max(1, item.End - item.Start);
        var p = Math.Clamp((t - item.Start) / span, 0, 1);
        var breathe = 1 + 0.08 * Math.Sin(2 * Math.PI * (t - item.Start) / 4000);
        var outro = Math.Clamp((item.End - t) / 500, 0, 1);
        var r = size * 0.16 * breathe * (current ? outro : 1);
        for (var i = 0; i < 3; i++)
        {
            var lit = Math.Clamp(p * 3 - i, 0, 1);
            var alpha = (byte)(255 * (0.35 + 0.65 * (current ? lit : 0)));
            context.DrawEllipse(new SolidColorBrush(Color.FromArgb(alpha, 255, 255, 255)), null,
                new Point(size * 0.2 + i * size * 0.5, size * 0.6), r, r);
        }
    }
}
