using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Transformation;
using Avalonia.Styling;
using Avalonia.Threading;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's drawer (style.less .app-drawer; views/app/app-navigation.ejs): 300 px, radius 12, 16 px from
/// the right, floating over the page with Cider's shadow; the queue or the lyrics (on a LyricsStage). Cider's drawer is
/// --color2 under a 40 px backdrop blur; ECHO blurs no live pixels, so it is the colour that blur gives
/// over Cider's dark pages, opaque so no crisp text shows through, and the lyrics lie over the playing
/// cover blurred once.
public sealed class Drawer : Border
{
    readonly Session session;
    readonly Nav nav;

    public Drawer(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        Width = 300;
        CornerRadius = new CornerRadius(12);
        Background = new SolidColorBrush(Color.Parse("#222222"));
        BoxShadow = BoxShadows.Parse("inset 0 0 0 1 #29C8C8C8, 0 8 40 0 #8C000000");
        ClipToBounds = true;
        HorizontalAlignment = HorizontalAlignment.Right;
        Margin = new Thickness(0, 20, 16, 20);
        IsVisible = false;
        // Cider's drawertransition: in from the right, fading.
        Transitions =
        [
            new Avalonia.Animation.DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(250), Easing = new Avalonia.Animation.Easings.CubicEaseOut() },
            new Avalonia.Animation.TransformOperationsTransition { Property = RenderTransformProperty, Duration = TimeSpan.FromMilliseconds(250), Easing = new Avalonia.Animation.Easings.CubicEaseOut() },
        ];
    }

    /// "queue", "lyrics" or null (closed).
    public string? Panel { get; private set; }

    public event Action? Changed;

    /// The bar's buttons: the same panel again closes the drawer.
    public void Toggle(string panel)
    {
        var opening = !IsVisible;
        Panel = Panel == panel ? null : panel;
        IsVisible = Panel is not null;
        if (IsVisible && opening)
        {
            Opacity = 0;
            RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("translateX(24px)");
            Avalonia.Threading.Dispatcher.UIThread.Post(() =>
            {
                Opacity = 1;
                RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("translateX(0px)");
            }, Avalonia.Threading.DispatcherPriority.Render);
        }
        Child = Panel switch
        {
            "queue" => new QueuePanel(session, nav),
            "lyrics" => new Panel { Children = { new LyricsBackdrop(session), new SongLyrics(session, 26) { Margin = new Thickness(0, 12) } } },
            _ => null,
        };
        Changed?.Invoke();
    }
}

/// The queue, as Cider 4 shows it (cider.sh's screenshots; Cider 1's queue.ejs underneath): Shuffle and
/// Repeat with the count on top; "Now Playing" with the song on a lit card and the history's size (a
/// click shows the history); "Playing Next" with where it plays from and how far in, Clear, and the
/// songs numbered, each with its cover, title and "artist — album". A double click jumps there, a right
/// click removes or goes to the artist or album. (Cider 4's AutoPlay is Apple Music's.)
public sealed class QueuePanel : DockPanel
{
    readonly Session session;
    readonly Nav nav;
    readonly StackPanel content = new();
    readonly TextBlock count = Kit.Text(null, 13, FontWeight.SemiBold);
    bool history;

    public QueuePanel(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        var player = session.Player;
        var top = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            Margin = new Thickness(12, 12, 12, 4),
            Children =
            {
                new Border
                {
                    CornerRadius = new CornerRadius(16),
                    Background = new SolidColorBrush(Color.FromArgb(20, 255, 255, 255)),
                    Child = new Transport.Toggles(player),
                },
                new Border { CornerRadius = new CornerRadius(16), Background = new SolidColorBrush(Color.FromArgb(20, 255, 255, 255)), Padding = new Thickness(12, 0), Child = count },
            },
        };
        SetDock(top, Dock.Top);
        Children.Add(top);
        Children.Add(new ScrollViewer { Content = content });

        System.ComponentModel.PropertyChangedEventHandler track = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) Refresh();
        };
        this.WhileShown(() =>
        {
            player.QueueChanged += Refresh;
            player.PropertyChanged += track;
            Refresh();
        }, () =>
        {
            player.QueueChanged -= Refresh;
            player.PropertyChanged -= track;
        });
        Refresh();
    }

    /// The rows on show (tests read them).
    public IReadOnlyList<Track> Shown { get; private set; } = [];

    void Show(bool showHistory)
    {
        history = showHistory;
        Refresh();
    }

    void Refresh()
    {
        var q = session.Player.Queue;
        content.Children.Clear();
        var upcoming = q.Upcoming;
        count.Text = $"{upcoming.Count} {(upcoming.Count == 1 ? "item" : "items")}";
        // The history's size by a clock, as Cider 4 has it; a click switches to the history and back.
        var historyButton = Kit.IconButton(Icons.Info, 54, 26, 14, "History", () => Show(!history), 0.7);
        historyButton.Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            Children = { new Glyph(new Icon(24, 24, "", "M 3,12 a 9,9 0 1,0 3,-6.7 M 3,4 l 0,5 l 5,0 M 12,7 l 0,5 l 3,2", 2), 13), Kit.Text(q.History.Count.ToString(), 12) },
        };
        historyButton.Classes.Set("active", history);

        if (history)
        {
            content.Children.Add(Heading("History", historyButton));
            Shown = q.History.Reverse().ToList();
            for (var i = 0; i < Shown.Count; i++) content.Children.Add(Row(Shown[i], null, i));
            return;
        }
        content.Children.Add(Heading("Now Playing", historyButton));
        if (q.Now is { } now)
            content.Children.Add(new Border
            {
                Margin = new Thickness(8, 0),
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255)),
                Child = Card(now),
            });
        var clear = new Button { Theme = Kit.Res<ControlTheme>("Plain"), Padding = new Thickness(8, 3), Content = Kit.Text("Clear", 13, FontWeight.SemiBold) };
        ((TextBlock)clear.Content).Foreground = Kit.Brush("Key");
        clear.Click += (_, _) => session.Player.ClearUpcoming();
        clear.IsVisible = upcoming.Count > 1;
        var next = Heading("Playing Next", clear);
        next.Margin = new Thickness(14, 22, 10, 8);
        content.Children.Add(next);
        if (q.Source is { } source)
        {
            var at = q.History.Count + 1;
            var total = at + upcoming.Count;
            var from = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(14, -4, 14, 8) };
            from.Children.Add(Kit.Text($"From {source.Title}", 14, opacity: 0.6));
            from.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = Kit.Text($"{at} of {total}", 12, opacity: 0.5) });
            content.Children.Add(from);
        }
        Shown = upcoming;
        for (var i = 0; i < Shown.Count; i++) content.Children.Add(Row(Shown[i], q.History.Count + 2 + i, i));
    }

    static Control Heading(string text, Control? right)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(14, 10, 10, 8) };
        grid.Children.Add(new TextBlock { Text = text, FontSize = 18, FontWeight = FontWeight.Bold, VerticalAlignment = VerticalAlignment.Center });
        if (right is not null) grid.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = right, VerticalAlignment = VerticalAlignment.Center });
        return grid;
    }

    static Control Card(Track t) => new StackPanel
    {
        Orientation = Orientation.Horizontal,
        Margin = new Thickness(8),
        Spacing = 10,
        Children =
        {
            new CoverImage(t.Cover, 42, 96, 6),
            new StackPanel { VerticalAlignment = VerticalAlignment.Center, Width = 200, Children = { Kit.Text(t.Title, 14, FontWeight.Medium), Kit.Text($"{t.Artist} — {t.Album.Title}", 12, opacity: 0.6) } },
        },
    };

    Control Row(Track t, int? number, int index)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal };
        if (number is { } n)
        {
            var num = Kit.Text(n.ToString(), 12, opacity: 0.5);
            num.Width = 22;
            num.TextAlignment = TextAlignment.Right;
            num.Margin = new Thickness(0, 0, 6, 0);
            line.Children.Add(num);
        }
        line.Children.Add(Card(t));
        var row = new Button { Theme = Kit.Res<ControlTheme>("QueueItem"), Padding = new Thickness(4, 0), Content = line };
        if (history) row.DoubleTapped += (_, _) => _ = session.Player.PlayList([t], 0, new PlayContext("history", null, "History"));
        else row.DoubleTapped += (_, _) => _ = session.Player.JumpTo(index);
        MenuItem Item(string header, Action act)
        {
            var m = new MenuItem { Header = header };
            m.Click += (_, _) => act();
            return m;
        }
        var menu = new List<MenuItem>();
        if (!history) menu.Add(Item("Remove from Queue", () => session.Player.Remove(index)));
        if (t.Artists.FirstOrDefault()?.Id is { } artist) menu.Add(Item("Go to Artist", () => nav.Open(new Route("artist", artist, t.Artist))));
        if (t.Album.Id is { } album) menu.Add(Item("Go to Album", () => nav.Open(new Route("album", album, t.Album.Title))));
        row.ContextMenu = new ContextMenu { ItemsSource = menu };
        return row;
    }
}

/// The lyrics drawer's background (.app-drawer .bgArtworkMaterial): the playing cover at brightness 80 %,
/// blurred and saturated, baked once per cover; it follows the song.
public sealed class LyricsBackdrop : Control
{
    public LyricsBackdrop() { }

    public LyricsBackdrop(Session session)
    {
        Url = session.Player.Track?.Cover;
        System.ComponentModel.PropertyChangedEventHandler track = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) Url = session.Player.Track?.Cover;
        };
        this.WhileShown(() => session.Player.PropertyChanged += track, () => session.Player.PropertyChanged -= track);
    }

    static readonly Dictionary<string, Avalonia.Media.Imaging.Bitmap?> baked = [];
    string? url;
    Avalonia.Media.Imaging.Bitmap? image;

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
        if (which is null || Session.Current is not { } s) return;
        if (!baked.TryGetValue(which, out var done))
        {
            var cover = await s.Covers.Get(which, 300);
            done = baked[which] = cover is null ? null : ArtworkMaterial.Bake(cover, sigma: 8, saturate: 1.8f, brightness: 0.8f);
        }
        if (which != url) return;
        image = done;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        if (image is null) return;
        var side = Math.Max(Bounds.Width, Bounds.Height) * 1.4;
        using (context.PushClip(new Rect(Bounds.Size)))
            context.DrawImage(image, new Rect(image.Size), new Rect((Bounds.Width - side) / 2, (Bounds.Height - side) / 2, side, side));
        context.FillRectangle(new SolidColorBrush(Color.FromArgb(90, 0, 0, 0)), new Rect(Bounds.Size));
    }
}
