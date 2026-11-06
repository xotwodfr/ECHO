using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Stage.Lyrics;

/// What the Listen room shows for the lyrics: finding them, none found, unsynced text as a still
/// column, or the field (made by `FieldFor`, which knows the clock and the room), and the credit.
public sealed class LyricsView : Panel
{
    /// Makes the field for a synced document.
    public Func<LyricsDoc, Control>? FieldFor { get; set; }

    /// Settings → Lyrics: unsynced lyrics shown as text, or not at all.
    public bool ShowUnsynced { get; set; } = true;

    public void Show(LyricsStatus status, LyricsDoc? doc)
    {
        Children.Clear();
        switch (status)
        {
            case LyricsStatus.Waiting:
                Children.Add(Note("Finding lyrics…"));
                break;
            case LyricsStatus.Missing:
                Children.Add(Note("No lyrics found"));
                break;
            case LyricsStatus.Ready when doc is { Sync: "none" } && !ShowUnsynced:
                break;
            case LyricsStatus.Ready when doc is { Sync: "none" }:
                var column = new StackPanel { Spacing = 14, Margin = new Thickness(0, 120, 0, 160), MaxWidth = 900 };
                foreach (var line in doc.Lines.Where(l => !string.IsNullOrWhiteSpace(l.Text)))
                    column.Children.Add(new TextBlock { Text = line.Text, FontSize = 30, FontWeight = FontWeight.Bold, TextWrapping = TextWrapping.Wrap });
                Children.Add(new ScrollViewer { Content = column, HorizontalAlignment = HorizontalAlignment.Center });
                Children.Add(Credit(doc));
                break;
            case LyricsStatus.Ready when doc is not null:
                if (FieldFor?.Invoke(doc) is { } field) Children.Add(field);
                Children.Add(Credit(doc));
                break;
        }
    }

    static TextBlock Note(string text) => new()
    {
        Text = text,
        FontSize = 18,
        Opacity = 0.6,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// The source's credit, small, under the column (LYRICS_INTEGRATION.md: attribution is shown).
    static TextBlock Credit(LyricsDoc doc) => new()
    {
        Text = doc.Attribution.Text,
        FontSize = 11,
        Opacity = 0.45,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Bottom,
        Margin = new Thickness(24, 0, 0, 112),
    };
}
