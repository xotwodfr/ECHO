using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Small builders for Cider's recurring pieces, so the views read like Cider's templates.
public static class Kit
{
    public static T Res<T>(string key) where T : class => (T)Application.Current!.FindResource(key)!;

    public static IBrush Brush(string key) => Res<IBrush>(key);

    public static TextBlock Text(string? text, double size = 14, FontWeight weight = FontWeight.Normal, double opacity = 1) => new()
    {
        Text = text,
        FontSize = size,
        FontWeight = weight,
        Opacity = opacity,
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// Cider's `.playback-button` family: a box with an icon, 70 % opaque, --selected behind on hover.
    public static Button IconButton(Icon icon, double width, double height, double iconSize, string tip, Action click, double opacity = 0.7)
    {
        var b = new Button
        {
            Theme = Res<ControlTheme>("Plain"),
            Width = width,
            Height = height,
            Opacity = opacity,
            Content = new Glyph(icon, iconSize),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        ToolTip.SetTip(b, tip);
        b.Click += (_, _) => click();
        return b;
    }

    /// `.md-btn` with an icon and a label (Play, Shuffle, Add to Library).
    public static Button CiderButton(string label, Icon? icon, Action click, bool primary = false)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        if (icon is not null) row.Children.Add(new Glyph(icon, 14));
        row.Children.Add(new TextBlock { Text = label, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        var b = new Button { Theme = Res<ControlTheme>("CiderButton"), Content = row };
        if (primary) b.Classes.Add("primary");
        b.Click += (_, _) => click();
        return b;
    }

    public static string Time(TimeSpan t) => t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{(int)t.TotalMinutes}:{t.Seconds:00}";

    public static string Time(long ms) => Time(TimeSpan.FromMilliseconds(ms));
}
