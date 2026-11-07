using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;

namespace Echo.Ui;

/// Cider's `mediaitem-artwork`: a cover by its server path, loaded through the session's cache (Covers),
/// cropped to fill its box with rounded corners (--mediaItemRadius, 8 px by default) and a 1 px inset ring
/// (--mediaItemShadow, rgb(200 200 200 / 16%)). With no cover, Cider's MissingArtwork: grey with a note.
public sealed class CoverImage : Control
{
    public static readonly StyledProperty<string?> UrlProperty = AvaloniaProperty.Register<CoverImage, string?>(nameof(Url));

    /// The size asked of the server, px.
    public static readonly StyledProperty<int> PixelsProperty = AvaloniaProperty.Register<CoverImage, int>(nameof(Pixels), 300);

    public static readonly StyledProperty<double> RadiusProperty = AvaloniaProperty.Register<CoverImage, double>(nameof(Radius), 8);

    static readonly IBrush Ring = new SolidColorBrush(Color.Parse("#29C8C8C8"));
    static readonly IBrush Missing = new SolidColorBrush(Color.Parse("#6E6E6E"));
    static readonly IBrush MissingNote = new SolidColorBrush(Color.Parse("#29000000"));

    static CoverImage() => AffectsRender<CoverImage>(RadiusProperty);

    public CoverImage() { }

    public CoverImage(string? url, double size, int pixels = 300, double radius = 8)
    {
        Width = Height = size;
        Pixels = pixels;
        Radius = radius;
        Url = url;
    }

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

    public double Radius
    {
        get => GetValue(RadiusProperty);
        set => SetValue(RadiusProperty, value);
    }

    /// The loaded cover, or null (none, or not yet).
    public Bitmap? Bitmap { get; private set; }

    Bitmap? previous;
    double fade = 1;
    bool loading;
    static readonly IBrush Waiting = new SolidColorBrush(Color.Parse("#14FFFFFF"));

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == UrlProperty || change.Property == PixelsProperty) _ = Load();
    }

    /// A cover already in memory shows at once; one that has to come from the server fades in over
    /// 350 ms (Cider's `.artwork img { transition: opacity .5s }`), over the one it replaces.
    async Task Load()
    {
        var url = Url;
        previous = Bitmap ?? previous;
        Bitmap = null;
        if (url is null || Session.Current is not { } session)
        {
            (previous, loading) = (null, false);
            InvalidateVisual();
            return;
        }
        var task = session.Covers.Get(url, Pixels);
        var cached = task.IsCompleted;
        loading = !cached;
        var bitmap = await task;
        if (url != Url) return;
        loading = false;
        Bitmap = bitmap;
        if (cached || bitmap is null) (fade, previous) = (1, null);
        else FadeIn();
        InvalidateVisual();
    }

    void FadeIn()
    {
        fade = 0;
        if (TopLevel.GetTopLevel(this) is not { } top)
        {
            (fade, previous) = (1, null);
            return;
        }
        var last = TimeSpan.Zero;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan at)
        {
            fade = Math.Min(1, fade + (last == TimeSpan.Zero ? 16 : (at - last).TotalMilliseconds) / 350);
            last = at;
            if (fade >= 1) previous = null;
            InvalidateVisual();
            if (fade < 1 && TopLevel.GetTopLevel(this) is not null) top.RequestAnimationFrame(Frame);
            else (fade, previous) = (1, null);
        }
    }

    /// Uniform to fill: the largest middle part of the cover with the box's shape.
    static void Fill(DrawingContext context, Bitmap bitmap, Rect box)
    {
        var s = bitmap.Size;
        var k = Math.Min(s.Width / box.Width, s.Height / box.Height);
        context.DrawImage(bitmap, new Rect((s.Width - box.Width * k) / 2, (s.Height - box.Height * k) / 2, box.Width * k, box.Height * k), box);
    }

    public override void Render(DrawingContext context)
    {
        var box = new Rect(Bounds.Size);
        if (box.Width < 1 || box.Height < 1) return;
        var r = Math.Min(Radius, box.Width / 2);
        var shape = new RoundedRect(box, r);
        using (context.PushClip(shape))
        {
            if (Bitmap is null && (loading || previous is not null))
            {
                // Still coming: the cover it replaces, or a faint square.
                if (previous is { } old) Fill(context, old, box);
                else context.FillRectangle(Waiting, box);
            }
            else if (Bitmap is { } bitmap)
            {
                if (fade < 1)
                {
                    if (previous is { } old) Fill(context, old, box);
                    else context.FillRectangle(Waiting, box);
                    using (context.PushOpacity(fade)) Fill(context, bitmap, box);
                }
                else Fill(context, bitmap, box);
            }
            else
            {
                context.FillRectangle(Missing, box);
                var icon = Icons.MissingArtwork;
                var k = box.Width / icon.Width;
                using (context.PushTransform(Matrix.CreateScale(k, box.Height / icon.Height)))
                    context.DrawGeometry(MissingNote, null, icon.FillGeometry!);
            }
        }
        context.DrawRectangle(null, new Pen(Ring, 1), new RoundedRect(box.Deflate(0.5), Math.Max(0, r - 0.5)));
    }
}
