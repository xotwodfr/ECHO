using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's bottom chrome in the Mojave layout (views/app/chrome-bottom.ejs), laid out as today's players
/// are: 80 px on the window's ground. Left, the artwork (56 px) with the song over "artist — album" and
/// the "…" menu right beside them; in the middle the Transport over a thin progress bar with the time
/// small at its ends; right, the BarTools.
public sealed class ChromeBottom : Grid
{
    public const double Height2 = 80;

    readonly Player player;
    readonly CoverImage art = new(null, 56, 300, 6) { Margin = new Thickness(16, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
    readonly TextBlock title = Kit.Text(null, 13.5, FontWeight.SemiBold);
    readonly TextBlock artist = Kit.Text(null, 12.5, opacity: 0.6);
    readonly TextBlock album = Kit.Text(null, 12.5, opacity: 0.6);
    readonly TextBlock dash = Kit.Text(" — ", 12.5, opacity: 0.6);
    readonly TextBlock elapsed = Kit.Text(null, 11, FontWeight.Medium, 0.55), total = Kit.Text(null, 11, FontWeight.Medium, 0.55);
    readonly SeekBar progress;
    readonly StackPanel info;
    string? shownKey;

    /// The "…" menu or a right click on the song.
    public event Action<Control>? MenuRequested;
    /// The artwork: Cider's popover offers the mini player and the fullscreen view.
    public event Action<Control>? ArtworkClicked;

    public ChromeBottom(Session session, Nav nav)
    {
        player = session.Player;
        progress = new SeekBar(player);
        Height = Height2;
        Background = Brushes.Transparent; // on the ground
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
        var more = Kit.IconButton(Icons.More, 30, 30, 20, "More", () => MenuRequested?.Invoke(this));
        more.VerticalAlignment = VerticalAlignment.Center;
        more.Margin = new Thickness(4, 0, 12, 0);
        artist.MaxWidth = 140;
        var by = new DockPanel { Children = { artist, dash, album } };
        DockPanel.SetDock(artist, Dock.Left);
        DockPanel.SetDock(dash, Dock.Left);
        info = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 2, MaxWidth = 240, Children = { title, by } };
        // "…" right after the song, wherever its name ends.
        var left = new StackPanel { Orientation = Orientation.Horizontal, Background = Brushes.Transparent, Children = { art, info, more } };
        left.ContextRequested += (_, e) =>
        {
            MenuRequested?.Invoke(this);
            e.Handled = true;
        };
        Children.Add(left);

        // ---- middle: the controls over the progress, the time small at its ends ----
        elapsed.Width = total.Width = 40;
        elapsed.TextAlignment = TextAlignment.Right;
        progress.Margin = new Thickness(10, 0);
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
            MaxWidth = 640,
            Spacing = 2,
            Children = { new Transport(player, solid: true), duration },
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
        dash.IsVisible = t is not null;
        if (t?.Key != shownKey)
        {
            if (shownKey is not null) Motion.Enter(info, dx: 12, dy: 0, ms: 320); // a new song slides in
            shownKey = t?.Key;
        }
        ShowTime();
    }
}
