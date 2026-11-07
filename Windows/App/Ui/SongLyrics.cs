using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Playback;
using Echo.Stage;

namespace Echo.Ui;

/// The playing song's lyrics on a LyricsStage, wherever Cider shows them (the drawer, the immersive
/// view): built when they arrive, "No Lyrics" when there are none, the stage woken by play and seeks.
public sealed class SongLyrics : Panel
{
    readonly Session session;
    readonly TextBlock none;

    public SongLyrics(Session session, double fontSize)
    {
        this.session = session;
        var player = session.Player;
        Stage = new LyricsStage(
            () => player.PositionNow.TotalMilliseconds + Offset,
            () => player.Playing,
            ms => player.Seek(TimeSpan.FromMilliseconds(Math.Max(0, ms - Offset))),
            fontSize);
        none = new TextBlock
        {
            Text = "No Lyrics",
            FontSize = fontSize,
            FontWeight = FontWeight.Bold,
            Opacity = 0.6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            IsVisible = false,
        };
        Children.Add(Stage);
        Children.Add(none);
        PropertyChangedEventHandler lyrics = (_, _) => Build();
        PropertyChangedEventHandler wake = (_, e) =>
        {
            if (e.PropertyName is nameof(Player.Playing) or nameof(Player.Position)) Stage.Wake();
        };
        this.WhileShown(() =>
        {
            session.Lyrics.PropertyChanged += lyrics;
            player.PropertyChanged += wake;
            Build();
        }, () =>
        {
            session.Lyrics.PropertyChanged -= lyrics;
            player.PropertyChanged -= wake;
        });
    }

    public LyricsStage Stage { get; }

    double Offset => (session.Lyrics.Doc?.OffsetMs ?? 0) + session.Lyrics.OffsetMs;

    LyricsDoc? shown;

    void Build()
    {
        var doc = session.Lyrics.Status == LyricsStatus.Ready ? session.Lyrics.Doc : null;
        none.IsVisible = session.Lyrics.Status == LyricsStatus.Missing;
        if (ReferenceEquals(doc, shown)) return;
        shown = doc;
        Stage.Show(doc);
    }
}
