using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's bottom chrome in the Mojave layout (views/app/chrome-bottom.ejs; less/directives.less): 90 px of
/// --color2. Left, the artwork (70 px) with the song, artist and album, and the "…" menu; in the middle
/// the time, the progress bar and the duration over Shuffle, Previous, Play, Next and Repeat; right, the
/// volume, the queue and the lyrics (Cast is AirPlay and Chromecast: not here).
public sealed class ChromeBottom : Grid
{
    public const double Height2 = 90;

    readonly Session session;
    readonly Player player;
    readonly CoverImage art = new(null, 70, 300, 4) { Margin = new Thickness(10, 0) };
    readonly TextBlock title = Kit.Text(null, 12.8, FontWeight.Medium);
    readonly TextBlock artist = Kit.Text(null, 12, opacity: 0.8);
    readonly TextBlock album = Kit.Text(null, 12, opacity: 0.8);
    readonly TextBlock elapsed = Kit.Text(null, 12.8), total = Kit.Text(null, 12.8);
    readonly Slider progress = new() { Theme = Kit.Res<Avalonia.Styling.ControlTheme>("CiderProgress"), Minimum = 0, Maximum = 1, VerticalAlignment = VerticalAlignment.Center };
    readonly Slider volume = new() { Theme = Kit.Res<Avalonia.Styling.ControlTheme>("CiderVolume"), Minimum = 0, Maximum = 1, Width = 70, VerticalAlignment = VerticalAlignment.Center };
    readonly Button shuffle, repeat, toggle, queue, lyrics, mute;
    bool seeking;

    /// The queue or lyrics button: Cider's drawer opens (or closes) on that panel.
    public event Action<string>? DrawerRequested;
    /// The "…" menu or a right click on the song.
    public event Action<Control>? MenuRequested;
    /// The artwork: Cider's popover offers the mini player and the fullscreen view.
    public event Action<Control>? ArtworkClicked;

    public ChromeBottom(Session session, Nav nav)
    {
        this.session = session;
        player = session.Player;
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
            LastChildFill = true,
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
        progress.AddHandler(PointerPressedEvent, (_, _) => seeking = true, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        progress.AddHandler(PointerReleasedEvent, (_, _) =>
        {
            seeking = false;
            player.Seek(player.Duration * progress.Value);
        }, Avalonia.Interactivity.RoutingStrategies.Tunnel);

        shuffle = Kit.IconButton(Icons.Shuffle, 40, 32, 15.7, "Shuffle", () => player.SetShuffle(!player.Queue.Shuffle));
        repeat = Kit.IconButton(Icons.Repeat, 40, 32, 15.7, "Repeat", () =>
        {
            player.CycleRepeat();
            Show();
        });
        toggle = Kit.IconButton(Icons.Play, 42, 42, 38, "Play", player.Toggle);
        toggle.CornerRadius = new CornerRadius(21);
        toggle.Margin = new Thickness(6);
        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center,
            Children =
            {
                shuffle,
                Kit.IconButton(Icons.Backward, 40, 36, 24, "Previous", () => _ = player.Previous()),
                toggle,
                Kit.IconButton(Icons.Forward, 40, 36, 24, "Next", () => _ = player.Next()),
                repeat,
            },
        };
        Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 1,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 6, 0, 0),
            Children = { duration, controls },
        });

        // ---- right: volume, queue, lyrics ----
        mute = Kit.IconButton(Icons.Volume2, 30, 15, 16, "Mute", () =>
        {
            player.Muted = !player.Muted;
            Show();
        });
        volume.Value = player.Volume;
        volume.PropertyChanged += (_, e) =>
        {
            if (e.Property == RangeBase.ValueProperty) player.Volume = (float)volume.Value;
        };
        queue = Kit.IconButton(Icons.Queue, 40, 32, 15.7, "Queue", () => DrawerRequested?.Invoke("queue"));
        lyrics = Kit.IconButton(Icons.Lyrics, 40, 32, 15.7, "Lyrics", () => DrawerRequested?.Invoke("lyrics"));
        Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 2,
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
            Children =
            {
                new StackPanel { Orientation = Orientation.Horizontal, Width = 100, Margin = new Thickness(0, 0, 6, 0), Children = { mute, volume } },
                new Border { Width = 50, Child = queue },
                new Border { Width = 50, Child = lyrics },
            },
        });

        player.PropertyChanged += OnPlayer;
        player.QueueChanged += Show;
        session.Lyrics.PropertyChanged += (_, _) => Show();
        Show();
    }

    /// Which drawer panel is open, for the buttons' active look.
    public string? OpenPanel
    {
        set
        {
            queue.Classes.Set("active", value == "queue");
            lyrics.Classes.Set("active", value == "lyrics");
        }
    }

    void OnPlayer(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(Player.Position) or nameof(Player.Duration) or nameof(Player.Progress)) ShowTime();
        else Show();
    }

    void ShowTime()
    {
        elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
        total.Text = player.Track is null ? "" : Kit.Time(player.Duration);
        if (!seeking) progress.Value = player.Duration > TimeSpan.Zero ? Math.Clamp(player.Position / player.Duration, 0, 1) : 0;
    }

    void Show()
    {
        var t = player.Track;
        art.Url = t?.Cover;
        art.IsVisible = t is not null;
        title.Text = t?.Title ?? player.Notice;
        artist.Text = t?.Artist;
        album.Text = t?.Album.Title;
        ((Glyph)toggle.Content!).Icon = player.Playing ? Icons.Pause : Icons.Play;
        ToolTip.SetTip(toggle, player.Playing ? "Pause" : "Play");
        // .playback-button--small.active: rgb(200 200 200 / 25%) behind; Repeat One has its own glyph.
        shuffle.Classes.Set("on", player.Queue.Shuffle);
        repeat.Classes.Set("on", player.Queue.Repeat != Repeat.Off);
        ((Glyph)repeat.Content!).Icon = player.Queue.Repeat == Repeat.One ? Icons.RepeatOne : Icons.Repeat;
        ((Glyph)mute.Content!).Icon = player.Muted ? Icons.Volume : Icons.Volume2;
        // Cider dims the lyrics button to 30 % and lets it do nothing when the song has none.
        var has = session.Lyrics.Status == LyricsStatus.Ready;
        lyrics.Opacity = has ? 0.7 : 0.3;
        lyrics.IsHitTestVisible = has;
        ShowTime();
    }
}
