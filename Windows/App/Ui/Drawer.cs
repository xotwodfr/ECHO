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
/// the right, floating over the page with Cider's shadow; the queue or the lyrics. Cider's drawer is
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
    }

    /// "queue", "lyrics" or null (closed).
    public string? Panel { get; private set; }

    public event Action? Changed;

    /// The bar's buttons: the same panel again closes the drawer.
    public void Toggle(string panel)
    {
        Panel = Panel == panel ? null : panel;
        IsVisible = Panel is not null;
        Child = Panel switch
        {
            "queue" => new QueuePanel(session, nav),
            "lyrics" => new LyricsPanel(session),
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

        session.Player.QueueChanged += Refresh;
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) Refresh();
        };
        DetachedFromVisualTree += (_, _) => session.Player.QueueChanged -= Refresh;
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

/// views/components/lyrics-view.ejs (style.less .lyric-body, .lyric-line): the lines as 26 px h3s 10 px
/// apart and 5 % in, the current one whole, the others at 80 % size and 75 % with a 1 px blur (gone while
/// the pointer is over them); word-timed lines light word by word (the others at 60 %). A click seeks to
/// the line. Behind it, the playing cover (bgArtworkMaterial: brightness 80 %, blurred, saturated).
public sealed class LyricsPanel : Panel
{
    static readonly IBrush Lit = Brushes.White, Unlit = new SolidColorBrush(Color.FromArgb(153, 255, 255, 255));
    readonly Session session;
    readonly ScrollViewer scroll = new()
    {
        HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
        VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Hidden,
    };
    readonly StackPanel lines = new() { Margin = new Thickness(0, 120) };
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(50) };
    readonly LyricsBackdrop backdrop = new();
    LyricsDoc? doc;
    int active = -2;

    readonly double size;

    /// `size`: the lines' font size (26 px in the drawer, 35 px in the fullscreen view, which has its own
    /// backdrop).
    public LyricsPanel(Session session, double size = 26, bool withBackdrop = true)
    {
        this.session = session;
        this.size = size;
        backdrop.IsVisible = withBackdrop;
        scroll.Content = lines;
        // .lyric-body's mask: whole down to 95 %, gone at the bottom.
        scroll.OpacityMask = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
            GradientStops = { new GradientStop(Colors.Black, 0.95), new GradientStop(Colors.Transparent, 1) },
        };
        Children.Add(backdrop);
        Children.Add(scroll);
        scroll.PointerEntered += (_, _) => Blur(false);
        scroll.PointerExited += (_, _) => Blur(true);
        tick.Tick += (_, _) => Follow();
        session.Lyrics.PropertyChanged += (_, _) => Build();
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) backdrop.Url = session.Player.Track?.Cover;
        };
        AttachedToVisualTree += (_, _) => tick.Start();
        DetachedFromVisualTree += (_, _) => tick.Stop();
        backdrop.Url = session.Player.Track?.Cover;
        Build();
    }

    /// The index of the lit line (tests read it).
    public int Active => active;

    void Build()
    {
        doc = session.Lyrics.Status == LyricsStatus.Ready ? session.Lyrics.Doc : null;
        lines.Children.Clear();
        active = -2;
        if (doc is null)
        {
            lines.Children.Add(new TextBlock { Text = "No Lyrics", FontSize = size, FontWeight = FontWeight.Bold, HorizontalAlignment = HorizontalAlignment.Center });
            return;
        }
        foreach (var line in doc.Lines)
        {
            var text = new TextBlock
            {
                FontSize = size,
                FontWeight = FontWeight.Bold,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(15, 10, 10, 10),
                Opacity = 0.75,
                RenderTransformOrigin = new RelativePoint(0, 0.5, RelativeUnit.Relative),
                RenderTransform = TransformOperations.Parse("scale(0.8)"),
                Effect = new BlurEffect { Radius = 2 },
                Cursor = new Cursor(StandardCursorType.Hand),
                Transitions =
                [
                    new TransformOperationsTransition { Property = RenderTransformProperty, Duration = TimeSpan.FromMilliseconds(500), Easing = new SineEaseInOut() },
                    new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(350), Easing = new SineEaseInOut() },
                ],
            };
            if (line.Words is { Count: > 0 } words)
                foreach (var w in words) text.Inlines!.Add(new Run(w.IsPartOfWord ? w.Text : w.Text + " ") { Foreground = Unlit });
            else text.Text = line.Text;
            var start = line.Start;
            text.PointerPressed += (_, _) => session.Player.Seek(TimeSpan.FromMilliseconds(Math.Max(0, start - Offset)));
            lines.Children.Add(text);
        }
        Follow();
    }

    long Offset => (doc?.OffsetMs ?? 0) + session.Lyrics.OffsetMs;

    void Follow()
    {
        if (doc is null || lines.Children.Count != doc.Lines.Count) return;
        var at = (long)session.Player.PositionNow.TotalMilliseconds + Offset;
        var now = -1;
        for (var i = 0; i < doc.Lines.Count; i++)
            if (doc.Lines[i].Start <= at) now = i;
        if (now != active)
        {
            for (var i = 0; i < lines.Children.Count; i++)
            {
                var on = i == now;
                var line = lines.Children[i];
                line.Opacity = on ? 1 : 0.75;
                line.RenderTransform = TransformOperations.Parse(on ? "scale(1)" : "scale(0.8)");
                if (!scroll.IsPointerOver) line.Effect = on ? null : new BlurEffect { Radius = 2 };
            }
            active = now;
        }
        // Word by word on the lit line (Cider's verse-active), the rest of it at 60 %.
        if (now >= 0 && doc.Lines[now].Words is { Count: > 0 } words && lines.Children[now] is TextBlock { Inlines: { } inlines })
            for (var k = 0; k < words.Count && k < inlines.Count; k++)
                ((Run)inlines[k]).Foreground = words[k].Start <= at ? Lit : Unlit;
        // Keep the lit line a third of the way down, easing there.
        var target = now < 0 ? 0 : Math.Max(0, lines.Children[now].Bounds.Y + lines.Margin.Top - scroll.Viewport.Height / 3);
        var y = scroll.Offset.Y + (target - scroll.Offset.Y) * 0.2;
        scroll.Offset = new Vector(0, Math.Abs(target - y) < 0.5 ? target : y);
    }

    void Blur(bool on)
    {
        for (var i = 0; i < lines.Children.Count; i++)
            lines.Children[i].Effect = on && i != active ? new BlurEffect { Radius = 2 } : null;
    }
}

/// The lyrics drawer's background (.app-drawer .bgArtworkMaterial): the playing cover at brightness 80 %,
/// blurred and saturated, baked once per cover.
public sealed class LyricsBackdrop : Control
{
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
