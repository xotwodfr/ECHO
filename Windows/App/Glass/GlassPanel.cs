using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Rendering.SceneGraph;
using Avalonia.Skia;
using Avalonia.Threading;
using SkiaSharp;

namespace Echo.Glass;

/// A surface of liquid glass (GlassMath.cs): what is drawn under it shows through, bent at the rim.
/// Its child draws on top.
public class GlassPanel : Decorator
{
    public static readonly StyledProperty<CornerRadius> CornerRadiusProperty =
        Border.CornerRadiusProperty.AddOwner<GlassPanel>();

    public static readonly StyledProperty<GlassParams> ParamsProperty =
        AvaloniaProperty.Register<GlassPanel, GlassParams>(nameof(Params), new GlassParams());

    /// False: every panel is an opaque Surface1 instead (Windows' Transparency effects off).
    public static bool Enabled { get; set; } = true;

    static GlassPanel() => AffectsRender<GlassPanel>(ParamsProperty, CornerRadiusProperty);

    public CornerRadius CornerRadius
    {
        get => GetValue(CornerRadiusProperty);
        set => SetValue(CornerRadiusProperty, value);
    }

    public GlassParams Params
    {
        get => GetValue(ParamsProperty);
        set => SetValue(ParamsProperty, value);
    }

    /// The extra dark tint over a bright backdrop now, 0…0.35, on top of Params.Tint (the adaptive tint).
    public double Darken { get; private set; }

    // The adaptive tint: the backdrop's brightness, measured at most every 250 ms on the render thread,
    // sets a target; each frame eases the tint toward it over 300 ms.
    long measuredAt;
    double target;
    double easeFrom;
    long easeStart;

    internal bool DueForMeasure()
    {
        var now = Environment.TickCount64;
        if (now - Interlocked.Read(ref measuredAt) < 250) return false;
        Interlocked.Exchange(ref measuredAt, now);
        return true;
    }

    /// The backdrop's mean luminance, 0…1: white text keeps its contrast over a bright cover.
    internal void Measured(double luminance)
    {
        var next = Math.Clamp((luminance - 0.55) / 0.35, 0, 1) * 0.35;
        if (Math.Abs(next - target) < 0.005) return;
        (easeFrom, target, easeStart) = (Darken, next, Environment.TickCount64);
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        var top = TopLevel.GetTopLevel(this);
        var surface = top is null ? new PixelSize(0, 0) : PixelSize.FromSize(top.ClientSize, top.RenderScaling);
        var k = Math.Clamp((Environment.TickCount64 - easeStart) / 300.0, 0, 1);
        Darken = easeFrom + (target - easeFrom) * k;
        if (k < 1) top?.RequestAnimationFrame(_ => InvalidateVisual());
        context.Custom(new Op(this, new Rect(Bounds.Size), CornerRadius, Params, Darken, surface));
        base.Render(context);
    }

    sealed class Op(GlassPanel owner, Rect bounds, CornerRadius radius, GlassParams g, double darken, PixelSize surface)
        : ICustomDrawOperation
    {
        /// The mean luminance of what is under the glass, from a 4×4 copy.
        static double? Luminance(SKImage image)
        {
            using var small = new SKBitmap(new SKImageInfo(4, 4, SKColorType.Rgba8888, SKAlphaType.Premul));
            using var pixmap = small.PeekPixels();
            if (!image.ScalePixels(pixmap, new SKSamplingOptions(SKFilterMode.Linear))) return null;
            var sum = 0.0;
            for (var y = 0; y < 4; y++)
                for (var x = 0; x < 4; x++)
                {
                    var c = small.GetPixel(x, y);
                    sum += (0.2126 * c.Red + 0.7152 * c.Green + 0.0722 * c.Blue) / 255;
                }
            return sum / 16;
        }

        static readonly SKColor Opaque = new(0x15, 0x15, 0x1C);

        public Rect Bounds => bounds;
        public bool HitTest(Point p) => bounds.Contains(p);
        public bool Equals(ICustomDrawOperation? other) => false; // the backdrop may have changed
        public void Dispose() { }

        public void Render(ImmediateDrawingContext context)
        {
            if (context.TryGetFeature<ISkiaSharpApiLeaseFeature>() is not { } feature) return;
            using var lease = feature.Lease();
            var canvas = lease.SkCanvas;
            var m = canvas.TotalMatrix;
            var scale = (float)Math.Sqrt(Math.Abs(m.ScaleX * m.ScaleY - m.SkewX * m.SkewY));
            var device = m.MapRect(bounds.ToSKRect());
            var px = SKRectI.Intersect(SKRectI.Ceiling(device), new SKRectI(0, 0, surface.Width, surface.Height));
            var r = new[] { radius.TopLeft, radius.TopRight, radius.BottomRight, radius.BottomLeft }
                .Select(v => (float)v * scale).ToArray();

            using var snapshot = Enabled && !px.IsEmpty ? lease.SkSurface?.Snapshot(px) : null;
            if (snapshot is null)
            {
                using var fill = new SKPaint { Color = Opaque, IsAntialias = true };
                canvas.DrawRoundRect(new SKRoundRect(bounds.ToSKRect(), (float)radius.TopLeft), fill);
                return;
            }

            if (owner.DueForMeasure() && Luminance(snapshot) is { } lum) Dispatcher.UIThread.Post(() => owner.Measured(lum));

            using var backdrop = snapshot.ToShader(SKShaderTileMode.Clamp, SKShaderTileMode.Clamp,
                new SKSamplingOptions(SKFilterMode.Linear), SKMatrix.CreateTranslation(px.Left, px.Top));
            using var shader = GlassShader.Make(backdrop, device, scale, g, r, darken);
            using var paint = new SKPaint { Shader = shader };
            canvas.Save();
            canvas.ResetMatrix();
            canvas.DrawRect(device, paint);
            canvas.Restore();

            // Drawn for part of a dirty region: the rest of the snapshot held last frame's glass, which
            // the rim may have sampled. Repaint the whole panel next frame (ponytail: one frame of a
            // faint double bend at the region's edge; per-frame full redraws if it ever shows).
            if (!canvas.DeviceClipBounds.Contains(px)) Dispatcher.UIThread.Post(owner.InvalidateVisual);
        }
    }
}
