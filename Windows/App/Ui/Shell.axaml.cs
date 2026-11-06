using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Ui;

/// The signed-in window: the page Nav points at, under the glass.
public partial class Shell : UserControl
{
    readonly Session session;

    public Shell() : this(Session.ForFixtures()) { } // the XAML previewer

    public Shell(Session session)
    {
        this.session = session;
        InitializeComponent();
        PlayerPill.Bind(session);
        foreach (var (label, page) in new (string, object)[] { ("Home", new HomePage()), ("Search", new SearchPage()), ("Your Library", new AlbumsPage()) })
            NavItems.Children.Add(Item(label, page, bold: true));
        SearchCapsule.PointerPressed += (_, _) => session.Nav.Go(new SearchPage());
        Account.PointerPressed += (_, _) => session.Nav.Go(new SettingsPage());
        if (!session.Fixtures) _ = LoadInitial();
        session.QueueToggled += () =>
        {
            if (session.Nav.Current is ListenPage) return; // the room has its own
            QueueHost.Content = QueueHost.Content is null ? new QueueSheet(session) : null;
        };
        _ = LoadPlaylists();
        Initial.Text = session.Fixtures ? "F" : "";
        session.Nav.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Nav.Current)) Show(session.Nav.Current);
        };
        Show(session.Nav.Current);
        _ = session.Player.Restore(); // the queue from another device, paused
    }

    /// A keyboard shortcut (Shortcuts.cs); Escape answers whether it closed something.
    public bool Do(ShortcutAction action)
    {
        var p = session.Player;
        var listen = PageHost.Content as ListenView;
        void Listen(StageViewMode mode)
        {
            if (listen is null) session.Nav.Go(new ListenPage());
            (PageHost.Content as ListenView)?.SetMode(mode);
        }
        switch (action)
        {
            case ShortcutAction.TogglePlay: p.Toggle(); break;
            case ShortcutAction.SeekBack5: p.Seek(p.PositionNow - TimeSpan.FromSeconds(5)); break;
            case ShortcutAction.SeekForward5: p.Seek(p.PositionNow + TimeSpan.FromSeconds(5)); break;
            case ShortcutAction.SeekBack15: p.Seek(p.PositionNow - TimeSpan.FromSeconds(15)); break;
            case ShortcutAction.SeekForward15: p.Seek(p.PositionNow + TimeSpan.FromSeconds(15)); break;
            case ShortcutAction.Previous: _ = p.Previous(); break;
            case ShortcutAction.Next: _ = p.Next(); break;
            case ShortcutAction.VolumeUp: p.Volume = Math.Min(1, p.Volume + 0.05f); break;
            case ShortcutAction.VolumeDown: p.Volume = Math.Max(0, p.Volume - 0.05f); break;
            case ShortcutAction.Mute: p.Muted = !p.Muted; break;
            case ShortcutAction.ToggleLyrics:
                if (listen?.Mode == StageViewMode.Lyrics) listen.SetMode(StageViewMode.Visual);
                else Listen(StageViewMode.Lyrics);
                break;
            case ShortcutAction.CycleView:
                if (listen is not null) listen.CycleMode();
                else Listen(StageViewMode.Lyrics);
                break;
            case ShortcutAction.CoverMode: Listen(StageViewMode.Cover); break;
            case ShortcutAction.ToggleQueue: session.ToggleQueue(); break;
            case ShortcutAction.Search: session.Nav.Go(new SearchPage()); break;
            case ShortcutAction.GoLibrary: session.Nav.Go(new AlbumsPage()); break;
            case ShortcutAction.GoSettings: session.Nav.Go(new SettingsPage()); break;
            case ShortcutAction.GoListen: session.Nav.Go(new ListenPage()); break;
            case ShortcutAction.FullScreen: (TopLevel.GetTopLevel(this) as MainWindow)?.ToggleFullScreen(); break;
            case ShortcutAction.OffsetEarlier or ShortcutAction.OffsetLater:
                var step = action == ShortcutAction.OffsetLater ? 50 : -50;
                session.Prefs.Update(x => x with { LyricOffsetMs = Math.Clamp(x.LyricOffsetMs + step, -10_000, 10_000) });
                var ms = session.Prefs.State.LyricOffsetMs;
                p.Notice = $"Lyric timing {(ms == 0 ? "0 ms" : $"{(ms > 0 ? "+" : "−")}{Math.Abs(ms)} ms")}";
                break;
            case ShortcutAction.Shuffle: p.SetShuffle(!p.Queue.Shuffle); break;
            case ShortcutAction.Repeat: p.CycleRepeat(); break;
            case ShortcutAction.ShortcutSheet: OverlayHost.Content = OverlayHost.Content is null ? ShortcutSheet() : null; break;
            case ShortcutAction.Escape:
                if (OverlayHost.Content is not null) OverlayHost.Content = null;
                else if (QueueHost.Content is not null) QueueHost.Content = null;
                else return false;
                break;
        }
        return true;
    }

    /// The shortcut sheet (PRODUCT_SPEC.md S7): every key, in glass at the middle.
    static Control ShortcutSheet()
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), RowDefinitions = new RowDefinitions(string.Join(",", Shortcuts.Sheet.Select(_ => "Auto"))) };
        for (var i = 0; i < Shortcuts.Sheet.Length; i++)
        {
            var (keys, what) = Shortcuts.Sheet[i];
            grid.Children.Add(new TextBlock { Text = keys, FontWeight = FontWeight.SemiBold, FontSize = 13, Margin = new Thickness(0, 4, 24, 4), [Grid.RowProperty] = i });
            grid.Children.Add(new TextBlock { Text = what, FontSize = 13, Opacity = 0.75, Margin = new Thickness(0, 4), [Grid.RowProperty] = i, [Grid.ColumnProperty] = 1 });
        }
        return new Glass.GlassPanel
        {
            Name = "Shortcuts", Width = 520, CornerRadius = new CornerRadius(22), Padding = new Thickness(28, 24),
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Child = new StackPanel { Spacing = 12, Children = { new TextBlock { Text = "Keyboard shortcuts", FontSize = 20, FontWeight = FontWeight.Bold }, grid } },
        };
    }

    Button Item(string label, object page, bool bold = false)
    {
        var b = new Button
        {
            Theme = Page.Bare, CornerRadius = new CornerRadius(12), Padding = new Thickness(10, bold ? 8 : 6),
            HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Tag = page,
            Content = new TextBlock { Text = label, FontSize = bold ? 13 : 12, FontWeight = bold ? FontWeight.SemiBold : FontWeight.Normal, TextTrimming = TextTrimming.CharacterEllipsis },
        };
        b.Click += (_, _) => session.Nav.Go(page);
        return b;
    }

    async Task LoadInitial()
    {
        try
        {
            Initial.Text = Api.Text((await session.Api.Get("/me"))["username"]) is { Length: > 0 } name ? name[..1].ToUpperInvariant() : "";
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { }
    }

    async Task LoadPlaylists()
    {
        try
        {
            foreach (var p in await session.Playlists()) PlaylistItems.Children.Add(Item(p.Name, new PlaylistPage(p.Id, p.Name)));
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { } // the page says so
    }

    void Show(object page)
    {
        // The page's own item is lit (the library's tabs count as Your Library).
        var library = page is AlbumsPage or ArtistsPage or PlaylistsPage or StarredPage or WantedPage;
        foreach (var b in NavItems.Children.OfType<Button>().Concat(PlaylistItems.Children.OfType<Button>()))
            b.Background = Equals(b.Tag, page) || (library && b.Tag is AlbumsPage) ? new SolidColorBrush(Color.Parse("#26FFFFFF")) : Brushes.Transparent;
        var listen = page is ListenPage;
        if (listen) QueueHost.Content = null;
        // The Listen room has no sidebar and no capsules (the web's Stage); the pill stays for now.
        Sidebar.IsVisible = !listen;
        SearchCapsule.IsVisible = !listen;
        Account.IsVisible = !listen;
        PlayerPill.IsVisible = !listen;
        PageHost.Content = page switch
        {
            AlbumPage a => new AlbumView(session, a.Album),
            AlbumsPage => new AlbumsView(session),
            ArtistsPage => new ArtistsView(session),
            ArtistPage a => new ArtistView(session, a.Id, a.Name),
            PlaylistsPage => new PlaylistsView(session),
            PlaylistPage p => new PlaylistView(session, p.Id, p.Name),
            StarredPage => new StarredView(session),
            MixPage m => new MixView(session, m.Mix),
            SearchPage => new SearchView(session),
            WantedPage => new WantedView(session),
            SettingsPage => new SettingsView(session),
            ListenPage => new ListenView(session),
            _ => new HomeView(session),
        };
    }
}
