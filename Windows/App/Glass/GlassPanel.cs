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

    /// Extra dark tint over a bright backdrop, 0…1, on top of Params.Tint (the adaptive tint).
    public static readonly StyledProperty<double> DarkenProperty =
        AvaloniaProperty.Register<GlassPanel, double>(nameof(Darken));

    /// False: every panel is an opaque Surface1 instead (Windows' Transparency effects off).
    public static bool Enabled { get; set; } = true;

    static GlassPanel() => AffectsRender<GlassPanel>(ParamsProperty, DarkenProperty, CornerRadiusProperty);

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

    public double Darken
    {
        get => GetValue(DarkenProperty);
        set => SetValue(DarkenProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var top = TopLevel.GetTopLevel(this);
        var surface = top is null ? new PixelSize(0, 0) : PixelSize.FromSize(top.ClientSize, top.RenderScaling);
        context.Custom(new Op(this, new Rect(Bounds.Size), CornerRadius, Params, Darken, surface));
        base.Render(context);
    }

    sealed class Op(GlassPanel owner, Rect bounds, CornerRadius radius, GlassParams g, double darken, PixelSize surface)
        : ICustomDrawOperation
    {
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
