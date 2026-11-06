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
            ListenPage => new ListenView(session),
            _ => new HomeView(session),
        };
    }
}
