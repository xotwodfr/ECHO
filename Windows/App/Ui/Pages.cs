using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Echo.Ui;

/// Cider's pages by route (views/pages/*.ejs). Each page loads what it shows when it opens.
public static class Pages
{
    public static Control Create(Session session, Nav nav, Route r) => r.Page switch
    {
        "home" => new HomePage(session, nav),
        "library-recentlyadded" => new RecentlyAddedPage(session, nav),
        "library-songs" => new SongsPage(session, nav),
        "library-albums" => new AlbumsPage(session, nav),
        "library-artists" => new ArtistsPage(session, nav),
        "album" or "playlist" or "mix" => new CollectionPage(session, nav, r),
        "artist" => new ArtistPage(session, nav, r),
        "search" => new SearchPage(session, nav, r.Id ?? ""),
        _ => Stub(r.Title ?? r.Page),
    };

    static Control Stub(string title) => new TextBlock
    {
        Text = title,
        FontSize = 28,
        FontWeight = FontWeight.Bold,
        Margin = new Thickness(32, 24),
    };
}
