using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// Cider's collection page for an album, a playlist or one of ECHO's mixes (views/pages/cider-playlist.ejs; pages.less
/// .playlist-page): a 300 px header over the cover's artwork material — the 260 px artwork, the name
/// (1.6 rem, 700), the artist (20 px), the description, Play and Shuffle, a search field and "…" — then
/// the songs on --color3, 40 px in, and the date and total time under them. Scrolling the songs shrinks
/// the header to 200 px and the artwork to 128 px, as Cider's `plmin`. (Add to Library is Apple Music's.)
public sealed class CollectionPage : DockPanel
{
    readonly Session session;
    readonly Nav nav;
    readonly Route route;

    public CollectionPage(Session session, Nav nav, Route route)
    {
        this.session = session;
        this.nav = nav;
        this.route = route;
        _ = Load();
    }

    /// The list on show, once loaded (tests read it).
    public TrackList? List { get; private set; }

    async Task Load()
    {
        try
        {
            if (route.Page == "album")
            {
                if (await session.Library.Album(route.Id!) is not { } a) Say("This album is not in your library any more.");
                else Show(a.Title, a.Artist, a.ArtistId is null ? null : new Route("artist", a.ArtistId, a.Artist), null,
                    a.Tracks.FirstOrDefault()?.Cover ?? a.Cover, a.Tracks, new PlayContext("album", a.Id, a.Title), artwork: false,
                    a.Year is { } y ? y.ToString() : null, string.Join(" · ", new[] { a.Genre, a.Year?.ToString() }.OfType<string>()));
            }
            else if (route.Page == "mix")
            {
                if ((await session.Library.Mixes()).FirstOrDefault(m => m.Id == route.Id) is not { } m) Say("This mix has changed since.");
                else
                {
                    var songs = m.Tracks.Select(t => t.ToTrack()).ToList();
                    Show(m.Title, m.Subtitle, null, null, songs.FirstOrDefault()?.Cover, songs, new PlayContext("mix", m.Id, m.Title), artwork: true, null, null);
                }
            }
            else if (await session.Library.Playlist(route.Id!) is not { } p) Say("This playlist is gone.");
            else Show(p.Playlist.Name, p.Playlist.Owner ?? "", null, p.Comment, p.Entries.FirstOrDefault()?.Cover ?? p.Playlist.Cover,
                p.Entries, new PlayContext("playlist", p.Playlist.Id, p.Playlist.Name), artwork: true, null, null);
        }
        catch (ApiException e) when (e.SignedOut)
        {
            session.Player.Notice = "You were signed out.";
            await session.Player.SignOut();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            Say("Can't reach the server.");
        }
    }

    void Say(string text) => Children.Add(new TextBlock { Text = text, Margin = new Thickness(40, 32), Opacity = 0.7, FontSize = 14 });

    void Show(string name, string artistName, Route? artist, string? description, string? cover, IReadOnlyList<Track> tracks,
        PlayContext context, bool artwork, string? date, string? meta)
    {
        var list = List = new TrackList(session, nav, tracks, context, artwork ? Rows.Table : Rows.Album);

        // ---- the header (.playlist-display) ----
        var art = new CoverImage(cover, 260, 600) { VerticalAlignment = VerticalAlignment.Center };
        var artBox = new Border
        {
            CornerRadius = new CornerRadius(8),
            BoxShadow = BoxShadows.Parse("0 8 40 0 #8C000000"),
            VerticalAlignment = VerticalAlignment.Center,
            Child = art,
        };
        // Apple Music's header: the name large, the artist in the page's colour, then a small capitals line.
        var count = tracks.Count;
        var minutes = (int)Math.Round(tracks.Sum(t => t.DurationMs) / 60_000.0);
        meta ??= $"{count} {(count == 1 ? "song" : "songs")} · {Duration(minutes)}";
        var title = new TextBlock { Text = name, FontSize = 30, FontWeight = FontWeight.Bold, LetterSpacing = -0.6, Margin = new Thickness(0, 0, 6, 2), TextTrimming = TextTrimming.CharacterEllipsis };
        var by = new TextBlock { Text = artistName, FontSize = 22, FontWeight = FontWeight.Medium, Foreground = Kit.Brush("Key"), Margin = new Thickness(0, 0, 6, 6), TextTrimming = TextTrimming.CharacterEllipsis };
        var caps = new TextBlock { Text = meta.ToUpperInvariant(), FontSize = 12, FontWeight = FontWeight.SemiBold, Opacity = 0.6, Margin = new Thickness(0, 0, 0, 8), IsVisible = meta.Length > 0 };
        if (artist is not null)
        {
            by.Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Hand);
            by.PointerPressed += (_, _) => nav.Open(artist);
        }
        var desc = new TextBlock { Text = description, FontSize = 14, IsVisible = description is not null, MaxHeight = 40, TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.Wrap };
        var play = Kit.CiderButton("Play", Icons.PlaySmall, () =>
        {
            session.Player.SetShuffle(false);
            _ = list.Play();
        }, primary: true);
        var shuffle = Kit.CiderButton("Shuffle", Icons.Shuffle, () =>
        {
            session.Player.SetShuffle(true);
            _ = list.Play(Random.Shared.Next(Math.Max(1, tracks.Count)));
        }, primary: true);
        play.MinWidth = shuffle.MinWidth = 100;
        var info = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(24, 0, 0, 0),
            Children = { title, by, caps, desc, new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 6, 0, 0), Children = { play, shuffle } } },
        };

        var search = new TextBox { Classes = { "search" }, Width = 225, PlaceholderText = "Search..." };
        var more = new Button
        {
            Theme = Kit.Res<ControlTheme>("RoundMore"),
            Content = new Glyph(Icons.More, 20),
            Margin = new Thickness(8, 0, 0, 0),
        };
        more.Click += (_, _) => more.ContextMenu?.Open(more);
        more.ContextMenu = Menu(tracks, artist);
        var tools = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Bottom,
            Children =
            {
                new Panel
                {
                    VerticalAlignment = VerticalAlignment.Center,
                    Children = { search, new Glyph(Icons.Search, 12) { Margin = new Thickness(10, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, Opacity = 0.55, IsHitTestVisible = false } },
                },
                more,
            },
        };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), Margin = new Thickness(16) };
        row.Children.Add(artBox);
        row.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = info });
        row.Children.Add(new Border { [Grid.ColumnProperty] = 2, Child = tools });
        var header = new Border
        {
            MinHeight = 300,
            BoxShadow = BoxShadows.Parse("0 4 6 3 #1A000000"),
            Child = new Panel { Children = { new ArtworkMaterial { Url = cover }, row } },
        };
        SetDock(header, Dock.Top);
        Children.Add(header);
        _ = Tint(cover, header, play, shuffle, by);

        // ---- the songs (.playlist-body: var(--color3), 16 px / 40 px in) and the footer ----
        // Apple's footer: the year, then the count and length, small and grey.
        var footer = new StackPanel { Margin = new Thickness(4, 16, 0, 0), Spacing = 2 };
        if (date is not null) footer.Children.Add(Kit.Text(date, 13, opacity: 0.55));
        footer.Children.Add(Kit.Text($"{count} {(count == 1 ? "Song" : "Songs")}, {Duration(minutes)}", 13, opacity: 0.55));
        var body = new StackPanel { Margin = new Thickness(40, 16) };
        if (artwork) body.Children.Add(TrackList.Header(Rows.Table));
        body.Children.Add(list);
        body.Children.Add(footer);
        var scroll = new ScrollViewer { Content = body };
        scroll.ScrollChanged += (_, _) =>
        {
            var compact = scroll.Offset.Y > 0;
            art.Width = art.Height = compact ? 128 : 260;
            header.MinHeight = compact ? 200 : 300;
            desc.IsVisible = !compact && description is not null;
        };
        Children.Add(new Border { Background = new SolidColorBrush(Color.Parse("#33000000")), Child = scroll });

        search.TextChanged += (_, _) =>
        {
            var q = search.Text?.Trim() ?? "";
            var shown = q.Length == 0 ? tracks : tracks.Where(t => t.Title.Contains(q, StringComparison.OrdinalIgnoreCase) || t.Artist.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
            list = List = new TrackList(session, nav, shown, context, artwork ? Rows.Table : Rows.Album);
            body.Children[artwork ? 1 : 0] = list;
        };
    }

    /// Cider 4 colours an album's page with its cover: the header glows with the key colour and Play and
    /// Shuffle wear it (as md-btn-primary wears Cider's red, at 65 %).
    async Task Tint(string? cover, Border header, Button play, Button shuffle, TextBlock by)
    {
        if (await session.Covers.KeyColor(cover) is not { } key) return;
        by.Foreground = new SolidColorBrush(key);
        header.Background = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
            GradientStops = { new GradientStop(Color.FromArgb(90, key.R, key.G, key.B), 0), new GradientStop(Color.FromArgb(0, key.R, key.G, key.B), 1) },
        };
        foreach (var b in new[] { play, shuffle })
        {
            b.Background = new SolidColorBrush(Color.FromArgb(166, key.R, key.G, key.B));
            b.BorderBrush = new SolidColorBrush(Color.FromArgb(64, key.R, key.G, key.B));
        }
    }

    static string Duration(int minutes) => minutes >= 60
        ? $"{minutes / 60} {(minutes / 60 == 1 ? "hour" : "hours")}, {minutes % 60} {(minutes % 60 == 1 ? "minute" : "minutes")}"
        : $"{minutes} {(minutes == 1 ? "minute" : "minutes")}";

    ContextMenu Menu(IReadOnlyList<Track> tracks, Route? artist)
    {
        MenuItem Item(string header, Action act)
        {
            var m = new MenuItem { Header = header };
            m.Click += (_, _) => act();
            return m;
        }
        var items = new List<MenuItem>
        {
            Item("Play Next", () =>
            {
                foreach (var t in tracks.Reverse()) _ = session.Player.PlayNext(t);
            }),
            Item("Play Later", () =>
            {
                foreach (var t in tracks) _ = session.Player.AddToQueue(t);
            }),
        };
        if (route.Page == "album") items.Add(Item("Love", () => _ = session.Library.Star(StarKind.Album, route.Id!, true)));
        if (artist is not null) items.Add(Item("Go to Artist", () => nav.Open(artist)));
        return new ContextMenu { ItemsSource = items };
    }
}
