using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.VisualTree;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's `mediaitem-list-item` rows (views/components/mediaitem-list-item.ejs; elements.less
/// .cd-mediaitem-list-item): 60 px, radius 8; the number (or Cider's playing bars) in 40 px, the 42 px
/// artwork for lists of many albums, the title over "artist — album" at 0.8 em and 70 %, the duration in
/// 60 px. A click selects (--selected), a double click plays from there, a right click offers the rest.
public sealed class TrackList : ListBox
{
    public sealed record Row(Track Track, int Number, bool Artwork);

    readonly Session session;
    readonly IReadOnlyList<Track> tracks;
    readonly PlayContext context;

    public TrackList(Session session, Nav nav, IReadOnlyList<Track> tracks, PlayContext context, bool artwork, bool virtualize = false)
    {
        this.session = session;
        this.tracks = tracks;
        this.context = context;
        Theme = Kit.Res<ControlTheme>("PlainList");
        ItemContainerTheme = Kit.Res<ControlTheme>("TrackRow");
        SelectionMode = SelectionMode.Single;
        if (!virtualize)
        {
            ItemsPanel = new FuncTemplate<Panel?>(() => new StackPanel());
            ScrollViewer.SetVerticalScrollBarVisibility(this, Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled);
        }
        ItemTemplate = new FuncDataTemplate<Row>((row, _) => row is null ? null : RowView(row, nav));
        ItemsSource = tracks.Select((t, i) => new Row(t, i + 1, artwork)).ToList();
        DoubleTapped += (_, e) =>
        {
            if (SelectedIndex >= 0) _ = session.Player.PlayList(tracks, SelectedIndex, context);
        };
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(Player.Track) or nameof(Player.Playing)) ShowPlaying();
        };
    }

    /// Plays the list from `index` (the page's Play, Shuffle).
    public Task Play(int index = 0) => session.Player.PlayList(tracks, index, context);

    void ShowPlaying()
    {
        foreach (var bars in this.GetVisualDescendants().OfType<PlayingBars>()) bars.Refresh();
    }

    Control RowView(Row row, Nav nav)
    {
        var t = row.Track;
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions(row.Artwork ? "40,66,*,60" : "40,*,60"), Background = Brushes.Transparent };
        var number = Kit.Text(row.Number.ToString(), 14);
        number.HorizontalAlignment = HorizontalAlignment.Center;
        var bars = new PlayingBars(session.Player, t.Id) { HorizontalAlignment = HorizontalAlignment.Center };
        grid.Children.Add(new Panel { Margin = new Thickness(11, 0, 0, 0), Children = { number, bars } });
        bars.Shown += shown => number.IsVisible = !shown;

        var column = 1;
        if (row.Artwork)
        {
            var art = new CoverImage(t.Cover, 42, 96, 6) { Margin = new Thickness(12) };
            var overlay = new Border
            {
                Background = new SolidColorBrush(Color.Parse("#80000000")),
                CornerRadius = new CornerRadius(6),
                Margin = new Thickness(12),
                Opacity = 0,
                Child = new Glyph(Icons.PlayFeather, 14) { Foreground = Brushes.White },
            };
            grid.PointerEntered += (_, _) => overlay.Opacity = 1;
            grid.PointerExited += (_, _) => overlay.Opacity = 0;
            overlay.PointerPressed += (_, e) =>
            {
                _ = session.Player.PlayList(tracks, row.Number - 1, context);
                e.Handled = true;
            };
            grid.Children.Add(new Panel { [Grid.ColumnProperty] = column++, Children = { art, overlay } });
        }

        var subtitle = Kit.Text($"{t.Artist}{(t.Album.Title.Length > 0 ? " — " + t.Album.Title : "")}", 11.2, opacity: 0.7);
        grid.Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = column++,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(row.Artwork ? 0 : 16, 0, 0, 0),
            Children = { Kit.Text(t.Title, 14), subtitle },
        });
        var duration = Kit.Text(Kit.Time(t.DurationMs), 14);
        duration.HorizontalAlignment = HorizontalAlignment.Center;
        grid.Children.Add(new Border { [Grid.ColumnProperty] = column, Child = duration });
        grid.ContextMenu = Menu(t, nav);
        return grid;
    }

    ContextMenu Menu(Track t, Nav nav)
    {
        MenuItem Item(string header, Action act)
        {
            var m = new MenuItem { Header = header };
            m.Click += (_, _) => act();
            return m;
        }
        var items = new List<MenuItem>
        {
            Item("Play Next", () => _ = session.Player.PlayNext(t)),
            Item("Play Later", () => _ = session.Player.AddToQueue(t)),
            Item("Love", () => _ = Quietly(session.Library.Star(StarKind.Track, t.Id, true))),
        };
        if (t.Album.Id is { } album) items.Add(Item("Go to Album", () => nav.Open(new Route("album", album, t.Album.Title))));
        if (t.Artists.FirstOrDefault()?.Id is { } artist) items.Add(Item("Go to Artist", () => nav.Open(new Route("artist", artist, t.Artist))));
        return new ContextMenu { ItemsSource = items };
    }

    static async Task Quietly(Task call)
    {
        try
        {
            await call;
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { }
    }
}

/// Cider's `.loadbar-sound`: three key-coloured bars where the playing song's number was.
public sealed class PlayingBars : Control
{
    readonly Player player;
    readonly string id;

    public event Action<bool>? Shown;

    public PlayingBars(Player player, string id)
    {
        this.player = player;
        this.id = id;
        Width = 14;
        Height = 14;
        AttachedToVisualTree += (_, _) => Refresh();
    }

    public void Refresh()
    {
        var shown = player.Track?.Id == id;
        IsVisible = shown;
        Shown?.Invoke(shown);
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        var key = Kit.Brush("Key");
        double[] heights = player.Playing ? [0.6, 1, 0.4] : [0.35, 0.35, 0.35];
        for (var i = 0; i < 3; i++)
            context.FillRectangle(key, new Rect(i * 4.5 + 1.5, Height * (1 - heights[i]), 3, Height * heights[i]));
    }
}
