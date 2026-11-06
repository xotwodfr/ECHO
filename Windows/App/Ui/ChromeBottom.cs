using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's bottom chrome in the Mojave layout (views/app/chrome-bottom.ejs; less/directives.less): 90 px of
/// --color2. Left, the artwork (70 px) with the song, artist and album, and the "…" menu; in the middle
/// the time, the progress bar and the duration over the Transport; right, the BarTools.
public sealed class ChromeBottom : Grid
{
    public const double Height2 = 90;

    readonly Player player;
    readonly CoverImage art = new(null, 70, 300, 4) { Margin = new Thickness(10, 0) };
    readonly TextBlock title = Kit.Text(null, 12.8, FontWeight.Medium);
    readonly TextBlock artist = Kit.Text(null, 12, opacity: 0.8);
    readonly TextBlock album = Kit.Text(null, 12, opacity: 0.8);
    readonly TextBlock elapsed = Kit.Text(null, 12.8), total = Kit.Text(null, 12.8);
    readonly SeekBar progress;

    /// The "…" menu or a right click on the song.
    public event Action<Control>? MenuRequested;
    /// The artwork: Cider's popover offers the mini player and the fullscreen view.
    public event Action<Control>? ArtworkClicked;

    public ChromeBottom(Session session, Nav nav)
    {
        player = session.Player;
        progress = new SeekBar(player);
        Height = Height2;
        Background = Kit.Brush("Panel");
        ColumnDefinitions = new ColumnDefinitions("3*,4*,3*");

        // ---- left: .playback-controls ----
        art.Cursor = new Cursor(StandardCursorType.Hand);
        art.PointerPressed += (_, e) =>
        {
            if (e.GetCurrentPoint(art).Properties.IsLeftButtonPressed) ArtworkClicked?.Invoke(art);
        };
        artist.Cursor = album.Cursor = new Cursor(StandardCursorType.Hand);
        artist.PointerPressed += (_, _) =>
        {
            if (player.Track?.Artists.FirstOrDefault()?.Id is { } id) nav.Open(new Route("artist", id, player.Track.Artist));
        };
        album.PointerPressed += (_, _) =>
        {
            if (player.Track?.Album.Id is { } id) nav.Open(new Route("album", id, player.Track.Album.Title));
        };
        var more = Kit.IconButton(Icons.More, 32, 32, 22, "More", () => MenuRequested?.Invoke(this));
        more.VerticalAlignment = VerticalAlignment.Center;
        var info = new StackPanel { Margin = new Thickness(8), VerticalAlignment = VerticalAlignment.Center, Spacing = 1, Children = { title, artist, album } };
        var left = new DockPanel
        {
            Children = { art, new Border { Child = more, [DockPanel.DockProperty] = Dock.Right, Margin = new Thickness(0, 0, 8, 0) }, info },
        };
        DockPanel.SetDock(art, Dock.Left);
        left.ContextRequested += (_, e) =>
        {
            MenuRequested?.Invoke(this);
            e.Handled = true;
        };
        Children.Add(left);

        // ---- middle: the duration row over the controls ----
        elapsed.Width = total.Width = 64;
        elapsed.TextAlignment = total.TextAlignment = TextAlignment.Center;
        var duration = new DockPanel
        {
            Children =
            {
                new Border { Child = elapsed, [DockPanel.DockProperty] = Dock.Left },
                new Border { Child = total, [DockPanel.DockProperty] = Dock.Right },
                progress,
            },
        };
        Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 1,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 6, 0, 0),
            Children = { duration, new Transport(player) },
        });

        // ---- right ----
        Tools = new BarTools(session) { [Grid.ColumnProperty] = 2, Margin = new Thickness(0, 0, 8, 0) };
        Children.Add(Tools);

        player.PropertyChanged += OnPlayer;
        Show();
    }

    public BarTools Tools { get; }

    void OnPlayer(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(Player.Position) or nameof(Player.Duration) or nameof(Player.Progress)) ShowTime();
        else Show();
    }

    void ShowTime()
    {
        elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
        total.Text = player.Track is null ? "" : Kit.Time(player.Duration);
        progress.Follow();
    }

    void Show()
    {
        var t = player.Track;
        art.Url = t?.Cover;
        art.IsVisible = t is not null;
        title.Text = t?.Title ?? player.Notice;
        artist.Text = t?.Artist;
        album.Text = t?.Album.Title;
        ShowTime();
    }
}
