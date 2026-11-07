using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Songs in columns as Apple Music lays out top songs (Cider's mediaitem-list-item__grid): compact rows
/// 340 px wide, four to a column, the columns side by side scrolling sideways.
public static class SongGrid
{
    public static Control Of(Session session, Nav nav, IReadOnlyList<Track> tracks, PlayContext context)
    {
        var columns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 24 };
        for (var i = 0; i < tracks.Count; i += 4)
        {
            var list = new TrackList(session, nav, tracks, context, Rows.Compact) { Width = 340 };
            list.ItemsSource = ((IEnumerable<TrackList.Row>)list.ItemsSource!).Skip(i).Take(4).ToList();
            columns.Children.Add(list);
        }
        return new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = columns,
        };
    }

    /// An artist as Apple Music shows one: the picture round, the name centred under it.
    public static Control Artist(Nav nav, ArtistCard a, double side = 160)
    {
        var art = new CoverImage(a.Image, side, 300, side / 2) { Cursor = new Cursor(StandardCursorType.Hand) };
        art.PointerPressed += (_, _) => nav.Open(new Route("artist", a.Id, a.Name));
        var name = Kit.Text(a.Name, 13, FontWeight.Medium);
        name.HorizontalAlignment = HorizontalAlignment.Center;
        name.MaxWidth = side;
        name.Margin = new Thickness(0, 8, 0, 0);
        return new StackPanel { Width = side, Children = { art, name } };
    }
}

/// Search results (Cider's search.ejs, on the library; its Apple Music half of the toggle is left out),
/// laid out as Apple Music's: Top Results (the best artist, album and songs as small cards), then the
/// Songs in columns, Albums and Artists in shelves; "No Results" when nothing matches.
public sealed class SearchPage : ScrollViewer
{
    public SearchPage(Session session, Nav nav, string term)
    {
        var column = Blocks.Column(new Thickness(32, 24, 32, 32), Blocks.H1(term));
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
            column.Children.Add(Shelf.Section("No Results", new TextBlock { Text = "Try a new search.", FontSize = 14, Opacity = 0.7 }));
            return;
        }
        var ctx = new PlayContext("search", null, term);
        var top = new WrapPanel { ItemSpacing = 12, LineSpacing = 12 };
        if (r.Artists.FirstOrDefault() is { } artist)
            top.Children.Add(Result(artist.Image, true, artist.Name, "Artist", () => nav.Open(new Route("artist", artist.Id, artist.Name))));
        if (r.Albums.FirstOrDefault() is { } album)
            top.Children.Add(Result(album.Cover, false, album.Title, $"Album · {album.Artist}", () => nav.Open(new Route("album", album.Id, album.Title))));
        for (var i = 0; i < Math.Min(4, r.Tracks.Count); i++)
        {
            var at = i;
            var t = r.Tracks[i];
            top.Children.Add(Result(t.Cover, false, t.Title, $"Song · {t.Artist}", () => _ = session.Player.PlayList(r.Tracks, at, ctx)));
        }
        column.Children.Add(Shelf.Section("Top Results", top));
        if (r.Tracks.Count > 0) column.Children.Add(Shelf.Section("Songs", SongGrid.Of(session, nav, r.Tracks, ctx)));
        if (r.Albums.Count > 0) column.Children.Add(Shelf.Of("Albums", r.Albums.Select(a => Blocks.Square(session, nav, a)), 24));
        if (r.Artists.Count > 0) column.Children.Add(Shelf.Of("Artists", r.Artists.Select(a => SongGrid.Artist(nav, a)), 24));
    }

    /// Apple's top result: a small card, the artwork (round for an artist), the name over what it is.
    static Control Result(string? image, bool round, string name, string what, Action open)
    {
        var card = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            Background = new SolidColorBrush(Color.FromArgb(18, 255, 255, 255)),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10),
            Width = 300,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12,
                Children =
                {
                    new CoverImage(image, 52, 120, round ? 26 : 6),
                    new StackPanel { VerticalAlignment = VerticalAlignment.Center, MaxWidth = 210, Children = { Kit.Text(name, 14, FontWeight.SemiBold), Kit.Text(what, 12, opacity: 0.6) } },
                },
            },
        };
        card.Click += (_, _) => open();
        return card;
    }
}

/// An artist (Cider's artist.ejs) laid out as Apple Music's: the picture across the top, 380 px, fading
/// into the page, the name over it at the bottom left with a round play button in the key colour and
/// "…"; then the Latest Release beside the Top Songs, the albums in a shelf, About, Similar Artists.
/// Play plays the top songs (Cider started Apple's artist radio).
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
        var songs = top.Count > 0 ? top : await FirstAlbum(session, albums);
        var ctx = new PlayContext("artist", route.Id, page.Name);

        // ---- the banner ----
        var play = new Button { Theme = Kit.Res<ControlTheme>("KeyCircle"), Content = new Glyph(Icons.PlaySmall, 16) { Margin = new Thickness(3, 0, 0, 0) } };
        play.Click += (_, _) =>
        {
            if (songs.Count > 0) _ = session.Player.PlayList(songs, 0, ctx);
        };
        var more = new Button { Theme = Kit.Res<ControlTheme>("RoundMore"), Content = new Glyph(Icons.More, 20) };
        var love = new MenuItem { Header = "Favorite" };
        love.Click += (_, _) => _ = session.Library.Star(StarKind.Artist, route.Id!, true);
        more.ContextMenu = new ContextMenu { ItemsSource = new[] { love } };
        more.Click += (_, _) => more.ContextMenu.Open(more);
        var name = new TextBlock { Text = page.Name, FontSize = 48, FontWeight = FontWeight.Bold, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        var bottom = new DockPanel
        {
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(32, 0, 32, 24),
            Children =
            {
                new Border { [DockPanel.DockProperty] = Dock.Left, Child = play, Margin = new Thickness(0, 0, 16, 0), VerticalAlignment = VerticalAlignment.Center },
                new Border { [DockPanel.DockProperty] = Dock.Right, Child = more, VerticalAlignment = VerticalAlignment.Center },
                name,
            },
        };
        var fade = new Border
        {
            Background = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Color.FromArgb(0, 30, 30, 30), 0.35), new GradientStop(Color.FromArgb(235, 30, 30, 30), 1) },
            },
        };
        column.Children.Add(new Panel
        {
            Height = 380,
            ClipToBounds = true,
            Children = { new ArtworkMaterial { Url = info.Image }, new CoverImage(info.Image, double.NaN, 1200, 0) { Opacity = 0.85 }, fade, bottom },
        });

        // ---- the body ----
        var body = Blocks.Column(new Thickness(32, 8, 32, 32));
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions(albums.Count > 0 ? "Auto,*" : "*") };
        if (albums.Count > 0) row.Children.Add(Shelf.Section("Latest Release", Latest(nav, albums[0])));
        row.Children.Add(new Border
        {
            [Grid.ColumnProperty] = albums.Count > 0 ? 1 : 0,
            Margin = new Thickness(albums.Count > 0 ? 32 : 0, 0, 0, 0),
            Child = Shelf.Section("Top Songs", SongGrid.Of(session, nav, songs, ctx)),
        });
        body.Children.Add(row);
        if (albums.Count > 0) body.Children.Add(Shelf.Of("Albums", albums.Select(a => Blocks.Square(session, nav, a, a.Year?.ToString())), 24));
        if (info.Bio is { } bio)
            body.Children.Add(Shelf.Section($"About {page.Name}", new TextBlock { Text = bio, FontSize = 14, Opacity = 0.85, TextWrapping = TextWrapping.Wrap, MaxWidth = 900, HorizontalAlignment = HorizontalAlignment.Left }));
        if (info.Similar.Count > 0) body.Children.Add(Shelf.Of("Similar Artists", info.Similar.Select(a => SongGrid.Artist(nav, a)), 24));
        column.Children.Add(body);
    }

    /// Apple's latest-release card: the cover beside the year, the title and the genre.
    static Control Latest(Nav nav, Album a)
    {
        var card = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(0),
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 14,
                Children =
                {
                    new CoverImage(a.Cover, 120, 300, 6),
                    new StackPanel
                    {
                        VerticalAlignment = VerticalAlignment.Center,
                        Width = 150,
                        Children = { Kit.Text(a.Year?.ToString(), 12, FontWeight.SemiBold, 0.6), Kit.Text(a.Title, 15, FontWeight.SemiBold), Kit.Text(a.Genre, 13, opacity: 0.6) },
                    },
                },
            },
        };
        card.Click += (_, _) => nav.Open(new Route("album", a.Id, a.Title));
        return card;
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
