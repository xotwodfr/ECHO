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

// The lyrics as Apple Music draws them, by the numbers of AMLL (github.com/amll-dev/applemusic-like-lyrics,
// AGPL-3.0 like ECHO; read from packages/core/src/lyric-player and styles, Nov 2026): the behaviour, not
// its code. The words' springs are still Spicy Lyrics' (github.com/Spikerko/spicy-lyrics, AGPL-3.0).

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

/// AMLL's column. Bold lines the larger of 5 % of the window's height and 2.5 % of its width (a column
/// under 500 px, the side panel: 8 % of its width), 1.2 high, 0.4 em above and below each. The first
/// line lit sits with its middle 35 % down. Each line rides its own spring; when the sung line changes
/// the first one in view starts at once and each below it 50 ms later, the gap shrinking 5 % a line past
/// the sung one, so the column ripples. Lines not lit shrink to 97 % (while playing) and blur 1 px plus
/// 1 px a line away, at most 5 px. A click seeks to a line; the wheel scrolls freely and the column
/// comes back 3 s later. Nothing moves while paused and settled.
public sealed class LyricsStage : Panel
{
    const double BackAfterMs = 3000;

    // AMLL's springs (mass, damping, stiffness): a seek, an interlude or the first line glide softly;
    // playing, the stiffness rises from 170 to 220 as lines come faster (100–800 ms apart).
    static readonly (double F, double Zeta) Soft = Spring.Of(0.9, 15, 90);
    static readonly (double F, double Zeta) ScaleSpring = Spring.Of(2, 25, 100);

    static (double F, double Zeta) Playback(double intervalMs)
    {
        var ratio = Math.Pow(1 - (Math.Clamp(intervalMs, 100, 800) - 100) / 700, 0.2);
        var k = 170 + ratio * 50;
        return Spring.Of(0.9, Math.Sqrt(k) * 2.2, k);
    }

    readonly Func<double> clock;
    readonly Func<bool> playing;
    readonly Action<double> seek;
    readonly double fixedSize;
    readonly List<LineView> views = [];
    LyricsDoc? doc;
    Timeline? timeline;
    IReadOnlyList<int> lit = [];
    int active = -2;
    double now, lastT = double.NaN, manual, wheelAt = double.NegativeInfinity, builtSize;
    bool scheduled, hovered;

    /// `clock`: the song's time in ms with the lyrics' offsets applied; `seek` goes to such a time.
    /// `fontSize` 0: AMLL's size from the window.
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
            if (Math.Abs(SizeFor(Bounds.Size) - builtSize) > 0.5 || Math.Abs(PadFor(Bounds.Width) - builtPad) > 0.5) Build();
            Wake();
        };
    }

    bool Narrow(double width) => width < 500;

    /// AMLL's `max(5vh, 2.5vw)`; a narrow column `8vw` of itself.
    double SizeFor(Size size)
    {
        if (fixedSize > 0) return fixedSize;
        if (Narrow(size.Width)) return Math.Max(12, size.Width * 0.08);
        var window = TopLevel.GetTopLevel(this)?.ClientSize ?? size;
        return Math.Max(12, Math.Max(window.Height * 0.05, window.Width * 0.025));
    }

    /// The room either side of a line: 1 em, 20 px in a narrow column.
    double PadFor(double width) => Narrow(width) ? 20 : SizeFor(new Size(width, Bounds.Height));

    double builtPad;

    public double FontSize => builtSize > 0 ? builtSize : SizeFor(Bounds.Size);

    /// The item the column is anchored on (tests read it): the first line lit, else the interlude or
    /// the last line begun; −1 before the first, −2 before any frame.
    public int Active => active;

    /// The items lit now (tests read them).
    public IReadOnlyList<int> Lit => lit;

    /// A line's top as it moves (tests read it).
    public double TopOf(int item) => views[item].Top;

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
        builtSize = SizeFor(Bounds.Size);
        builtPad = PadFor(Bounds.Width);
        timeline = doc is null ? null : new Timeline(doc);
        foreach (var item in timeline?.Items ?? [])
        {
            var view = new LineView(item, builtSize, !timeline!.Synced, builtPad, timeline.HasDuet);
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
        lit = [];
        lastT = double.NaN;
        manual = 0;
        InvalidateMeasure();
        Wake();
    }

    protected override Size MeasureOverride(Size available)
    {
        var width = double.IsInfinity(available.Width) ? 600 : available.Width;
        foreach (var v in views) v.Measure(new Size(width, double.PositiveInfinity));
        return new Size(width, double.IsInfinity(available.Height) ? 400 : available.Height);
    }

    protected override Size ArrangeOverride(Size final)
    {
        // Every line at the top; its spring places it (a render transform).
        foreach (var v in views) v.Arrange(new Rect(0, 0, final.Width, v.DesiredSize.Height));
        return final;
    }

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
        var first = double.IsNaN(lastT);
        // A seek (backwards, or a jump of more than a second): the column glides there, all at once.
        var jumped = first || t < lastT - 200 || t > lastT + dtMs + 1000;
        lastT = t;
        var isPlaying = playing();
        var synced = timeline.Synced;
        var nowLit = timeline.LitAt(t);
        var focus = !synced ? -1 : nowLit.Count > 0 ? nowLit[0] : timeline.ActiveAt(t);
        var latest = nowLit.Count > 0 ? nowLit[^1] : focus;
        bool Holds(int i) => nowLit.Contains(i) || i >= focus && i < latest;
        var changed = focus != active || !nowLit.SequenceEqual(lit);

        // Background vocals take room under their line while it is sung, and always while paused.
        for (var i = 0; i < views.Count; i++) views[i].ShowBackground = !synced || !isPlaying || Holds(i);
        if (!IsMeasureValid || !IsArrangeValid || views.Any(v => !v.IsMeasureValid)) UpdateLayout();
        if (now - wheelAt > BackAfterMs) manual += (0 - manual) * Math.Min(1, dtMs / 120);

        // Where each line goes: stacked, the anchor's middle 35 % down (an interlude takes room only
        // while it holds the column).
        var tops = new double[views.Count];
        double y = 0;
        for (var i = 0; i < views.Count; i++)
        {
            tops[i] = y;
            if (!views[i].Item.Interlude || i == focus) y += views[i].DesiredSize.Height;
        }
        var anchor = Math.Max(focus, 0);
        var offset = (synced ? Bounds.Height * 0.35 - (tops[anchor] + views[anchor].DesiredSize.Height / 2) : 0) + manual;

        var prev = anchor - 1;
        while (prev >= 0 && views[prev].Item.Interlude) prev--;
        var spring = jumped || prev < 0 || views[anchor].Item.Interlude ? Soft : Playback(views[anchor].Item.Start - views[prev].Item.Start);
        var gap = changed && !jumped ? 50.0 : 0;
        var delay = 0.0;
        for (var i = 0; i < views.Count; i++)
        {
            var v = views[i];
            var goal = tops[i] + offset;
            var scale = isPlaying && synced && !Holds(i) ? 97 : 100;
            if (first) v.Snap(goal, scale);
            else v.Aim(goal, scale, spring, now + delay);
            if (goal + v.DesiredSize.Height >= 0)
            {
                delay += gap;
                if (i >= focus) gap /= 1.05;
            }
        }
        active = focus;
        lit = nowLit;

        var busy = isPlaying || Math.Abs(manual) > 0.5;
        var free = hovered || now - wheelAt < BackAfterMs;
        for (var i = 0; i < views.Count; i++)
        {
            var v = views[i];
            busy |= v.Move(now, dtMs, ScaleSpring, Bounds.Width);
            var d = i < focus ? focus - i + 1 : i - latest;
            busy |= v.BlurTo(!synced || free || Holds(i) ? 0 : Math.Min(5, (1 + d) * (Narrow(Bounds.Width) ? 0.8 : 1)), first || jumped ? 1000 : dtMs);
            // Lines well out of view are not drawn.
            v.Opacity = v.Top + v.DesiredSize.Height < -Bounds.Height * 0.4 || v.Top > Bounds.Height * 1.4 ? 0 : 1;
            busy |= v.Step(t, nowLit.Contains(i), first || jumped ? 1000 : dtMs);
        }
        return busy;
    }
}

/// One item of the column: a line (with its background vocals) or the interlude's dots. A line lit is
/// white where sung and half-bright where still to come; a line not lit is dim; between them it fades
/// over about 0.4 s (AMLL's transitions). Background vocals are 0.7 em under the line, at 40 % of its
/// light, sliding up out from under it and growing from 80 % while the line is sung. Each word (or,
/// held a second or more, each letter) has Spicy's three springs — scale (0.88 Hz, ζ 0.64), lift
/// (1.45 Hz, ζ 0.4) and glow (1.18 Hz, ζ 0.56) — chasing its curves as it is sung.
public sealed class LineView : Control
{
    static readonly FontFamily Face = new("avares://ECHO/Assets/Fonts#Pretendard Std");
    static readonly Spline Scale = new((0, 0.95), (0.7, 1.0505), (1, 1));
    static readonly Spline LetterScale = new((0, 0.95), (0.7, 1.175), (1, 1));
    static readonly Spline Lift = new((0, 1 / 100.0), (0.9, -1 / 60.0), (1, 0));
    static readonly Spline LetterLift = new((0, 1 / 100.0), (0.9, -1 / 56.0), (1, 0));
    static readonly Spline Glow = new((0, 0), (0.15, 1), (0.6, 1), (1, 0));
    static readonly IBrush HoverFill = new SolidColorBrush(Color.FromArgb(17, 255, 255, 255)); // #fff1
    static readonly (double F, double Zeta) BgSpring = Spring.Of(1, 20, 50);

    // AMLL adds light (plus-lighter): 20 % to a line not lit; to a lit one 85 % where sung and 34 % still
    // to come; background vocals 40 % of that. Over ECHO's backdrops (about 35 % grey) these whites
    // look the same.
    const double Dim = 0.3, LitSung = 1, LitWaiting = 0.5, Plain = 0.85;
    const double BgDim = 0.12, BgSung = 0.5, BgWaiting = 0.2;

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
    readonly double size, pad;
    readonly bool plain, duetSong;
    readonly List<Piece> pieces = [];
    readonly List<string> words = [];
    int bgFrom = int.MaxValue;
    double bgTop, bgHeight, mainBottom, t;
    bool lit, hover, showBackground = true;
    double blur = -1;

    // The stage's springs for this line: where it is, how big (%), and the move it waits to start.
    Spring y, scale = new(100), fade = new(0), blurring = new(0), bgIn = new(100), bgFade = new(100);
    (double Y, double Scale, double F, double Zeta) goal, next;
    double nextAt = double.NaN;

    public LineView(Item item, double size, bool plain, double pad = 0, bool duetSong = false)
    {
        this.item = item;
        this.size = size;
        this.plain = plain;
        this.pad = pad;
        this.duetSong = duetSong;
        Cursor = plain ? Cursor.Default : new Cursor(StandardCursorType.Hand);
        RenderTransformOrigin = RelativePoint.TopLeft; // the stage's matrix places the line itself
        PointerEntered += (_, _) => { hover = true; InvalidateVisual(); };
        PointerExited += (_, _) => { hover = false; InvalidateVisual(); };
    }

    public Item Item => item;

    /// A duet's other voice sits on the right.
    public bool RightAligned => item.Line?.OppositeAligned == true;

    /// The words as laid out, background vocals last (tests read them).
    public IReadOnlyList<string> Words => words;

    public bool IsLit => lit;

    /// Where the line is (its top) and how big, in % (tests read them).
    public double Top => y.X;
    public double ScaleNow => scale.X;
    public double BlurNow => Math.Max(0, blurring.X);

    /// The background vocals take room under the line.
    public bool ShowBackground
    {
        get => showBackground;
        set
        {
            if (value == showBackground) return;
            showBackground = value;
            InvalidateMeasure();
        }
    }

    /// There at once: the first frame of new lyrics.
    public void Snap(double top, double percent)
    {
        goal = (top, percent, 1, 1);
        nextAt = double.NaN;
        y = new Spring(top);
        scale = new Spring(percent);
    }

    /// Heads for `top` at `percent` on `spring` from time `at`; a move already waiting keeps its start.
    public void Aim(double top, double percent, (double F, double Zeta) spring, double at)
    {
        var last = double.IsNaN(nextAt) ? goal : next;
        if (Math.Abs(last.Y - top) < 0.5 && Math.Abs(last.Scale - percent) < 0.05) return;
        next = (top, percent, spring.F, spring.Zeta);
        nextAt = double.IsNaN(nextAt) ? at : Math.Max(nextAt, at);
    }

    /// Moves the line on to `now`; true while it still moves.
    public bool Move(double now, double dtMs, (double F, double Zeta) scaleSpring, double width)
    {
        if (!double.IsNaN(nextAt) && now >= nextAt)
        {
            goal = next;
            nextAt = double.NaN;
        }
        y.Step(goal.Y, dtMs, goal.F, goal.Zeta);
        scale.Step(goal.Scale, dtMs, scaleSpring.F, scaleSpring.Zeta);
        // Shrinks toward its own edge: the left, the right for the other voice; its middle in height.
        var (ox, oy) = (RightAligned ? width - pad : pad, DesiredSize.Height / 2);
        var s = scale.X / 100;
        RenderTransform = new MatrixTransform(Matrix.CreateTranslation(-ox, -oy) * Matrix.CreateScale(s, s) * Matrix.CreateTranslation(ox, oy + y.X));
        return !double.IsNaN(nextAt) || !y.Settled(goal.Y) || !scale.Settled(goal.Scale);
    }

    /// Blurs toward `sigma` px (a Gaussian's, as CSS blur()) over about 0.4 s; true while it changes.
    public bool BlurTo(double sigma, double dtMs)
    {
        if (dtMs >= 1000) blurring = new Spring(sigma);
        else blurring.Step(sigma, dtMs, 2.5, 1);
        var value = Math.Max(0, blurring.X);
        if (Math.Abs(value - blur) >= 0.05)
        {
            blur = value;
            // Avalonia's radius r blurs with sigma ≈ 0.577 r + 0.5.
            Effect = value <= 0.5 ? null : new BlurEffect { Radius = (value - 0.5) / 0.57735 };
        }
        return !blurring.Settled(sigma);
    }

    /// Moves the springs on to `time`; true while any still moves.
    public bool Step(double time, bool isLit, double dtMs)
    {
        var changed = isLit != lit || Math.Abs(time - t) > 0.5;
        t = time;
        lit = isLit;
        var busy = false;
        if (dtMs >= 1000)
        {
            // A seek: the line's light and its background vocals are there at once.
            (fade, bgIn, bgFade) = (new Spring(isLit ? 100 : 0), new Spring(showBackground ? 100 : 0), new Spring(showBackground ? 100 : 0));
        }
        else
        {
            fade.Step(isLit ? 100 : 0, dtMs, 2.5, 1);
            bgIn.Step(showBackground ? 100 : 0, dtMs, BgSpring.F, BgSpring.Zeta);
            bgFade.Step(showBackground ? 100 : 0, dtMs, 3.3, 1);
            busy |= !fade.Settled(isLit ? 100 : 0) || !bgIn.Settled(showBackground ? 100 : 0) || !bgFade.Settled(showBackground ? 100 : 0);
        }
        foreach (var p in pieces)
        {
            var (sc, lift, glow) = Targets(p);
            if (dtMs >= 1000)
            {
                (p.S, p.L, p.G) = (new Spring(sc), new Spring(lift), new Spring(glow)); // a seek: there at once
                continue;
            }
            p.S.Step(sc, dtMs, 0.88, 0.64);
            p.L.Step(lift, dtMs, 1.45, 0.4);
            p.G.Step(glow, dtMs, 1.18, 0.56);
            busy |= !p.S.Settled(sc) || !p.L.Settled(lift) || !p.G.Settled(glow);
        }
        if (busy || changed || item.Interlude && isLit) InvalidateVisual();
        return busy || item.Interlude && time >= item.Start && time < item.End;
    }

    /// Where a piece's springs head at time t: its curves at its progress (at rest before it, settled
    /// after); a letter's lean toward the one being sung (Spicy: 1 / (1 + d^2.8), glow 1 / (1 + 0.9 d)).
    (double Scale, double Lift, double Glow) Targets(Piece p)
    {
        if (plain) return (1, 0, 0);
        if (!p.Letter)
        {
            var x = Progress(p.Start, p.End);
            return (Scale.At(x), Lift.At(x), lit ? Glow.At(x) : 0);
        }
        var share = (p.WordEnd - p.WordStart) / p.Of;
        var at0 = (int)Math.Floor((t - p.WordStart) / Math.Max(1, share));
        var mine = Progress(p.Start, p.End);
        if (at0 < 0 || at0 >= p.Of) return (LetterScale.At(mine), LetterLift.At(mine), 0);
        var d = Math.Abs(p.Index - at0);
        var fall = 1 / (1 + Math.Pow(d, 2.8));
        var glowFall = 1 / (1 + 0.9 * d);
        var at = (t - (p.WordStart + at0 * share)) / Math.Max(1, share);
        double Lean(Spline s) => s.At(0) + (s.At(at) - s.At(0)) * fall;
        // Letters already sung keep their settled place; those to come lean toward the lit one.
        return p.Index < at0
            ? (LetterScale.At(1) + (LetterScale.At(at) - LetterScale.At(1)) * fall, LetterLift.At(1) + (LetterLift.At(at) - LetterLift.At(1)) * fall, lit ? Glow.At(at) * glowFall : 0)
            : (Lean(LetterScale), Lean(LetterLift), lit ? Glow.At(at) * glowFall : 0);
    }

    double Progress(double start, double end) => end <= start ? (t >= start ? 1 : 0) : Math.Clamp((t - start) / (end - start), 0, 1);

    protected override Size MeasureOverride(Size available)
    {
        pieces.Clear();
        words.Clear();
        bgFrom = int.MaxValue;
        var width = double.IsInfinity(available.Width) ? 600 : available.Width;
        if (item.Line is not { } line) return new Size(width, size * 2);
        // AMLL: 0.4 em above and below; in a song with a duet, each voice keeps 15 % clear on the far side.
        var inner = Math.Max(1, width - pad * 2);
        var room = duetSong ? inner * 0.85 : inner;
        var left = RightAligned ? pad + inner - room : pad;
        mainBottom = Flow(Split(line.Words, line.Text, line.Start, line.End ?? line.Start + 4000), size, size * 0.4, left, room, line.Words is not { Count: > 0 });
        bgFrom = pieces.Count;
        bgTop = mainBottom + size * 0.2;
        var bottom = bgTop;
        foreach (var bg in line.Background ?? [])
            bottom = Flow(Split(bg.Words, bg.Text, bg.Start ?? line.Start, bg.End ?? line.End ?? line.Start + 4000), size * 0.7, bottom, left, room, bg.Words is not { Count: > 0 });
        bgHeight = bottom - bgTop;
        return new Size(width, (showBackground && bgHeight > 0 ? bottom : mainBottom) + size * 0.4);
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

    /// Lays the words in rows `width` wide from (`left`, `top`), as text wraps; returns the bottom.
    double Flow(List<(string Text, double Start, double End)> source, double em, double top, double left, double width, bool lineTimed)
    {
        var row = new List<Piece>();
        double x = 0, y = top, lineHeight = em * 1.2;
        void End()
        {
            var shift = left + (RightAligned && row.Count > 0 ? width - row.Max(p => p.X + p.W) : 0);
            for (var i = 0; i < row.Count; i++) row[i] = Moved(row[i], shift);
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
            context.DrawRectangle(HoverFill, null, new RoundedRect(new Rect(Bounds.Size), size * 0.25));
        if (item.Interlude)
        {
            if (t >= item.Start && t < item.End) Dots(context);
            return;
        }
        for (var i = 0; i < pieces.Count; i++)
        {
            var p = pieces[i];
            var bg = i >= bgFrom;
            if (bg && bgFade.X < 1) continue;
            var box = new Rect(p.X, p.Y, p.W, p.Em * 1.2);
            // Scale from the piece's foot, lift by its em (Spicy's translate in --DefaultLyricsSize).
            var m = Matrix.CreateTranslation(-box.Center.X, -box.Bottom) * Matrix.CreateScale(p.S.X, p.S.X) * Matrix.CreateTranslation(box.Center.X, box.Bottom + p.L.X * p.Em);
            if (bg)
            {
                // Out from under the line: from 80 % of its own height up and 80 % of its size.
                var k = Math.Clamp(bgIn.X / 100, 0, 1);
                var (ox, oy) = (RightAligned ? Bounds.Width - pad : pad, bgTop);
                var s = 0.8 + 0.2 * k;
                m *= Matrix.CreateTranslation(-ox, -oy) * Matrix.CreateScale(s, s) * Matrix.CreateTranslation(ox, oy - 0.8 * (1 - k) * bgHeight);
            }
            var shown = bg ? Math.Clamp(bgFade.X / 100, 0, 1) : 1;
            using var _ = context.PushTransform(m);
            if (p.G.X > 0.01 && p.Outline is { } outline) context.Custom(new GlowOp(box.Inflate(16), outline, p.G.X * shown));
            p.Shape.SetForegroundBrush(Fill(p, bg, shown));
            context.DrawText(p.Shape, new Point(p.X, p.Y));
        }
    }

    static Color White(double alpha) => Color.FromArgb((byte)Math.Clamp(255 * alpha, 0, 255), 255, 255, 255);

    /// The colour across a piece: dim, or as the line lights, white where sung and half-bright still to
    /// come, the edge at −20 % + 120 % of the progress with a 20 % fade (Spicy's --gradient-position).
    IBrush Fill(Piece p, bool bg, double shown)
    {
        if (plain) return new SolidColorBrush(White(Plain));
        var f = Math.Clamp(fade.X / 100, 0, 1);
        var (dim, on, waiting) = bg ? (BgDim, BgSung, BgWaiting) : (Dim, LitSung, LitWaiting);
        var sung = White((dim + (on - dim) * f) * shown);
        var toCome = White((dim + (waiting - dim) * f) * shown);
        var pos = (-20 + 120 * Progress(p.Start, p.End)) / 100;
        if (pos <= -0.2) return new SolidColorBrush(toCome);
        if (pos >= 1) return new SolidColorBrush(sung);
        return new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative),
            EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(sung, Math.Clamp(pos, 0, 1)),
                new GradientStop(toCome, Math.Clamp(pos + 0.2, 0, 1)),
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
            var on = Math.Clamp(p * 3 - i, 0, 1);
            var r = size * 0.13 * breathe * outro * (1 + 0.2 * on);
            var alpha = (byte)(255 * (0.35 + 0.5 * on));
            var centre = new Point(pad + size * 0.2 + i * size * 0.45, size);
            if (on > 0.01) context.DrawEllipse(new SolidColorBrush(Color.FromArgb((byte)(60 * on), 255, 255, 255)), null, centre, r * 1.6, r * 1.6);
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
