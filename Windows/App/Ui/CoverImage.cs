using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Echo.Ui;

/// A cover by its id, loaded through the session's cache (Covers).
public sealed class CoverImage : Image
{
    public static readonly StyledProperty<string?> CoverArtProperty =
        AvaloniaProperty.Register<CoverImage, string?>(nameof(CoverArt));

    /// The size asked of the server, px.
    public static readonly StyledProperty<int> PixelsProperty =
        AvaloniaProperty.Register<CoverImage, int>(nameof(Pixels), 300);

    public CoverImage() => Stretch = Stretch.UniformToFill;

    public string? CoverArt
    {
        get => GetValue(CoverArtProperty);
        set => SetValue(CoverArtProperty, value);
    }

    public int Pixels
    {
        get => GetValue(PixelsProperty);
        set => SetValue(PixelsProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == CoverArtProperty || change.Property == PixelsProperty) _ = Load();
    }

    async Task Load()
    {
        var art = CoverArt;
        Source = null;
        if (art is null || Session.Current is not { } session) return;
        var bitmap = await session.Covers.Get(art, Pixels);
        if (art == CoverArt) Source = bitmap;
    }
}
