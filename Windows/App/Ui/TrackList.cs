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

/// How a list of songs is laid out: an album's (number, title, time), a playlist's or the library's table
/// (artwork, title, artist, album, time, under a header), or compact (artwork, title over the artist and
/// album, for grids of top songs).
public enum Rows { Album, Table, Compact }

/// Song rows, Cider's (mediaitem-list-item: select, double-click plays, right-click menu) drawn the way
/// Apple Music draws its song tables: rows 44 px (52 with artwork), every other one faintly lit, radius 6;
/// the number in grey turns into a play button under the pointer and into Cider's playing bars (the title
/// in the key colour) for the song that plays; the time in grey; "…" at the end on hover.
public sealed class TrackList : ListBox
{
    public sealed record Row(Track Track, int Number, Rows Kind);

    readonly Session session;
    readonly IReadOnlyList<Track> tracks;
    readonly PlayContext context;

    public TrackList(Session session, Nav nav, IReadOnlyList<Track> tracks, PlayContext context, Rows kind, bool virtualize = false)
    {
        this.session = session;
        this.tracks = tracks;
        this.context = context;
        Kind = kind;
        Theme = Kit.Res<ControlTheme>("PlainList");
        ItemContainerTheme = Kit.Res<ControlTheme>("TrackRow");
        SelectionMode = SelectionMode.Single;
        if (!virtualize)
        {
            ItemsPanel = new FuncTemplate<Panel?>(() => new StackPanel());
            ScrollViewer.SetVerticalScrollBarVisibility(this, Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled);
        }
        ItemTemplate = new FuncDataTemplate<Row>((row, _) => row is null ? null : RowView(row, nav));
        ItemsSource = tracks.Select((t, i) => new Row(t, i + 1, kind)).ToList();
        var born = DateTime.UtcNow;
        ContainerPrepared += (_, e) =>
        {
            e.Container.Classes.Set("odd", kind != Rows.Compact && e.Index % 2 == 1);
            // The rows come in one after another when the list first shows, not while it scrolls.
            if ((DateTime.UtcNow - born).TotalMilliseconds < 700) Motion.Cascade(e.Container, e.Index, 6);
        };
        DoubleTapped += (_, e) =>
        {
            if (SelectedItem is Row row) _ = session.Player.PlayList(tracks, row.Number - 1, context);
        };
        System.ComponentModel.PropertyChangedEventHandler follow = (_, e) =>
        {
            if (e.PropertyName is nameof(Player.Track) or nameof(Player.Playing)) ShowPlaying();
        };
        this.WhileShown(() => session.Player.PropertyChanged += follow, () => session.Player.PropertyChanged -= follow);
    }

    public Rows Kind { get; }

    /// Plays the list from `index` (the page's Play, Shuffle).
    public Task Play(int index = 0) => session.Player.PlayList(tracks, index, context);

    void ShowPlaying()
    {
        foreach (var bars in this.GetVisualDescendants().OfType<PlayingBars>()) bars.Refresh();
    }

    static string Columns(Rows kind) => kind switch
    {
        Rows.Album => "36,*,60,36",
        Rows.Table => "36,52,3*,2*,2*,60,36",
        _ => "52,*,36",
    };

    /// The table's header (Apple's "Song  Artist  Album  Time"), aligned with its rows.
    public static Control Header(Rows kind)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions(Columns(kind)), Height = 28, Margin = new Thickness(0, 0, 0, 4) };
        void Add(string text, int column, bool right = false)
        {
            var t = Kit.Text(text, 12, FontWeight.SemiBold, 0.5);
            if (right) t.HorizontalAlignment = HorizontalAlignment.Center;
            grid.Children.Add(new Border { [Grid.ColumnProperty] = column, Child = t });
        }
        if (kind == Rows.Table)
        {
            Add("Song", 2);
            Add("Artist", 3);
            Add("Album", 4);
            Add("Time", 5, right: true);
        }
        return new Border { BorderBrush = Kit.Brush("ChromeLine"), BorderThickness = new Thickness(0, 0, 0, 1), Child = grid };
    }

    Control RowView(Row row, Nav nav)
    {
        var t = row.Track;
        var kind = row.Kind;
        var grid = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions(Columns(kind)),
            Background = Brushes.Transparent,
            Height = kind == Rows.Album ? 44 : kind == Rows.Table ? 52 : 56,
        };
        var title = Kit.Text(t.Title, 14);
        var more = Kit.IconButton(Icons.More, 30, 30, 18, "More", () => { }, 1);
        more.Foreground = Kit.Brush("Key");
        more.Opacity = 0;
        more.ContextMenu = Menu(t, nav);
        more.Click += (_, _) => more.ContextMenu.Open(more);
        grid.ContextMenu = more.ContextMenu;

        // The number column: grey number, the play button under the pointer, the bars when it plays.
        PlayingBars? bars = null;
        if (kind != Rows.Compact)
        {
            var number = Kit.Text(row.Number.ToString(), 14, opacity: 0.5);
            number.HorizontalAlignment = HorizontalAlignment.Center;
            var play = new Glyph(Icons.PlaySmall, 11) { IsVisible = false, Cursor = new Cursor(StandardCursorType.Hand) };
            bars = new PlayingBars(session.Player, t.Id) { HorizontalAlignment = HorizontalAlignment.Center };
            bars.Shown += shown =>
            {
                number.IsVisible = !shown && !play.IsVisible;
                title.Foreground = shown ? Kit.Brush("Key") : Kit.Brush("Text");
            };
            play.PointerPressed += (_, e) =>
            {
                _ = session.Player.PlayList(tracks, row.Number - 1, context);
                e.Handled = true;
            };
            grid.PointerEntered += (_, _) =>
            {
                play.IsVisible = true;
                number.IsVisible = false;
                bars.Opacity = 0;
                more.Opacity = 1;
            };
            grid.PointerExited += (_, _) =>
            {
                play.IsVisible = false;
                bars.Opacity = 1;
                bars.Refresh();
                more.Opacity = 0;
            };
            grid.Children.Add(new Panel { Children = { number, play, bars } });
        }
        else
        {
            grid.PointerEntered += (_, _) => more.Opacity = 1;
            grid.PointerExited += (_, _) => more.Opacity = 0;
        }

        var column = kind == Rows.Compact ? 0 : 1;
        if (kind != Rows.Album)
        {
            var art = new CoverImage(t.Cover, 40, 96, 4) { Margin = new Thickness(6, 0) };
            grid.Children.Add(new Border { [Grid.ColumnProperty] = column++, Child = art });
        }
        Control Link(string? text, Route? to)
        {
            var link = Kit.Text(text, 14, opacity: 0.6);
            link.Margin = new Thickness(0, 0, 12, 0);
            if (to is not null)
            {
                link.Cursor = new Cursor(StandardCursorType.Hand);
                link.PointerPressed += (_, e) =>
                {
                    nav.Open(to);
                    e.Handled = true;
                };
            }
            return link;
        }
        var artist = t.Artists.FirstOrDefault()?.Id is { } aid ? new Route("artist", aid, t.Artist) : null;
        var album = t.Album.Id is { } alid ? new Route("album", alid, t.Album.Title) : null;
        title.Margin = new Thickness(kind == Rows.Album ? 4 : 6, 0, 12, 0);
        if (kind == Rows.Compact)
        {
            grid.Children.Add(new StackPanel
            {
                [Grid.ColumnProperty] = column++,
                VerticalAlignment = VerticalAlignment.Center,
                Children = { title, Kit.Text($"{t.Artist} · {t.Album.Title}", 12, opacity: 0.6) },
            });
        }
        else
        {
            grid.Children.Add(new Border { [Grid.ColumnProperty] = column++, Child = title });
            if (kind == Rows.Table)
            {
                grid.Children.Add(new Border { [Grid.ColumnProperty] = column++, Child = Link(t.Artist, artist) });
                grid.Children.Add(new Border { [Grid.ColumnProperty] = column++, Child = Link(t.Album.Title, album) });
            }
            var duration = Kit.Text(Kit.Time(t.DurationMs), 14, opacity: 0.6);
            duration.HorizontalAlignment = HorizontalAlignment.Center;
            grid.Children.Add(new Border { [Grid.ColumnProperty] = column++, Child = duration });
        }
        more.HorizontalAlignment = HorizontalAlignment.Center;
        more.VerticalAlignment = VerticalAlignment.Center;
        grid.Children.Add(new Border { [Grid.ColumnProperty] = column, Child = more });
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
            LoveMenu.Item(session, StarKind.Track, t.Id),
        };
        if (t.Album.Id is { } album) items.Add(Item("Go to Album", () => nav.Open(new Route("album", album, t.Album.Title))));
        if (t.Artists.FirstOrDefault()?.Id is { } artist) items.Add(Item("Go to Artist", () => nav.Open(new Route("artist", artist, t.Artist))));
        return new ContextMenu { ItemsSource = items };
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
