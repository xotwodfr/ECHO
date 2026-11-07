using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Ui;

/// Home, Cider's page (home.ejs) laid out as Apple Music's: the title, then Top Picks for You (ECHO's
/// mixes as tall cards coloured by their covers), Recently Played (a shelf of covers that pages
/// sideways) and Your Favorites (starred songs in columns). Cider's Artists Feed, Replay and Friends
/// Listening To are Apple Music's and left out.
public sealed class HomePage : ScrollViewer
{
    readonly Session session;
    readonly Nav nav;
    readonly StackPanel column;

    public HomePage(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        column = Blocks.Column(new Thickness(32, 24, 32, 32), Blocks.H1("Home"));
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
        if (mixes.Count > 0) column.Children.Add(Shelf.Of("Top Picks for You", mixes.Select(Pick), 20));
        if (played.Count > 0) column.Children.Add(Shelf.Of("Recently Played", played.Select(Played), 24));
        if (starred.Tracks.Count > 0)
            column.Children.Add(Shelf.Section("Your Favorites", SongGrid.Of(session, nav, starred.Tracks.Take(12).ToList(), new PlayContext("favorites", null, "Your Favorites"))));
        if (column.Children.Count == 1) column.Children.Add(Blocks.Message("Play something: what you play and love shows up here."));
    }

    /// Apple's Top Picks card: the cover over a block of its own colour with the title and subtitle.
    Control Pick(Mix mix)
    {
        var cover = mix.Tracks.FirstOrDefault()?.Cover;
        var under = new Border
        {
            Height = 84,
            Padding = new Thickness(14, 12),
            Background = new SolidColorBrush(Color.FromArgb(255, 40, 40, 44)),
            Child = new StackPanel { Children = { Kit.Text(mix.Title, 15, FontWeight.SemiBold), Kit.Text(mix.Subtitle, 13, opacity: 0.8) } },
        };
        _ = Tint(cover, under);
        var card = new Border
        {
            Width = 220,
            CornerRadius = new CornerRadius(10),
            ClipToBounds = true,
            BoxShadow = BoxShadows.Parse("0 4 14 0 #40000000"),
            Cursor = new Cursor(StandardCursorType.Hand),
            Child = new StackPanel { Children = { new CoverImage(cover, 220, 600, 0), under } },
        };
        card.PointerPressed += (_, _) => nav.Open(new Route("mix", mix.Id, mix.Title));
        return card;
    }

    async Task Tint(string? cover, Border under)
    {
        if (await session.Covers.KeyColor(cover) is not { } key) return;
        // The key colour darkened to carry white text, as Apple's cards do.
        under.Background = new SolidColorBrush(Color.FromRgb((byte)(key.R * 0.45), (byte)(key.G * 0.45), (byte)(key.B * 0.45)));
    }

    Control Played(PlayedContext c)
    {
        var kind = c.Kind switch { "album" => "Album", "playlist" => "Playlist", "artist" => "Artist", _ => "Mix" };
        var route = new Route(c.Kind, c.Id, c.Title);
        var art = new CoverImage(c.Cover, 180, 300, c.Kind == "artist" ? 90 : 6);
        art.PointerPressed += (_, _) => nav.Open(route);
        return new Tile(art, [], Kit.Text(c.Title ?? kind, 13, FontWeight.Medium), Kit.Text(kind, 13, opacity: 0.6), 180);
    }
}

/// Apple Music's sections: a 20 px title (with arrows that page a shelf sideways), then the content.
public static class Shelf
{
    public static Control Section(string title, Control content) => new StackPanel
    {
        Margin = new Thickness(0, 28, 0, 0),
        Children = { Title(title), content },
    };

    static TextBlock Title(string text) => new() { Text = text, FontSize = 20, FontWeight = FontWeight.Bold, LetterSpacing = -0.3, Margin = new Thickness(0, 0, 0, 12), VerticalAlignment = VerticalAlignment.Center };

    /// A row of items that scrolls sideways, a viewport at a time with the header's arrows.
    public static Control Of(string title, IEnumerable<Control> items, double gap)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = gap };
        foreach (var i in items) row.Children.Add(i);
        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = row,
            Padding = new Thickness(0, 0, 0, 16), // room for the covers' shadows
        };
        void Page(int dir) => Motion.GlideX(scroll, Math.Clamp(scroll.Offset.X + dir * scroll.Viewport.Width * 0.9, 0, Math.Max(0, scroll.Extent.Width - scroll.Viewport.Width)));
        var back = Kit.IconButton(Icons.ChevronLeft, 28, 28, 12, "Back", () => Page(-1));
        var on = Kit.IconButton(Icons.ChevronRight, 28, 28, 12, "More", () => Page(1));
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(Title(title));
        head.Children.Add(new StackPanel { [Grid.ColumnProperty] = 1, Orientation = Orientation.Horizontal, Spacing = 4, Children = { back, on } });
        return new StackPanel { Margin = new Thickness(0, 28, 0, 0), Children = { head, scroll } };
    }
}
