using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Rendering.SceneGraph;
using Avalonia.Skia;
using SkiaSharp;
using SkiaSharp.HarfBuzz;
using Echo.Ui;

namespace Echo.Stage.Lyrics;

// The lyric field (field.ts and stage.css; LYRICS_EXPERIENCE.md §3–§9; Android's LyricsField.kt): each
// line is a layer whose position, scale, opacity and depth blur the model sets every frame; its words
// are drawn one by one with the sweep (lit → the highlight's edge → unlit), their rise and swell, the
// glow, and held words grapheme by grapheme. Each frame the model steps on the UI thread and a copy of
// what it says is drawn with Skia on the render thread.

public sealed class LyricsField : Control
{
    static readonly Linear TextInk = new(0.8878f, 0.8796f, 0.8550f); // --text #F2F1EE, linear

    readonly LyricsDoc doc;
    readonly Func<double> songMs;
    readonly Func<bool> playing;
    readonly Func<Features> features;
    readonly Timeline tl;
    readonly Stopwatch clock = Stopwatch.StartNew();
    DocLayout? layout;
    FieldModel? model;
    double last = -1;

    /// `songMs`: the song time the lyrics follow (the player's position, offsets applied).
    public LyricsField(LyricsDoc doc, Func<double> songMs, Func<bool> playing, Func<Features> features, StagePalette palette)
    {
        this.doc = doc;
        this.songMs = songMs;
        this.playing = playing;
        this.features = features;
        Palette = palette;
        tl = Timing.BuildTimeline(doc);
        ClipToBounds = true;
    }

    public StagePalette Palette { get; set; }
    /// The lyric size setting, × the active size.
    public double Scale { get; set; } = 1;
    public bool Reduced { get; set; }
    /// Px kept clear at the bottom (the transport): the column fades out above it.
    public double Dock { get; set; }
    /// The key light under the sung word, stage uv (y down), for the room.
    public Action<double, double>? KeyLight { get; set; }
    /// A line was clicked: play from its start (song ms).
    public event Action<double>? Seek;

    /// Where the sung line is now (this control's DIPs), or null between lines.
    public Rect? ActiveLine { get; private set; }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Seen.Resumed += InvalidateVisual;
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        Seen.Resumed -= InvalidateVisual;
        base.OnDetachedFromVisualTree(e);
    }

    sealed record InstFrame(int I, double X, double Y, double Scale, double Opacity, double Blur, double Mix, double Fade, double Wash,
        double[] Edge, double[] Wy, double[] Ws, double[] Glow, double GlowR, double[][] Emph, double[][] Backing);

    sealed record Frame(IReadOnlyList<InstFrame> Insts, DocLayout Layout, StagePalette Palette, double W, double Hs, double H,
        double DotsOpacity, double[] DotScale, double[] DotAlpha, double Dock);

    IReadOnlyList<InstFrame> shown = [];

    public override void Render(DrawingContext context)
    {
        var W = Bounds.Width;
        var Hs = Bounds.Height;
        if (W < 1 || Hs < 1) return;
        var H = Math.Max(1, Hs - Dock);
        // --ly-active for the full-screen room: clamp(32px, min(6.2vh, 4.6vw), 88px) × the size setting (§4.3).
        var fontPx = (float)(Math.Clamp(Math.Min(Hs * 0.062, W * 0.046), 32, 88) * Scale);
        if (layout is null || Math.Abs(layout.FontPx - fontPx) > 0.01 || Math.Abs(measuredW - W) > 0.5)
        {
            layout = Layout.MeasureDoc(doc, tl.Lines, (float)W, fontPx);
            measuredW = W;
            model = new FieldModel(tl, layout.Lines.Select(l => l.Box).ToList(), fontPx * Layout.LineHeight);
        }
        var now = clock.Elapsed.TotalMilliseconds;
        var dt = last < 0 ? 0 : Math.Clamp(now - last, 0, 100);
        last = now;
        model!.Update(songMs(), dt, playing(), Mode.Run, W, H, features(), Reduced);
        if (model.Key is { } k) KeyLight?.Invoke(k.X, k.Y * H / Hs);
        ActiveLine = model.Insts.TryGetValue(model.Active, out var a) && layout.Lines[a.I].Box is var box
            ? new Rect(a.X.X - box.W / 2, a.Y.X - box.H / 2, box.W, box.H)
            : null;

        shown = model.Insts.Values.Concat(model.Leaving).Select(i => new InstFrame(i.I, i.X.X, i.Y.X, i.Scale, i.Opacity, i.Blur, i.Mix,
            i.Fade, i.Wash, (double[])i.Edge.Clone(), (double[])i.Wy.Clone(), (double[])i.Ws.Clone(), (double[])i.Glow.Clone(), i.GlowR,
            i.Emph.Select(e => e.Select(s => s.X).ToArray()).ToArray(), i.Backing.Select(b => (double[])b.Clone()).ToArray())).ToList();
        context.Custom(new Draw(new Rect(Bounds.Size), new Frame(shown, layout, Palette, W, Hs, H, model.Dots.Opacity,
            (double[])model.Dots.Scale.Clone(), (double[])model.Dots.Alpha.Clone(), Dock)));
        if (IsEffectivelyVisible && Seen.Allowed) TopLevel.GetTopLevel(this)?.RequestAnimationFrame(_ => InvalidateVisual());
    }

    double measuredW;

    // A click on a line plays from it (Spotify's).
    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (layout is null) return;
        var p = e.GetPosition(this);
        foreach (var inst in shown)
        {
            var b = layout.Lines[inst.I].Box;
            if (Math.Abs(p.X - inst.X) <= b.W / 2 && Math.Abs(p.Y - inst.Y) <= b.H / 2)
            {
                Seek?.Invoke(tl.Lines[inst.I].Start);
                e.Handled = true;
                return;
            }
        }
    }

    /// Two linear colours mixed in OKLab, as sRGB.
    static SKColor Mix(Linear a, Linear b, double k)
    {
        var p = Oklab.LinearToOklab(a.R, a.G, a.B);
        var q = Oklab.LinearToOklab(b.R, b.G, b.B);
        var r = Oklab.OklabToLinear(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k);
        return new SKColor(new Linear((float)Math.Clamp(r[0], 0, 1), (float)Math.Clamp(r[1], 0, 1), (float)Math.Clamp(r[2], 0, 1)).ToArgb());
    }

    static Linear ToLinear(SKColor c) => new((float)Oklab.SrgbToLinear(c.Red / 255.0), (float)Oklab.SrgbToLinear(c.Green / 255.0),
        (float)Oklab.SrgbToLinear(c.Blue / 255.0));

    /// A word's inks (stage.css): unlit toward the room by Mix, lit toward ink by Fade (§5.1, §7).
    sealed class Inks
    {
        public readonly SKColor Unlit, Lit, Edge, Glow;

        public Inks(StagePalette p, InstFrame inst, bool right)
        {
            var litBase = ToLinear(Mix(TextInk, p.Highlight, 0.18));
            if (right) litBase = ToLinear(Mix(litBase, p.Accent, 0.25));
            Unlit = Mix(p.Ink, p.Room, inst.Mix);
            Lit = Mix(litBase, p.Ink, inst.Fade);
            Edge = new SKColor(p.Highlight.ToArgb());
            Glow = new SKColor(p.Glow.ToArgb());
        }
    }

    sealed class Draw(Rect bounds, Frame f) : ICustomDrawOperation
    {
        public Rect Bounds => bounds;
        public bool HitTest(Point p) => false;
        public bool Equals(ICustomDrawOperation? other) => false;
        public void Dispose() { }

        public void Render(ImmediateDrawingContext context)
        {
            if (context.TryGetFeature<ISkiaSharpApiLeaseFeature>() is not { } feature) return;
            using var lease = feature.Lease();
            var canvas = lease.SkCanvas;
            var area = new SKRect(0, 0, (float)f.W, (float)f.Hs);
            canvas.Save();
            canvas.ClipRect(area);
            canvas.SaveLayer(area, null);
            foreach (var inst in f.Insts) Line(canvas, inst, f.Layout.Lines[inst.I]);
            Dots(canvas);
            // The column fades out under the top chrome and just above the dock (§3.2).
            var dockK = (float)(f.Dock / f.Hs);
            using var mask = new SKPaint
            {
                BlendMode = SKBlendMode.DstIn,
                Shader = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(0, (float)f.Hs),
                    [SKColors.Transparent, SKColors.Black, SKColors.Black, SKColors.Transparent],
                    [0.04f, 0.18f, Math.Max(0.19f, 1 - dockK - 0.12f), 1 - dockK], SKShaderTileMode.Clamp),
            };
            canvas.DrawRect(area, mask);
            canvas.Restore();
            canvas.Restore();
        }

        void Line(SKCanvas canvas, InstFrame inst, LineLayout lay)
        {
            var pad = lay.Em * 0.5f;
            var w = lay.Box.W + 2 * pad;
            var h = lay.Box.H + 2 * pad;
            var right = lay.Box.Side == Side.Right;
            canvas.Save();
            canvas.Translate((float)(inst.X - lay.Box.W / 2 - pad), (float)(inst.Y - lay.Box.H / 2 - pad));
            // Lines start at the column's edge and scale from it (stage.css .ly-line).
            canvas.Scale((float)inst.Scale, (float)inst.Scale, right || lay.Rtl ? w - pad : pad, h / 2);
            var blur = (float)inst.Blur;
            using var layer = new SKPaint
            {
                Color = SKColors.White.WithAlpha((byte)Math.Clamp(inst.Opacity * 255, 0, 255)),
                ImageFilter = blur > 0.05f ? SKImageFilter.CreateBlur(blur, blur) : null,
            };
            canvas.SaveLayer(new SKRect(-3 * blur, -3 * blur, w + 3 * blur, h + 3 * blur), layer);
            canvas.Translate(pad, pad);
            var inks = new Inks(f.Palette, inst, right);
            if (lay.Wash)
                foreach (var d in lay.Words) Word(canvas, d, inst.Wash, 0, 1, 0, 0, lay, inks);
            else
                for (var k = 0; k < lay.Words.Count; k++)
                {
                    var d = lay.Words[k];
                    var g = k < inst.Glow.Length ? inst.Glow[k] : 0;
                    var emph = k < inst.Emph.Length ? inst.Emph[k] : [];
                    if (d.Graphemes.Count > 0 && emph.Length > 0)
                        GraphemesOf(canvas, d, inst.Edge[k], emph, lay, inks, g, inst.GlowR, lay.Box.Words[k].Emphasis);
                    else Word(canvas, d, inst.Edge[k], inst.Wy[k], inst.Ws[k], g, inst.GlowR, lay, inks);
                }
            // Backing vocals under their lead, at 0.55 of its opacity (§5.6).
            using (var dim = new SKPaint { Color = SKColors.White.WithAlpha(140) })
            {
                canvas.SaveLayer(dim);
                for (var j = 0; j < lay.Backing.Count; j++)
                    for (var k = 0; k < lay.Backing[j].Count; k++)
                    {
                        var p = j < inst.Backing.Length && k < inst.Backing[j].Length ? inst.Backing[j][k] : lay.Wash ? inst.Wash : Field.Unreached;
                        Word(canvas, lay.Backing[j][k], p, 0, 1, 0, 0, lay, inks);
                    }
                canvas.Restore();
            }
            canvas.Restore();
            canvas.Restore();
        }

        /// The sweep (§5.1): lit up to 0.6 em behind the edge, the highlight at it, unlit 0.35 em ahead.
        static void Ink(SKPaint paint, double p, float w, float em, Inks inks, bool rtl)
        {
            var ahead = L.Sweep.EdgeAhead * em / Math.Max(1f, w);
            var behind = L.Sweep.EdgeBehind * em / Math.Max(1f, w);
            paint.Shader = null;
            if (p <= -ahead) paint.Color = inks.Unlit;
            else if (p >= 1 + behind) paint.Color = inks.Lit;
            else
            {
                var e = (float)(p * w);
                var a = e - 0.6f * em;
                var b = e + 0.35f * em;
                var (x0, x1) = rtl ? (w - a, w - b) : (a, b);
                paint.Color = SKColors.White;
                paint.Shader = SKShader.CreateLinearGradient(new SKPoint(x0, 0), new SKPoint(x1, 0),
                    [inks.Lit, inks.Edge, inks.Unlit], [0, (e - a) / (b - a), 1], SKShaderTileMode.Clamp);
            }
        }

        static void Text(SKCanvas canvas, WordDraw d, double p, double glow, double glowR, float em, Inks inks, bool rtl)
        {
            using var font = Layout.Font(d.Size);
            var baseline = Layout.Baseline(d.Size);
            if (glow > 0)
            {
                using var halo = new SKPaint
                {
                    IsAntialias = true,
                    Color = inks.Glow.WithAlpha((byte)Math.Clamp(glow * 255, 0, 255)),
                    MaskFilter = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, (float)(glowR * em)),
                };
                canvas.DrawShapedText(Layout.Shaper, d.Text, 0, baseline, font, halo);
            }
            using var paint = new SKPaint { IsAntialias = true };
            Ink(paint, p, d.W, em, inks, rtl);
            canvas.DrawShapedText(Layout.Shaper, d.Text, 0, baseline, font, paint);
            paint.Shader?.Dispose();
        }

        static void Word(SKCanvas canvas, WordDraw d, double p, double wy, double ws, double glow, double glowR, LineLayout lay, Inks inks)
        {
            canvas.Save();
            canvas.Translate(d.X, d.Y + (float)(wy * lay.Em));
            canvas.Scale((float)ws, (float)ws, d.W / 2, d.H * 0.75f);
            Text(canvas, d, p, glow, glowR, d.Size, inks, lay.Rtl);
            canvas.Restore();
        }

        /// A held word, grapheme by grapheme (§5.5): each lifts, swells and spreads from the middle.
        static void GraphemesOf(SKCanvas canvas, WordDraw d, double p, double[] emph, LineLayout lay, Inks inks, double glow, double glowR, Emphasis? e)
        {
            var mid = (d.Graphemes.Count - 1) / 2.0;
            var side = lay.Rtl ? -1 : 1;
            for (var i = 0; i < d.Graphemes.Count; i++)
            {
                var g = d.Graphemes[i];
                var v = i < emph.Length ? emph[i] : 0;
                var dx = (float)((e?.Spread ?? 0) * v * (i - mid) * side * lay.Em);
                var dy = (float)(-(e?.Lift ?? 0) * v * lay.Em);
                var s = (float)(1 + (e?.Swell ?? 0) * v);
                var gp = (p * d.W - g.X) / Math.Max(1f, g.W);
                canvas.Save();
                canvas.Translate(d.X + g.X + dx, d.Y + dy);
                canvas.Scale(s, s, g.W / 2, g.H * 0.8f);
                Text(canvas, g, gp, glow, glowR, lay.Em, inks, lay.Rtl);
                canvas.Restore();
            }
        }

        /// Interlude dots at the anchor, where the column starts (§9.8).
        void Dots(SKCanvas canvas)
        {
            if (f.DotsOpacity <= 0) return;
            var r = (float)(L.Interlude.DotEm * f.Layout.FontPx / 2);
            var ink = new SKColor(f.Palette.Ink.ToArgb());
            using var paint = new SKPaint { IsAntialias = true };
            for (var k = 0; k < 3; k++)
            {
                paint.Color = ink.WithAlpha((byte)Math.Clamp(f.DotAlpha[k] * f.DotsOpacity * 255, 0, 255));
                canvas.DrawCircle((float)(f.W * 0.18 + r + k * r * 4), (float)(f.H * L.AnchorY), r * (float)f.DotScale[k], paint);
            }
        }
    }
}
