using Avalonia.Controls;

namespace Echo.Ui;

/// Home, as the web's (HomeView.tsx) without YouTube Music: the greeting, Made For You, Jump back in,
/// the library's shelves and your playlists.
public sealed class HomeView : UserControl
{
    readonly Session s;
    readonly StackPanel column = new();
    readonly TextBlock status = Page.Note();

    public HomeView(Session session)
    {
        s = session;
        column.Children.Add(Page.Title(Greeting(DateTime.Now.Hour)));
        column.Children.Add(status);
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, Load);
    }

    public static string Greeting(int hour) =>
        hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    async Task Load()
    {
        var mixes = await s.Mixes();
        if (mixes.Count > 0)
        {
            column.Children.Add(Page.Heading("Made For You"));
            column.Children.Add(Page.Cards(mixes.Select(m => new Card(m.Title, m.Subtitle, m.Tracks.FirstOrDefault()?.Cover,
                () => s.Nav.Go(new MixPage(m)))), max: 12));
        }
        var contexts = await s.PlayedContexts();
        if (contexts.Count > 0)
        {
            column.Children.Add(Page.Heading("Jump back in"));
            column.Children.Add(Page.Cards(contexts.Select(c => new Card(c.Title ?? "", Kind(c.Kind), c.Cover, () => Open(c, mixes))), max: 12));
        }
        foreach (var (kind, title) in new[]
                 {
                     (AlbumList.Recent, "Recently played"), (AlbumList.Newest, "New in your library"),
                     (AlbumList.Frequent, "Your most played"), (AlbumList.Random, "Something different"),
                 })
        {
            var albums = await s.Shelf(kind);
            if (albums.Count == 0) continue;
            column.Children.Add(Page.Heading(title));
            column.Children.Add(Page.Cards(albums.Select(a => Page.AlbumCard(s, a)), max: 12));
        }
        var playlists = await s.Playlists();
        if (playlists.Count > 0)
        {
            column.Children.Add(Page.Heading("Your playlists"));
            column.Children.Add(Page.Cards(playlists.Select(p => new Card(p.Name, $"{p.Tracks} songs", p.Cover, () => s.Nav.Go(new PlaylistPage(p.Id, p.Name)))), max: 12));
        }
    }

    static string Kind(string kind) => kind switch { "album" => "Album", "playlist" => "Playlist", "artist" => "Artist", "mix" => "Mix", _ => "" };

    void Open(PlayedContext c, IReadOnlyList<Mix> mixes)
    {
        switch (c.Kind)
        {
            case "album": s.Nav.Go(new AlbumPage(new Album(c.Id, c.Title ?? "", "", Cover: c.Cover))); break;
            case "playlist": s.Nav.Go(new PlaylistPage(c.Id, c.Title ?? "")); break;
            case "artist": s.Nav.Go(new ArtistPage(c.Id, c.Title ?? "")); break;
            case "mix" when mixes.FirstOrDefault(m => m.Id == c.Id) is { } mix: s.Nav.Go(new MixPage(mix)); break;
        }
    }
}
