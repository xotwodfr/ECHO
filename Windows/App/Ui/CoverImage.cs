using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;

namespace Echo.Ui;

/// A cover by its server path, loaded through the session's cache (Covers), drawn to fill its box
/// (cropped from the middle). Without one, the title in a square (DESIGN_SYSTEM.md §8): Surface1, the
/// title at 600, 18% of the side, muted, 8% in.
public sealed class CoverImage : Control
{
    public static readonly StyledProperty<string?> UrlProperty =
        AvaloniaProperty.Register<CoverImage, string?>(nameof(Url));

    /// The size asked of the server, px.
    public static readonly StyledProperty<int> PixelsProperty =
        AvaloniaProperty.Register<CoverImage, int>(nameof(Pixels), 300);

    /// The title set in the square when there is no cover.
    public static readonly StyledProperty<string?> FallbackProperty =
        AvaloniaProperty.Register<CoverImage, string?>(nameof(Fallback));

    static CoverImage() => AffectsRender<CoverImage>(FallbackProperty);

    public string? Url
    {
        get => GetValue(UrlProperty);
        set => SetValue(UrlProperty, value);
    }

    public int Pixels
    {
        get => GetValue(PixelsProperty);
        set => SetValue(PixelsProperty, value);
    }

    public string? Fallback
    {
        get => GetValue(FallbackProperty);
        set => SetValue(FallbackProperty, value);
    }

    /// The loaded cover, or null (none, or not yet).
    public Bitmap? Bitmap { get; private set; }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == UrlProperty || change.Property == PixelsProperty) _ = Load();
    }

    async Task Load()
    {
        var url = Url;
        Bitmap = null;
        InvalidateVisual();
        if (url is null || Session.Current is not { } session) return;
        var bitmap = await session.Covers.Get(url, Pixels);
        if (url != Url) return;
        Bitmap = bitmap;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        var box = new Rect(Bounds.Size);
        if (box.Width < 1 || box.Height < 1) return;
        if (Bitmap is { } bitmap)
        {
            // Uniform to fill: the largest middle part of the cover with the box's shape.
            var s = bitmap.Size;
            var k = Math.Min(s.Width / box.Width, s.Height / box.Height);
            var src = new Rect((s.Width - box.Width * k) / 2, (s.Height - box.Height * k) / 2, box.Width * k, box.Height * k);
            context.DrawImage(bitmap, src, box);
            return;
        }
        if (Fallback is null) return;
        var app = Application.Current!;
        context.FillRectangle((IBrush)app.FindResource("Surface1")!, box);
        var inset = box.Width * 0.08;
        var text = new FormattedText(Fallback, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface((FontFamily)app.FindResource("EchoFont")!, FontStyle.Normal, FontWeight.SemiBold),
            Math.Max(8, box.Width * 0.18), (IBrush)app.FindResource("Muted")!)
        {
            MaxTextWidth = box.Width - 2 * inset,
            MaxTextHeight = box.Height - 2 * inset,
        };
        context.DrawText(text, new Point(inset, inset));
    }
}
