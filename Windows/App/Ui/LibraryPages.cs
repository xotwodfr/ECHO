using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Ui;

// Your Library's pages (the web's LibraryViews.tsx): albums in four orders, artists, an artist, playlists,
// a playlist, Liked Songs, an album and a mix. Each loads once when it opens.

/// The albums, in the chosen order.
public sealed class AlbumsView : UserControl
{
    static AlbumSort sort = AlbumSort.Newest;
    readonly Session s;
    readonly StackPanel column = new();
    readonly TextBlock status = Page.Note();
    readonly ContentControl grid = new();

    public AlbumsView(Session session)
    {
        s = session;
        column.Children.Add(Page.Title("Your Library"));
        column.Children.Add(Page.LibraryTabs(s, new AlbumsPage()));
        var sorts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(8, 0, 0, 12) };
        foreach (var option in Enum.GetValues<AlbumSort>())
        {
            var b = new Button { Theme = Page.Bare, Content = option.Label(), Padding = new Thickness(12, 5), CornerRadius = new CornerRadius(14), FontSize = 12, Opacity = option == sort ? 1 : 0.6 };
            b.Click += (_, _) =>
            {
                sort = option;
                foreach (var x in sorts.Children) x.Opacity = x == b ? 1 : 0.6;
                _ = Page.Load(s, status, Load);
            };
            sorts.Children.Add(b);
        }
        column.Children.Add(sorts);
        column.Children.Add(status);
        column.Children.Add(grid);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, Load);
    }

    async Task Load() => grid.Content = Page.Cards((await s.Albums(sort)).Select(a => Page.AlbumCard(s, a)));
}

/// An album: its cover, its songs; a song plays the album from there on.
public sealed class AlbumView : UserControl
{
    readonly Session s;
    readonly StackPanel column = new();
    readonly TextBlock status = Page.Note();
    readonly TextBlock artist;

    public AlbumView(Session session, Album album)
    {
        s = session;
        artist = new TextBlock { Text = album.Artist, FontSize = 14, Foreground = (IBrush)Application.Current!.FindResource("Muted")! };
        column.Children.Add(new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("Auto,*"), Margin = new Thickness(8, 0, 0, 20),
            Children =
            {
                new Border
                {
                    Width = 240, Height = 240, CornerRadius = new CornerRadius(8), ClipToBounds = true,
                    Child = new CoverImage { Url = album.Cover, Pixels = 480, Fallback = album.Title },
                },
                new StackPanel
                {
                    [Grid.ColumnProperty] = 1, Margin = new Thickness(28, 0, 0, 0), VerticalAlignment = VerticalAlignment.Bottom, Spacing = 6,
                    Children =
                    {
                        new TextBlock { Text = "ALBUM", FontSize = 11, LetterSpacing = 1.3, Opacity = 0.6 },
                        new TextBlock { Text = album.Title, FontSize = 56, FontWeight = FontWeight.ExtraBold, LetterSpacing = -1.1, TextWrapping = TextWrapping.Wrap },
                        artist,
                    },
                },
            },
        });
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, () => Load(album));
    }

    async Task Load(Album album)
    {
        if (await s.Album(album) is not { } full)
        {
            status.Text = "This album isn't in your library any more.";
            status.IsVisible = true;
            return;
        }
        artist.Text = full.Artist;
        var context = new PlayContext("album", full.Id, full.Title);
        column.Children.Add(Page.Primary("Play", () => _ = s.Player.PlayList(full.Tracks, 0, context)));
        column.Children.Add(new TrackList(s, full.Tracks, context, covers: false));
    }
}

public sealed class ArtistsView : UserControl
{
    public ArtistsView(Session s)
    {
        var column = new StackPanel();
        var status = Page.Note();
        column.Children.Add(Page.Title("Your Library"));
        column.Children.Add(Page.LibraryTabs(s, new ArtistsPage()));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, async () =>
            column.Children.Add(Page.Cards((await s.Library.Artists()).Select(a => new Card(a.Name, null, a.Image, () => s.Nav.Go(new ArtistPage(a.Id, a.Name)), Round: true)))));
    }
}

/// An artist: Popular (their top songs), then their albums.
public sealed class ArtistView : UserControl
{
    public ArtistView(Session s, string id, string name)
    {
        var column = new StackPanel();
        var status = Page.Note();
        column.Children.Add(Page.Title(name));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, async () =>
        {
            var top = await s.Library.TopSongs(name, 10);
            if (top.Count > 0)
            {
                column.Children.Add(Page.Heading("Popular"));
                column.Children.Add(new TrackList(s, top, new PlayContext("artist", id, name)));
            }
            if (await s.Library.Artist(id) is { Albums.Count: > 0 } page)
            {
                column.Children.Add(Page.Heading("Albums"));
                column.Children.Add(Page.Cards(page.Albums.Select(a => Page.AlbumCard(s, a))));
            }
        });
    }
}

public sealed class PlaylistsView : UserControl
{
    public PlaylistsView(Session s)
    {
        var column = new StackPanel();
        var status = Page.Note();
        column.Children.Add(Page.Title("Your Library"));
        column.Children.Add(Page.LibraryTabs(s, new PlaylistsPage()));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, async () =>
            column.Children.Add(Page.Cards((await s.Playlists()).Select(p => new Card(p.Name, $"{p.Tracks} songs", p.Cover, () => s.Nav.Go(new PlaylistPage(p.Id, p.Name)))))));
    }
}

public sealed class PlaylistView : UserControl
{
    public PlaylistView(Session s, string id, string name)
    {
        var column = new StackPanel();
        var status = Page.Note();
        column.Children.Add(Page.Title(name));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, async () =>
        {
            if (await s.Library.Playlist(id) is not { } p) return;
            if (p.Comment is { } comment) column.Children.Add(Page.Note(comment));
            column.Children.Add(Page.Note($"{p.Entries.Count} songs, {p.DurationMs / 60_000} min"));
            var context = new PlayContext("playlist", id, p.Playlist.Name);
            column.Children.Add(Page.Primary("Play", () => _ = s.Player.PlayList(p.Entries, 0, context)));
            column.Children.Add(new TrackList(s, p.Entries, context));
        });
    }
}

public sealed class StarredView : UserControl
{
    public StarredView(Session s)
    {
        var column = new StackPanel();
        var status = Page.Note();
        column.Children.Add(Page.Title("Your Library"));
        column.Children.Add(Page.LibraryTabs(s, new StarredPage()));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, async () =>
        {
            var liked = (await s.Library.Starred()).Tracks;
            var context = new PlayContext("liked", null, "Liked Songs");
            if (liked.Count == 0) column.Children.Add(Page.Note("Songs you like show here."));
            else
            {
                column.Children.Add(Page.Primary("Play", () => _ = s.Player.PlayList(liked, 0, context)));
                column.Children.Add(new TrackList(s, liked, context));
            }
        });
    }
}

public sealed class MixView : UserControl
{
    public MixView(Session s, Mix mix)
    {
        var tracks = mix.Tracks.Select(t => t.ToTrack()).ToList();
        var context = new PlayContext("mix", mix.Id, mix.Title);
        var column = new StackPanel();
        column.Children.Add(Page.Title(mix.Title));
        column.Children.Add(Page.Note(mix.Subtitle));
        column.Children.Add(Page.Primary("Play", () => _ = s.Player.PlayList(tracks, 0, context)));
        column.Children.Add(new TrackList(s, tracks, context));
        Content = Page.Scroll(column);
    }
}
