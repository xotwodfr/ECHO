using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using SkiaSharp;

namespace Echo.Ui;

/// Cider's `.artworkMaterial` behind a collection's header (style.less; pages.less .playlist-page
/// .artworkContainer): one copy of the cover at 200 % width, half opaque, `blur(80px)`, in a container at
/// 70 % that fades out downwards. ECHO blurs no live pixels: the blur is baked once per cover, small.
public sealed class ArtworkMaterial : Control
{
    static readonly Dictionary<string, Bitmap?> baked = [];
    string? url;
    Bitmap? image;

    public string? Url
    {
        get => url;
        set
        {
            if (value == url) return;
            url = value;
            _ = Load(value);
        }
    }

    async Task Load(string? which)
    {
        image = null;
        InvalidateVisual();
        if (which is null || Session.Current is not { } session) return;
        if (!baked.TryGetValue(which, out var done))
        {
            var cover = await session.Covers.Get(which, 300);
            done = baked[which] = cover is null ? null : Bake(cover);
        }
        if (which != url) return;
        image = done;
        InvalidateVisual();
    }

    /// The cover at 64 px, blurred as Cider's 80 px over its 200 %-wide copy (sigma scaled to 64 px).
    internal static Bitmap Bake(Bitmap cover)
    {
        using var png = new MemoryStream();
        cover.Save(png);
        using var source = SKBitmap.Decode(png.ToArray());
        const int size = 64;
        using var surface = SKSurface.Create(new SKImageInfo(size, size));
        using var paint = new SKPaint { ImageFilter = SKImageFilter.CreateBlur(2.5f, 2.5f, SKShaderTileMode.Clamp) };
        surface.Canvas.DrawBitmap(source, new SKRect(0, 0, size, size), paint);
        using var snap = surface.Snapshot();
        using var data = snap.Encode(SKEncodedImageFormat.Png, 100);
        return new Bitmap(data.AsStream());
    }

    static readonly IBrush Fade = new LinearGradientBrush
    {
        StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
        EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
        GradientStops = { new GradientStop(Color.FromArgb(200, 0, 0, 0), 0), new GradientStop(Colors.Transparent, 0.98) },
    };

    public override void Render(DrawingContext context)
    {
        if (image is null) return;
        var box = new Rect(Bounds.Size);
        var w = Bounds.Width * 2;
        using (context.PushClip(box))
        using (context.PushOpacityMask(Fade, box))
        using (context.PushOpacity(0.7 * 0.5))
            context.DrawImage(image, new Rect(image.Size), new Rect(0, 0, w, w));
    }
}
