using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Cider's song grid (elements.less .mediaitem-list-item__grid): its 60 px rows 350 px wide, four to a
/// column, columns side by side scrolling sideways, on the well's tint.
public static class SongGrid
{
    public static Control Of(Session session, Nav nav, IReadOnlyList<Track> tracks, PlayContext context)
    {
        var columns = new StackPanel { Orientation = Orientation.Horizontal };
        for (var i = 0; i < tracks.Count; i += 4)
        {
            var list = new TrackList(session, nav, tracks, context, Rows.Compact) { Width = 350 };
            list.ItemsSource = ((IEnumerable<TrackList.Row>)list.ItemsSource!).Skip(i).Take(4).ToList();
            columns.Children.Add(list);
        }
        return new Border
        {
            Background = new SolidColorBrush(Color.Parse("#0DC8C8C8")),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(16),
            BoxShadow = BoxShadows.Parse("0 0 0 1 #14000000"),
            Margin = new Thickness(0, 8, 0, 0),
            Child = new ScrollViewer
            {
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Content = columns,
            },
        };
    }

    /// A row of squares scrolling sideways (`mediaitem-scroller-horizontal-large`), in a well.
    public static Control Scroller(IEnumerable<Control> squares)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var s in squares) row.Children.Add(s);
        return Blocks.Well(new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = row,
        });
    }

    /// An artist's square: the picture round, the name under it.
    public static Control Artist(Nav nav, ArtistCard a)
    {
        var art = new CoverImage(a.Image, 190, 300, 95) { Margin = new Thickness(6), Cursor = new Cursor(StandardCursorType.Hand) };
        art.PointerPressed += (_, _) => nav.Open(new Route("artist", a.Id, a.Name));
        var name = Kit.Text(a.Name, 14);
        name.HorizontalAlignment = HorizontalAlignment.Center;
        name.MaxWidth = 198;
        return new StackPanel { Width = 220, Height = 230, Children = { art, name } };
    }
}

/// views/pages/search.ejs, on the library (Cider's Apple Music half of the toggle is left out): Songs in
/// the song grid, then Albums and Artists in rows of squares; "No Results" when nothing matches.
public sealed class SearchPage : ScrollViewer
{
    public SearchPage(Session session, Nav nav, string term)
    {
        var column = Blocks.Column(new Thickness(32));
        Content = column;
        _ = Load(session, nav, term, column);
    }

    static async Task Load(Session session, Nav nav, string term, StackPanel column)
    {
        SearchResult r;
        try
        {
            r = await session.Library.Search(term);
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            column.Children.Add(Blocks.Message(await Blocks.Failed(session, e)));
            return;
        }
        if (r.Tracks.Count + r.Albums.Count + r.Artists.Count == 0)
        {
            column.Children.Add(Blocks.H3("No Results"));
            column.Children.Add(new TextBlock { Text = "Try a new search.", FontSize = 14, Margin = new Thickness(0, 12) });
            return;
        }
        if (r.Tracks.Count > 0)
        {
            column.Children.Add(Blocks.H3("Songs"));
            column.Children.Add(SongGrid.Of(session, nav, r.Tracks, new PlayContext("search", null, term)));
        }
        if (r.Albums.Count > 0)
        {
            column.Children.Add(Spaced(Blocks.H3("Albums")));
            column.Children.Add(SongGrid.Scroller(r.Albums.Select(a => Blocks.Square(session, nav, a))));
        }
        if (r.Artists.Count > 0)
        {
            column.Children.Add(Spaced(Blocks.H3("Artists")));
            column.Children.Add(SongGrid.Scroller(r.Artists.Select(a => SongGrid.Artist(nav, a))));
        }
    }

    static Control Spaced(Control c)
    {
        c.Margin = new Thickness(0, 24, 0, 0);
        return c;
    }
}

/// views/pages/artist.ejs (pages.less .artist-page): a 400 px header over the picture's artwork
/// material — the 200 px round picture 32 px in, the name as h1 with the round play button, "…" at the
/// bottom right — then, pulled 64 px up over it, the well with the Latest Release (250 px) beside the
/// Top Songs, the albums, About and Similar Artists. Play plays the top songs (Cider started Apple's
/// artist radio).
public sealed class ArtistPage : ScrollViewer
{
    public ArtistPage(Session session, Nav nav, Route route)
    {
        var column = new StackPanel();
        Content = column;
        _ = Load(session, nav, route, column);
    }

    static async Task Load(Session session, Nav nav, Route route, StackPanel column)
    {
        Echo.ArtistPage? page;
        ArtistInfo info;
        IReadOnlyList<Track> top;
        try
        {
            page = await session.Library.Artist(route.Id!);
            if (page is null)
            {
                column.Children.Add(Blocks.Column(new Thickness(32), Blocks.Message("This artist is not in your library any more.")));
                return;
            }
            info = await session.Library.ArtistInfo(route.Id!);
            top = await session.Library.TopSongs(page.Name, 20);
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            column.Children.Add(Blocks.Column(new Thickness(32), Blocks.Message(await Blocks.Failed(session, e))));
            return;
        }
        var albums = page.Albums.OrderByDescending(a => a.Year ?? 0).ToList();
        var songs = top.Count > 0 ? top : (await FirstAlbum(session, albums));
        var ctx = new PlayContext("artist", route.Id, page.Name);

        // ---- the header ----
        var play = new Button { Theme = Kit.Res<ControlTheme>("RoundMore"), Content = new Glyph(Icons.PlaySmall, 12), Margin = new Thickness(14, 3, 0, 0) };
        play.Click += (_, _) =>
        {
            if (songs.Count > 0) _ = session.Player.PlayList(songs, 0, ctx);
        };
        var more = new Button
        {
            Theme = Kit.Res<ControlTheme>("RoundMore"),
            Content = new Glyph(Icons.More, 20),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 28, 82),
        };
        var love = new MenuItem { Header = "Favorite" };
        love.Click += (_, _) => _ = session.Library.Star(StarKind.Artist, route.Id!, true);
        more.ContextMenu = new ContextMenu { ItemsSource = new[] { love } };
        more.Click += (_, _) => more.ContextMenu.Open(more);
        var head = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                new CoverImage(info.Image, 200, 600, 100) { Margin = new Thickness(32) },
                new TextBlock { Text = page.Name, FontSize = 32, FontWeight = FontWeight.Bold, VerticalAlignment = VerticalAlignment.Center },
                new Border { VerticalAlignment = VerticalAlignment.Center, Child = play },
            },
        };
        column.Children.Add(new Panel { MinHeight = 400, Children = { new ArtworkMaterial { Url = info.Image }, head, more } });

        // ---- the body, 64 px up ----
        var arow = new Grid { ColumnDefinitions = new ColumnDefinitions(albums.Count > 0 ? "250,*" : "*") };
        if (albums.Count > 0)
            arow.Children.Add(Blocks.Column(default, Blocks.H3("Latest Release"), Blocks.Square(session, nav, albums[0], albums[0].Year?.ToString())));
        arow.Children.Add(new Border
        {
            [Grid.ColumnProperty] = albums.Count > 0 ? 1 : 0,
            Child = Blocks.Column(default, Blocks.H3("Top Songs"), SongGrid.Of(session, nav, songs, ctx)),
        });
        var well = Blocks.Well(arow);
        well.Padding = new Thickness(32, 16);
        var body = Blocks.Column(new Thickness(36, -64, 36, 32), well);
        if (albums.Count > 0)
        {
            body.Children.Add(Gap(Blocks.H3("Albums")));
            body.Children.Add(SongGrid.Scroller(albums.Select(a => Blocks.Square(session, nav, a, a.Year?.ToString()))));
        }
        if (info.Bio is { } bio)
        {
            body.Children.Add(Gap(Blocks.H3($"About {page.Name}")));
            body.Children.Add(new TextBlock { Text = bio, FontSize = 14, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12), MaxWidth = 900, HorizontalAlignment = HorizontalAlignment.Left });
        }
        if (info.Similar.Count > 0)
        {
            body.Children.Add(Gap(Blocks.H3("Similar Artists")));
            body.Children.Add(SongGrid.Scroller(info.Similar.Select(a => SongGrid.Artist(nav, a))));
        }
        column.Children.Add(body);
    }

    static Control Gap(Control c)
    {
        c.Margin = new Thickness(0, 24, 0, 0);
        return c;
    }

    /// No top songs (Last.fm knows nothing of the artist): the newest album's songs instead.
    static async Task<IReadOnlyList<Track>> FirstAlbum(Session session, IReadOnlyList<Album> albums)
    {
        if (albums.Count == 0) return [];
        try
        {
            return (await session.Library.Album(albums[0].Id))?.Tracks ?? [];
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            return [];
        }
    }
}
