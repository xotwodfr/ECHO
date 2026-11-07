using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Cider's sidebar (views/components/sidebar.ejs; style.less #app-sidebar): 260 px on the window's ground,
/// 8 px in; the Library (Recently Added, Songs, Albums, Artists: Videos and Podcasts are Apple Music's)
/// and the Playlists, each under a header that folds it away. In Maverick, which has no tabs, the search
/// field heads it and "Cider" holds Home (ECHO's name stands there).
public sealed class Sidebar : Border
{
    public const double Width1 = 260;

    readonly Session session;
    readonly Nav nav;
    readonly StackPanel playlists = new();
    readonly List<(Button Item, Func<Route, bool> Active)> items = [];
    readonly TextBox? search;

    /// Enter in Maverick's search field.
    public event Action<string>? Searched;

    public Sidebar(Session session, Nav nav, bool maverick = false)
    {
        this.session = session;
        this.nav = nav;
        Width = Width1;

        var library = new StackPanel
        {
            Children =
            {
                Item(Icons.PlusCircle, "Recently Added", new Route("library-recentlyadded")),
                Item(Icons.Music, "Songs", new Route("library-songs")),
                Item(Icons.Disc, "Albums", new Route("library-albums")),
                Item(Icons.User, "Artists", new Route("library-artists")),
            },
        };
        var create = Item(Icons.Plus, "Create New", null);
        create.Click += (_, _) => _ = CreatePlaylist();
        var lists = new StackPanel { Children = { create, playlists } };
        var groups = new StackPanel { Children = { Header("Library", library), library, Header("Playlists", lists), lists } };
        var scroll = new ScrollViewer { Padding = new Thickness(8), Content = groups };
        if (!maverick)
        {
            Child = scroll;
        }
        else
        {
            var home = new StackPanel { Children = { Item(Icons.Home, "Home", new Route("home")) } };
            groups.Children.InsertRange(0, [Header("ECHO", home), home]);
            search = new TextBox { Classes = { "search" }, PlaceholderText = "Search..." };
            search.KeyDown += (_, e) =>
            {
                if (e.Key == Avalonia.Input.Key.Enter && !string.IsNullOrWhiteSpace(search.Text)) Searched?.Invoke(search.Text.Trim());
            };
            // .app-sidebar-header: 11 px round the field.
            var top = Blocks.Search(search, new Thickness(11));
            DockPanel.SetDock(top, Dock.Top);
            Child = new DockPanel { Children = { top, scroll } };
        }
        nav.Changed += Show;
        _ = LoadPlaylists();
    }

    /// Ctrl+F in Maverick: its search field is here.
    public bool FocusSearch() => search?.Focus() ?? false;

    /// The server's playlists under Playlists (again after one is made).
    public async Task LoadPlaylists()
    {
        IReadOnlyList<Playlist> list;
        try
        {
            list = await session.Library.Playlists();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            return; // the library's own pages say what is wrong
        }
        items.RemoveAll(i => playlists.Children.Contains(i.Item));
        playlists.Children.Clear();
        foreach (var p in list) playlists.Children.Add(Item(Icons.List, p.Name, new Route("playlist", p.Id, p.Name)));
        Show();
    }

    /// "Create New": a playlist named as Cider names it, then opened.
    async Task CreatePlaylist()
    {
        try
        {
            var created = await session.Library.CreatePlaylist("New Playlist");
            await LoadPlaylists();
            if (created is not null) nav.Open(new Route("playlist", created, "New Playlist"));
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            session.Player.Notice = "Can't reach the server.";
        }
    }

    void Show()
    {
        foreach (var (item, active) in items) item.Classes.Set("active", active(nav.Current));
    }

    Button Item(Icon icon, string name, Route? to)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("SidebarItem"),
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12,
                // The icon in the key colour, as Apple Music's sidebar has them.
                Children = { new Glyph(icon, 17) { Foreground = Kit.Brush("Key") }, new TextBlock { Text = name, FontSize = 13.5, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center } },
            },
        };
        if (to is not null)
        {
            b.Click += (_, _) => nav.Open(to);
            items.Add((b, r => r.Page == to.Page && r.Id == to.Id));
        }
        return b;
    }

    /// .app-sidebar-header-text: 11 px, 600, half opaque, a chevron at the right that folds the group.
    static Control Header(string text, Control group)
    {
        var chevron = new Glyph(new Icon(24, 24, "", "M 6,9 l 6,6 l 6,-6", 2), 16) { HorizontalAlignment = HorizontalAlignment.Right };
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(6),
            Margin = new Thickness(0, 8, 0, 2),
            Opacity = 0.5,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = new Panel { Children = { new TextBlock { Text = text, FontSize = 11, FontWeight = FontWeight.SemiBold }, chevron } },
        };
        b.Click += (_, _) =>
        {
            group.IsVisible = !group.IsVisible;
            chevron.Icon = new Icon(24, 24, "", group.IsVisible ? "M 6,9 l 6,6 l 6,-6" : "M 9,18 l 6,-6 l -6,-6", 2);
        };
        return b;
    }
}
