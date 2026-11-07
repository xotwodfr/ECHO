using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// views/pages/home.ejs: Recently Played beside Your Favorites (two wells of six rows, 392 px), then Made
/// For You in a row of squares. ECHO's history, favourites and mixes stand where Cider asked Apple Music;
/// the Artists Feed, Replay and Friends Listening To are Apple Music's and left out.
public sealed class HomePage : ScrollViewer
{
    readonly Session session;
    readonly Nav nav;
    readonly StackPanel column;

    public HomePage(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        column = Blocks.Column(new Thickness(32));
        Content = column;
        _ = Load();
    }

    async Task Load()
    {
        IReadOnlyList<PlayedContext> played;
        Starred starred;
        IReadOnlyList<Mix> mixes;
        try
        {
            var p = session.Library.PlayedContexts();
            var s = session.Library.Starred();
            var m = session.Library.Mixes();
            (played, starred, mixes) = (await p, await s, await m);
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            column.Children.Add(Blocks.Message(await Blocks.Failed(session, e)));
            return;
        }

        var recent = new StackPanel();
        foreach (var c in played.Take(6)) recent.Children.Add(ContextRow(c));
        if (played.Count == 0) recent.Children.Add(Blocks.Message("What you play shows up here."));
        var favorites = new TrackList(session, nav, starred.Tracks.Take(6).ToList(), new PlayContext("favorites", null, "Your Favorites"), Rows.Compact);
        var columns = new Grid { ColumnDefinitions = new ColumnDefinitions("*,32,*") };
        columns.Children.Add(Section("Recently Played", recent, null));
        columns.Children.Add(new Border
        {
            [Grid.ColumnProperty] = 2,
            Child = Section("Your Favorites", starred.Tracks.Count == 0 ? Blocks.Message("Songs you love show up here.") : favorites, null),
        });
        column.Children.Add(columns);

        if (mixes.Count == 0) return;
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var mix in mixes) row.Children.Add(MixSquare(mix));
        column.Children.Add(new Border
        {
            Margin = new Thickness(0, 32, 0, 0),
            Child = Blocks.Column(default, Blocks.H3("Made For You"), Blocks.Well(new ScrollViewer
            {
                HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
                Content = row,
            })),
        });
    }

    static Control Section(string title, Control rows, Action? seeAll)
    {
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Height = 40 };
        head.Children.Add(Blocks.H3(title));
        if (seeAll is not null) head.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = Blocks.SeeAll("See All", seeAll) });
        var well = Blocks.Well(rows);
        well.Height = 392;
        well.Margin = default;
        return new StackPanel { Children = { head, well } };
    }

    /// A Recently Played row: Cider's list item for an album, playlist, artist or mix.
    Control ContextRow(PlayedContext c)
    {
        var kind = c.Kind switch { "album" => "Album", "playlist" => "Playlist", "artist" => "Artist", _ => "Mix" };
        var route = new Route(c.Kind, c.Id, c.Title);
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            CornerRadius = new CornerRadius(8),
            Height = 60,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Children =
                {
                    new CoverImage(c.Cover, 42, 96, c.Kind == "artist" ? 21 : 6) { Margin = new Thickness(12) },
                    new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { Kit.Text(c.Title ?? kind, 14), Kit.Text(kind, 11.2, opacity: 0.7) } },
                },
            },
        };
        b.Click += (_, _) => nav.Open(route);
        return b;
    }

    /// `mediaitem-scroller-horizontal`'s square: 160×200, the 140 px artwork 6 px in.
    Control MixSquare(Mix mix)
    {
        var art = new CoverImage(mix.Tracks.FirstOrDefault()?.Cover, 140, 300) { Margin = new Thickness(6), Cursor = new Cursor(StandardCursorType.Hand) };
        art.PointerPressed += (_, _) => nav.Open(new Route("mix", mix.Id, mix.Title));
        var title = Kit.Text(mix.Title, 14);
        var sub = Kit.Text(mix.Subtitle, 12);
        title.HorizontalAlignment = sub.HorizontalAlignment = HorizontalAlignment.Center;
        title.MaxWidth = sub.MaxWidth = 150;
        return new StackPanel { Width = 160, Height = 200, Children = { art, title, sub } };
    }
}
