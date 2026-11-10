using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Animation;
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

    /// The lyrics at Spicy Lyrics' size for the room they have.
    public SongLyrics(Session session)
    {
        this.session = session;
        var player = session.Player;
        Stage = new LyricsStage(
            () => player.PositionNow.TotalMilliseconds + Offset,
            () => player.Playing,
            ms => player.Seek(TimeSpan.FromMilliseconds(Math.Max(0, ms - Offset))),
            lite: () => session.Prefs.Performance);
        none = new TextBlock
        {
            Text = "No Lyrics",
            FontSize = 29.6,
            FontWeight = FontWeight.Bold,
            Opacity = 0.6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            IsVisible = false,
        };
        // Lines fade in at the top and out at the bottom instead of being cut.
        Stage.OpacityMask = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(Colors.Transparent, 0), new GradientStop(Colors.Black, 0.1),
                new GradientStop(Colors.Black, 0.85), new GradientStop(Colors.Transparent, 1),
            },
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

/// The lyrics as a page, where Spicy Lyrics puts them in Spotify: over the whole page, on the cover's
/// flowing background, the cover with the title and artist under it on the left (a page under 700 px
/// wide has the lyrics alone) and the lyrics on the right; Full Screen and Close at the top right. It
/// fades in and out.
public sealed class LyricsPage : Panel
{
    public event Action? FullscreenRequested, CloseRequested;

    public LyricsPage(Session session)
    {
        var player = session.Player;
        Background = Kit.Brush("Card"); // until the cover's colours arrive
        Opacity = 0;
        Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(220), Easing = Motion.Out }];
        Children.Add(new FluidBackground(session));

        var art = new CoverImage(player.Track?.Cover, 300, 1200, 10);
        var artBox = new Border { CornerRadius = new CornerRadius(10), BoxShadow = BoxShadows.Parse("0 12 48 0 #99000000"), Child = art };
        var title = Kit.Text(null, 20, FontWeight.Bold);
        var artist = Kit.Text(null, 15, opacity: 0.65);
        title.HorizontalAlignment = artist.HorizontalAlignment = HorizontalAlignment.Center;
        title.TextTrimming = artist.TextTrimming = TextTrimming.CharacterEllipsis;
        title.Margin = new Thickness(0, 20, 0, 2);
        var column = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { artBox, title, artist } };
        Lyrics = new SongLyrics(session);
        var lyricsBox = new Border { [Grid.ColumnProperty] = 1, Child = Lyrics };
        Children.Add(new Grid { ColumnDefinitions = new ColumnDefinitions("42*,58*"), Children = { column, lyricsBox } });

        Button Round(Icon icon, double size, string tip, Action click)
        {
            var b = Kit.IconButton(icon, 32, 32, size, tip, click, opacity: 0.8);
            b.CornerRadius = new CornerRadius(16);
            b.Background = new SolidColorBrush(Color.FromArgb(38, 255, 255, 255));
            return b;
        }
        Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 14, 14, 0),
            Children =
            {
                Round(Icons.Fullscreen, 17, "Full Screen", () => FullscreenRequested?.Invoke()),
                Round(Icons.X, 14, "Close", () => CloseRequested?.Invoke()),
            },
        });

        void Show()
        {
            art.Url = player.Track?.Cover;
            title.Text = player.Track?.Title;
            artist.Text = player.Track?.Artist;
        }
        PropertyChangedEventHandler follow = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) Show();
        };
        this.WhileShown(() =>
        {
            player.PropertyChanged += follow;
            Show();
            Avalonia.Threading.Dispatcher.UIThread.Post(() => Opacity = 1, Avalonia.Threading.DispatcherPriority.Render);
        }, () => player.PropertyChanged -= follow);
        Motion.Enter(column, dx: -24, dy: 0, ms: 420);
        Motion.Enter(Lyrics, dx: 24, dy: 0, ms: 420, delay: 60);
        SizeChanged += (_, e) =>
        {
            var wide = e.NewSize.Width >= 700;
            column.IsVisible = wide;
            Grid.SetColumn(lyricsBox, wide ? 1 : 0);
            Grid.SetColumnSpan(lyricsBox, wide ? 1 : 2);
            lyricsBox.Margin = new Thickness(0, 0, wide ? 32 : 0, 0);
            var side = Math.Clamp(Math.Min(e.NewSize.Width * 0.3, e.NewSize.Height * 0.5), 140, 420);
            art.Width = art.Height = column.Width = side;
        };
    }

    /// The lyrics on show (tests read them).
    public SongLyrics Lyrics { get; }

    /// Fades out; `then` runs when it is gone.
    public void Leave(Action then)
    {
        IsHitTestVisible = false;
        Opacity = 0;
        Avalonia.Threading.DispatcherTimer.RunOnce(then, TimeSpan.FromMilliseconds(230));
    }
}
