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

/// views/components/queue.ejs (helpers.less .queue-panel; elements.less .cd-queue-item): "Queue" (or
/// "History") as h3 18 px 6 px in; the songs — 42 px artwork, the title at 14 px over the artist at
/// 0.7 em, the duration in 60 px, --selected on hover — and under them Queue | History and Clear All.
/// Cider's Autoplay is Apple Music's and left out.
public sealed class QueuePanel : DockPanel
{
    readonly Session session;
    readonly Nav nav;
    readonly TextBlock heading = Blocks.H3("Queue");
    readonly StackPanel items = new();
    readonly Button queueTab, historyTab, clear;
    bool history;

    public QueuePanel(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        heading.Margin = new Thickness(18, 18, 6, 18);
        SetDock(heading, Dock.Top);
        Children.Add(heading);

        queueTab = Kit.CiderButton("Queue", null, () => Show(false));
        historyTab = Kit.CiderButton("History", null, () => Show(true));
        clear = Kit.CiderButton("Clear All", null, session.Player.ClearUpcoming);
        foreach (var b in new[] { queueTab, historyTab, clear })
        {
            b.Padding = new Thickness(8, 6);
            b.FontSize = 13;
            b.HorizontalAlignment = HorizontalAlignment.Stretch;
        }
        clear.Margin = new Thickness(0, 6, 0, 0);
        var tabs = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*") };
        tabs.Children.Add(queueTab);
        tabs.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = historyTab });
        var footer = new StackPanel { Margin = new Thickness(12), Children = { tabs, clear } };
        SetDock(footer, Dock.Bottom);
        Children.Add(footer);
        Children.Add(new ScrollViewer { Content = items });

        System.ComponentModel.PropertyChangedEventHandler track = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) Refresh();
        };
        this.WhileShown(() =>
        {
            session.Player.QueueChanged += Refresh;
            session.Player.PropertyChanged += track;
            Refresh();
        }, () =>
        {
            session.Player.QueueChanged -= Refresh;
            session.Player.PropertyChanged -= track;
        });
        Show(false);
    }

    /// The rows on show (tests read them).
    public IReadOnlyList<Track> Shown { get; private set; } = [];

    void Show(bool showHistory)
    {
        history = showHistory;
        heading.Text = history ? "History" : "Queue";
        queueTab.Classes.Set("primary", !history);
        historyTab.Classes.Set("primary", history);
        Refresh();
    }

    void Refresh()
    {
        var q = session.Player.Queue;
        Shown = history ? q.History.Reverse().ToList() : q.Upcoming;
        clear.IsVisible = !history && Shown.Count > 1;
        items.Children.Clear();
        for (var i = 0; i < Shown.Count; i++) items.Children.Add(Row(Shown[i], i));
    }

    Control Row(Track t, int index)
    {
        var row = new Button
        {
            Theme = Kit.Res<ControlTheme>("QueueItem"),
            Content = new DockPanel
            {
                Children =
                {
                    new CoverImage(t.Cover, 42, 96, 6) { Margin = new Thickness(0, 0, 10, 0), [DockPanel.DockProperty] = Dock.Left },
                    new TextBlock { Text = Kit.Time(t.DurationMs), FontSize = 14, MinWidth = 60, TextAlignment = TextAlignment.Center, VerticalAlignment = VerticalAlignment.Center, [DockPanel.DockProperty] = Dock.Right },
                    new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { Kit.Text(t.Title, 14), Kit.Text(t.Artist, 11.2, opacity: 0.7) } },
                },
            },
        };
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
