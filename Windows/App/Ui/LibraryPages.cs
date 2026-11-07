using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Cider's pieces the library pages share: the page (`.content-inner`, 32 px in), its h1, the `.well`
/// (rgba(200 200 200 / .05), radius 10, 16 px in, 16 px down) and the album square.
public static class Blocks
{
    public static ScrollViewer Page(params Control[] children) =>
        new() { Content = Column(new Thickness(32), children) };

    public static StackPanel Column(Thickness margin, params Control[] children)
    {
        var s = new StackPanel { Margin = margin };
        foreach (var c in children) s.Children.Add(c);
        return s;
    }

    /// Today's large title: 30 px, bold, tracked in tight.
    public static TextBlock H1(string text) => new() { Text = text, FontSize = 30, FontWeight = FontWeight.Bold, LetterSpacing = -0.6 };

    public static TextBlock H3(string text) => new() { Text = text, FontSize = 18.7, FontWeight = FontWeight.Bold, VerticalAlignment = VerticalAlignment.Center };

    public static Border Well(Control child) => new()
    {
        Background = new SolidColorBrush(Color.Parse("#0DC8C8C8")),
        CornerRadius = new CornerRadius(10),
        Padding = new Thickness(16),
        Margin = new Thickness(0, 16, 0, 0),
        Child = child,
    };

    /// `.cd-btn-seeall`: key-coloured, 500, 16 px.
    public static Button SeeAll(string text, Action click)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            Padding = new Thickness(6),
            CornerRadius = new CornerRadius(4),
            Content = new TextBlock { Text = text, FontSize = 16, FontWeight = FontWeight.Medium, Foreground = Kit.Brush("Key") },
        };
        b.Click += (_, _) => click();
        return b;
    }

    /// The search field Cider puts over its library lists.
    public static Panel Search(TextBox box, Thickness margin) => new()
    {
        Margin = margin,
        Children = { box, new Glyph(Icons.Search, 12) { Margin = new Thickness(10, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, Opacity = 0.55, IsHitTestVisible = false } },
    };

    /// An album as Apple Music shows it in a grid or a shelf: the cover rounded (6 px) with a soft shadow,
    /// the title and the artist under it, left-aligned, one line each; on hover Cider's play and menu
    /// circles at the cover's bottom corners.
    public static Tile Square(Session session, Nav nav, Album album, string? subtitle = null, double side = 180)
    {
        var art = new CoverImage(album.Cover, side, 300, 6);
        var play = Circle(Icons.PlaySmall, 11);
        var menu = Circle(Icons.More, 18);
        play.HorizontalAlignment = HorizontalAlignment.Left;
        menu.HorizontalAlignment = HorizontalAlignment.Right;
        play.Margin = new Thickness(10, 0, 0, 10);
        menu.Margin = new Thickness(0, 0, 10, 10);
        play.Click += async (_, _) =>
        {
            try
            {
                if (await session.Library.Album(album.Id) is { Tracks.Count: > 0 } a)
                    await session.Player.PlayList(a.Tracks, 0, new PlayContext("album", a.Id, a.Title));
            }
            catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
            {
                session.Player.Notice = "Can't reach the server.";
            }
        };
        var artist = album.ArtistId is { } id ? new Route("artist", id, album.Artist) : null;
        menu.ContextMenu = new ContextMenu
        {
            ItemsSource = new[] { ("Open", (Route?)new Route("album", album.Id, album.Title)), ("Go to Artist", artist) }
                .Where(i => i.Item2 is not null)
                .Select(i =>
                {
                    var m = new MenuItem { Header = i.Item1 };
                    m.Click += (_, _) => nav.Open(i.Item2!);
                    return m;
                }).ToList(),
        };
        menu.Click += (_, _) => menu.ContextMenu.Open(menu);
        art.PointerPressed += (_, e) =>
        {
            if (e.GetCurrentPoint(art).Properties.IsLeftButtonPressed) nav.Open(new Route("album", album.Id, album.Title));
        };
        var sub = Kit.Text(subtitle ?? album.Artist, 13, opacity: 0.6);
        if (artist is not null && subtitle is null)
        {
            sub.Cursor = new Cursor(StandardCursorType.Hand);
            sub.PointerPressed += (_, _) => nav.Open(artist);
        }
        return new Tile(art, [play, menu], Kit.Text(album.Title, 13, FontWeight.Medium), sub, side);
    }

    static Button Circle(Icon icon, double size) => new()
    {
        Theme = Kit.Res<ControlTheme>("TileCircle"),
        Content = new Glyph(icon, size),
    };

    /// Apple Music's library grid: as many columns as fit tiles of 160–220 px with 24 px between, the
    /// tiles stretched to fill the row; filled a page at a time as the scroll nears its end (Cider's
    /// infinite scroll).
    public static Control Grid(Session session, Nav nav, IReadOnlyList<Album> albums, ScrollViewer scroll, Func<Album, string?>? subtitle = null)
    {
        const int Step = 60;
        var grid = new TileGrid();
        var shown = 0;
        void More()
        {
            foreach (var a in albums.Skip(shown).Take(Step))
            {
                var tile = Square(session, nav, a, subtitle?.Invoke(a));
                grid.Children.Add(tile);
                if (shown == 0) Motion.Cascade(tile, grid.Children.Count - 1);
            }
            shown = Math.Min(albums.Count, shown + Step);
        }
        More();
        scroll.ScrollChanged += (_, _) =>
        {
            if (shown < albums.Count && scroll.Offset.Y + scroll.Viewport.Height > scroll.Extent.Height - 600) More();
        };
        grid.Margin = new Thickness(0, 16, 0, 0);
        return grid;
    }

    public static TextBlock Message(string text) => new() { Text = text, Opacity = 0.7, FontSize = 14, Margin = new Thickness(0, 16) };

    /// What a page says when its load fails; a refused token signs out.
    public static async Task<string> Failed(Session session, Exception e)
    {
        if (e is ApiException { SignedOut: true })
        {
            await session.Player.SignOut();
            return "You were signed out.";
        }
        return "Can't reach the server.";
    }

    public static bool Expected(Exception e) => e is HttpRequestException or ApiException or TaskCanceledException;
}

/// views/pages/library-recentlyadded.ejs: "Recently Added" over the newest albums' tiles.
public sealed class RecentlyAddedPage : ContentControl
{
    public RecentlyAddedPage(Session session, Nav nav) => _ = Load(session, nav);

    async Task Load(Session session, Nav nav)
    {
        var scroll = new ScrollViewer();
        var column = Blocks.Column(new Thickness(32), Blocks.H1("Recently Added"));
        scroll.Content = column;
        Content = scroll;
        try
        {
            var albums = await session.Library.Albums(AlbumSort.Newest, 0, 200);
            column.Children.Add(Blocks.Grid(session, nav, albums, scroll));
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            column.Children.Add(Blocks.Message(await Blocks.Failed(session, e)));
        }
    }
}

/// views/pages/library-albums.ejs: "Albums", a search field and Sort by / Order, then the squares.
public sealed class AlbumsPage : ContentControl
{
    static readonly (string Label, Func<IEnumerable<Album>, IEnumerable<Album>> Order)[] Sorts =
    [
        ("Name", a => a.OrderBy(x => x.Title, StringComparer.CurrentCultureIgnoreCase)),
        ("Artist", a => a.OrderBy(x => x.Artist, StringComparer.CurrentCultureIgnoreCase).ThenBy(x => x.Year)),
        ("Date Added", a => a), // the server's newest-first order, kept as it came
        ("Release Date", a => a.OrderByDescending(x => x.Year ?? 0)),
    ];

    readonly Session session;
    readonly Nav nav;
    readonly ScrollViewer scroll = new();
    readonly StackPanel column;
    readonly TextBox search = new() { Classes = { "search" }, PlaceholderText = "Search..." };
    readonly ComboBox sort = new() { Classes = { "md" }, ItemsSource = Sorts.Select(s => s.Label).ToList(), SelectedIndex = 0 };
    readonly ComboBox order = new() { Classes = { "md" }, ItemsSource = new[] { "Ascending", "Descending" }, SelectedIndex = 0 };
    IReadOnlyList<Album> all = [];
    Control? grid;

    public AlbumsPage(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        header.Children.Add(Blocks.Search(search, new Thickness(0, 16)));
        header.Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 1,
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(16, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Children = { sort, order },
        });
        column = Blocks.Column(new Thickness(32), Blocks.H1("Albums"), header);
        scroll.Content = column;
        Content = scroll;
        search.TextChanged += (_, _) => Show();
        sort.SelectionChanged += (_, _) => Show();
        order.SelectionChanged += (_, _) => Show();
        _ = Load();
    }

    async Task Load()
    {
        try
        {
            all = await session.Library.AllAlbums(AlbumSort.Newest);
            Show();
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            column.Children.Add(Blocks.Message(await Blocks.Failed(session, e)));
        }
    }

    void Show()
    {
        var q = search.Text?.Trim() ?? "";
        var list = Sorts[Math.Max(0, sort.SelectedIndex)].Order(all.Where(a => q.Length == 0
            || a.Title.Contains(q, StringComparison.CurrentCultureIgnoreCase) || a.Artist.Contains(q, StringComparison.CurrentCultureIgnoreCase)));
        if (order.SelectedIndex == 1) list = list.Reverse();
        if (grid is not null) column.Children.Remove(grid);
        column.Children.Add(grid = Blocks.Grid(session, nav, list.ToList(), scroll));
    }
}

/// views/pages/library-songs.ejs: "Songs", a search field, the table's header, every song in Cider's rows
/// (virtualized; the pages after the first arrive while it shows).
public sealed class SongsPage : DockPanel
{
    readonly Session session;
    readonly Nav nav;
    readonly TextBox search = new() { Classes = { "search" }, PlaceholderText = "Search..." };
    readonly List<Track> all = [];
    readonly Border holder = new();

    public SongsPage(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        var top = Blocks.Column(new Thickness(32, 32, 32, 0), Blocks.H1("Songs"), Blocks.Search(search, new Thickness(0, 16)), TrackList.Header(Rows.Table));
        SetDock(top, Dock.Top);
        Children.Add(top);
        holder.Margin = new Thickness(32, 0, 32, 0);
        Children.Add(holder);
        search.TextChanged += (_, _) => Show();
        _ = Load();
    }

    public TrackList? List => holder.Child as TrackList;

    async Task Load()
    {
        try
        {
            // The first page shows at once; the rest once all are in (each new list would reset the scroll).
            for (var offset = 0; ; offset += 500)
            {
                var page = await session.Library.Songs(offset);
                all.AddRange(page);
                if (offset == 0 || page.Count < 500) Show();
                if (page.Count < 500) return;
            }
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            if (all.Count == 0) holder.Child = Blocks.Message(await Blocks.Failed(session, e));
        }
    }

    void Show()
    {
        var q = search.Text?.Trim() ?? "";
        var list = q.Length == 0 ? all.ToList() : all.Where(t => t.Title.Contains(q, StringComparison.CurrentCultureIgnoreCase)
            || t.Artist.Contains(q, StringComparison.CurrentCultureIgnoreCase) || t.Album.Title.Contains(q, StringComparison.CurrentCultureIgnoreCase)).ToList();
        holder.Child = new TrackList(session, nav, list, new PlayContext("songs", null, "Songs"), Rows.Table, virtualize: true);
    }
}

/// views/pages/library-artists.ejs: Cider's split view. A 280 px column of artists, faintly lit, under a
/// sticky search; beside it the chosen artist large with Go to Artist, and their albums as a grid.
public sealed class ArtistsPage : Grid
{
    readonly Session session;
    readonly Nav nav;
    readonly TextBox search = new() { Classes = { "search" }, PlaceholderText = "Search..." };
    readonly ListBox list = new();
    readonly ContentControl detail = new();
    IReadOnlyList<ArtistCard> all = [];

    public ArtistsPage(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        ColumnDefinitions = new ColumnDefinitions("280,*");
        list.Theme = Kit.Res<ControlTheme>("PlainList");
        list.ItemContainerTheme = Kit.Res<ControlTheme>("TrackRow");
        list.ItemTemplate = new Avalonia.Controls.Templates.FuncDataTemplate<ArtistCard>((a, _) => a is null ? null : new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Children =
            {
                new CoverImage(a.Image, 36, 96, 18) { Margin = new Thickness(8, 8, 12, 8) },
                Kit.Text(a.Name, 14),
            },
        });
        list.SelectionChanged += (_, _) =>
        {
            if (list.SelectedItem is ArtistCard a) _ = Open(a);
        };
        list.Padding = new Thickness(6, 0, 6, 6);
        var bar = new Border { Padding = new Thickness(10), Child = Blocks.Search(search, default) };
        DockPanel.SetDock(bar, Dock.Top);
        Children.Add(new Border
        {
            Background = new SolidColorBrush(Color.Parse("#08FFFFFF")),
            BorderBrush = Kit.Brush("Hairline"),
            BorderThickness = new Thickness(0, 0, 1, 0),
            Child = new DockPanel { Children = { bar, list } },
        });
        Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = detail });
        search.TextChanged += (_, _) => Show();
        _ = Load();
    }

    async Task Load()
    {
        try
        {
            all = await session.Library.Artists();
            Show();
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            detail.Content = Blocks.Column(new Thickness(32), Blocks.Message(await Blocks.Failed(session, e)));
        }
    }

    void Show()
    {
        var q = search.Text?.Trim() ?? "";
        list.ItemsSource = q.Length == 0 ? all : all.Where(a => a.Name.Contains(q, StringComparison.CurrentCultureIgnoreCase)).ToList();
    }

    async Task Open(ArtistCard a)
    {
        try
        {
            if (await session.Library.Artist(a.Id) is not { } page) return;
            var albums = new TileGrid { Min = 150, Margin = new Thickness(0, 0, 0, 8) };
            foreach (var album in page.Albums.OrderByDescending(x => x.Year ?? 0)) albums.Children.Add(Blocks.Square(session, nav, album, album.Year?.ToString()));
            var go = Kit.CiderButton("Go to Artist", null, () => nav.Open(new Route("artist", a.Id, a.Name)));
            go.HorizontalAlignment = HorizontalAlignment.Left;
            var name = Blocks.H1(a.Name);
            name.TextTrimming = TextTrimming.CharacterEllipsis;
            var head = new DockPanel
            {
                Children =
                {
                    new CoverImage(a.Image, 120, 300, 60) { [DockPanel.DockProperty] = Dock.Left, Margin = new Thickness(0, 0, 20, 0) },
                    new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 12, Children = { name, go } },
                },
            };
            var column = Blocks.Column(new Thickness(32, 28, 32, 32), head, Shelf.Section("Albums", albums));
            detail.Content = new ScrollViewer { Content = column };
            Motion.Enter(column);
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            detail.Content = Blocks.Column(new Thickness(32), Blocks.Message(await Blocks.Failed(session, e)));
        }
    }
}

/// A cover with a caption under it, its side set by whoever lays it out (a TileGrid, a shelf).
public sealed class Tile : StackPanel
{
    readonly CoverImage art;
    readonly TextBlock title, subtitle;

    public Tile(CoverImage art, Button[] hover, TextBlock title, TextBlock subtitle, double side)
    {
        this.art = art;
        this.title = title;
        this.subtitle = subtitle;
        var buttons = new Panel { Opacity = 0, VerticalAlignment = VerticalAlignment.Bottom };
        foreach (var b in hover) buttons.Children.Add(b);
        var top = new Border
        {
            CornerRadius = new CornerRadius(6),
            BoxShadow = BoxShadows.Parse("0 4 14 0 #40000000"),
            Cursor = new Cursor(StandardCursorType.Hand),
            Child = new Panel { Children = { art, buttons } },
        };
        // Under the pointer the cover lifts a little toward you (Apple Music's hover).
        top.Transitions = [new Avalonia.Animation.TransformOperationsTransition { Property = RenderTransformProperty, Duration = TimeSpan.FromMilliseconds(220), Easing = Motion.Out }];
        top.PointerEntered += (_, _) =>
        {
            buttons.Opacity = 1;
            top.RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("scale(1.03)");
        };
        top.PointerExited += (_, _) =>
        {
            buttons.Opacity = 0;
            top.RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("scale(1)");
        };
        title.Margin = new Thickness(0, 8, 0, 0);
        Children.Add(top);
        Children.Add(title);
        Children.Add(subtitle);
        Side = side;
    }

    public double Side
    {
        get => art.Width;
        set
        {
            art.Width = art.Height = value;
            Width = value;
            title.MaxWidth = subtitle.MaxWidth = value;
        }
    }
}

/// Lays Tiles in rows: as many columns as fit tiles of at least `Min` px with `Gap` between, each tile
/// stretched to share the width.
public sealed class TileGrid : Panel
{
    public double Min { get; init; } = 160;
    public double Gap { get; init; } = 24;
    public double RowGap { get; init; } = 28;

    int Columns(double width) => Math.Max(2, (int)((width + Gap) / (Min + Gap)));

    protected override Size MeasureOverride(Size available)
    {
        var width = double.IsInfinity(available.Width) ? 1000 : available.Width;
        var cols = Columns(width);
        var side = Math.Floor((width - Gap * (cols - 1)) / cols);
        double height = 0, row = 0;
        for (var i = 0; i < Children.Count; i++)
        {
            if (Children[i] is Tile t && Math.Abs(t.Side - side) > 0.5) t.Side = side;
            Children[i].Measure(new Size(side, double.PositiveInfinity));
            row = Math.Max(row, Children[i].DesiredSize.Height);
            if (i % cols == cols - 1 || i == Children.Count - 1)
            {
                height += row + (i == Children.Count - 1 ? 0 : RowGap);
                row = 0;
            }
        }
        return new Size(width, height);
    }

    protected override Size ArrangeOverride(Size final)
    {
        var cols = Columns(final.Width);
        var side = Math.Floor((final.Width - Gap * (cols - 1)) / cols);
        double y = 0, row = 0;
        for (var i = 0; i < Children.Count; i++)
        {
            var c = Children[i];
            c.Arrange(new Rect((i % cols) * (side + Gap), y, side, c.DesiredSize.Height));
            row = Math.Max(row, c.DesiredSize.Height);
            if (i % cols == cols - 1)
            {
                y += row + RowGap;
                row = 0;
            }
        }
        return final;
    }
}
