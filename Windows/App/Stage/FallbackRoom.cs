using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Echo.Stage;

/// The room without GL: the palette's room colour lit around the key light, falling to its shadow. It
/// sits under the StageView, which covers it when GL runs and hides itself when it cannot.
public sealed class FallbackRoom : Control
{
    public static readonly StyledProperty<StagePalette> PaletteProperty =
        AvaloniaProperty.Register<FallbackRoom, StagePalette>(nameof(Palette), StagePalette.Fallback);

    static FallbackRoom() => AffectsRender<FallbackRoom>(PaletteProperty);

    public StagePalette Palette
    {
        get => GetValue(PaletteProperty);
        set => SetValue(PaletteProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var brush = new RadialGradientBrush
        {
            Center = new RelativePoint(0.5, 0.4, RelativeUnit.Relative),
            GradientOrigin = new RelativePoint(0.5, 0.4, RelativeUnit.Relative),
            RadiusX = new RelativeScalar(0.8, RelativeUnit.Relative),
            RadiusY = new RelativeScalar(0.8, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(Color.FromUInt32(Palette.Room.ToArgb()), 0),
                new GradientStop(Color.FromUInt32(Palette.Shadow.ToArgb()), 1),
            },
        };
        context.FillRectangle(brush, new Rect(Bounds.Size));
    }
}
