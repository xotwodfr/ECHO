using Avalonia.Controls;

namespace Echo.Ui;

/// A song's menu, the web's words. Fluent's dark menu, not glass: a menu opens in its own popup
/// window, with nothing of ECHO's under it to bend.
static class Menus
{
    public static ContextMenu TrackMenu(Session s, Track t)
    {
        var items = new List<MenuItem>
        {
            Item("Play next", () => _ = s.Player.PlayNext(t)),
            Item("Add to queue", () => _ = s.Player.AddToQueue(t)),
        };
        if (t.Album.Id is { } albumId) items.Add(Item("Go to album", () => s.Nav.Go(new AlbumPage(new Album(albumId, t.Album.Title, t.Artist)))));
        if (t.Artists is [{ Id: { } artistId } first, ..]) items.Add(Item("Go to artist", () => s.Nav.Go(new ArtistPage(artistId, first.Name))));
        items.Add(Item("Like", () => _ = Liked(s, t)));
        return new ContextMenu { ItemsSource = items };
    }

    static MenuItem Item(string header, Action click)
    {
        var item = new MenuItem { Header = header };
        item.Click += (_, _) => click();
        return item;
    }

    static async Task Liked(Session s, Track t)
    {
        try
        {
            await s.Library.Star(StarKind.Track, t.Id, true);
            s.Player.Notice = "Added to Liked Songs";
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            s.Player.Notice = "Can't reach the server.";
        }
    }
}
