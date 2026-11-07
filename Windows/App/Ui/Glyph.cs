using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace Echo.Ui;

/// An icon in its own box (`Width`×`Height`, the SVG's viewBox): the filled shapes (path markup with its
/// fill rule) and the stroked ones (Feather's, `StrokeWidth` in box units, round caps).
public sealed record Icon(double Width, double Height, string Fill, string Stroke, double StrokeWidth)
{
    Geometry? fill, stroke;
    public Geometry? FillGeometry => Fill.Length == 0 ? null : fill ??= Geometry.Parse(Fill);
    public Geometry? StrokeGeometry => Stroke.Length == 0 ? null : stroke ??= Geometry.Parse(Stroke);
}

/// Draws an Icon centred in its bounds, in the inherited foreground (Cider's `fill="white"` and
/// `currentColor` both follow the text colour here).
public sealed class Glyph : Control
{
    public static readonly StyledProperty<Icon?> IconProperty = AvaloniaProperty.Register<Glyph, Icon?>(nameof(Icon));

    public static readonly StyledProperty<IBrush?> ForegroundProperty = TextElement.ForegroundProperty.AddOwner<Glyph>();

    static Glyph() => AffectsRender<Glyph>(IconProperty, ForegroundProperty);

    public Glyph() { }

    public Glyph(Icon icon, double size)
    {
        Icon = icon;
        Width = Height = size;
    }

    public Icon? Icon
    {
        get => GetValue(IconProperty);
        set => SetValue(IconProperty, value);
    }

    public IBrush? Foreground
    {
        get => GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        if (Icon is not { } icon || Foreground is not { } brush || Bounds.Width <= 0) return;
        var k = Math.Min(Bounds.Width / icon.Width, Bounds.Height / icon.Height);
        var at = Matrix.CreateScale(k, k) * Matrix.CreateTranslation((Bounds.Width - icon.Width * k) / 2, (Bounds.Height - icon.Height * k) / 2);
        using (context.PushTransform(at))
        {
            if (icon.FillGeometry is { } f) context.DrawGeometry(brush, null, f);
            if (icon.StrokeGeometry is { } s)
                context.DrawGeometry(null, new Pen(brush, icon.StrokeWidth, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), s);
        }
    }
}
