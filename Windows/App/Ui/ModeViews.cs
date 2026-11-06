using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Echo.Playback;

namespace Echo.Ui;

/// The song and its controls as the fullscreen view and the mini player have them (fullscreen.ejs
/// .controls-parents): the name (600) and artist centred, the 4 px progress with the times, then Shuffle,
/// Previous, Play, Next and Repeat, and, when asked, the volume.
public sealed class PlayerControls : StackPanel
{
    readonly Player player;
    readonly TextBlock name = Kit.Text(null, 14.4, FontWeight.SemiBold), artist = Kit.Text(null, 14);
    readonly TextBlock elapsed = Kit.Text(null, 10), left = Kit.Text(null, 10);
    readonly Slider progress = new() { Theme = Kit.Res<ControlTheme>("CiderProgress"), Minimum = 0, Maximum = 1 };
    readonly Button toggle, shuffle, repeat;
    bool seeking;

    public PlayerControls(Player player, bool volume)
    {
        this.player = player;
        name.HorizontalAlignment = artist.HorizontalAlignment = HorizontalAlignment.Center;
        Children.Add(name);
        Children.Add(artist);
        var times = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), Margin = new Thickness(0, 6, 0, 0) };
        times.Children.Add(elapsed);
        left.HorizontalAlignment = HorizontalAlignment.Right;
        times.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = left });
        Children.Add(times);
        Children.Add(progress);
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
        Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 12, 0, 0),
            Children =
            {
                shuffle,
                Kit.IconButton(Icons.Backward, 40, 36, 24, "Previous", () => _ = player.Previous()),
                toggle,
                Kit.IconButton(Icons.Forward, 40, 36, 24, "Next", () => _ = player.Next()),
                repeat,
            },
        });
        if (volume)
        {
            var slider = new Slider { Theme = Kit.Res<ControlTheme>("CiderVolume"), Minimum = 0, Maximum = 1, Value = player.Volume };
            slider.PropertyChanged += (_, e) =>
            {
                if (e.Property == Avalonia.Controls.Primitives.RangeBase.ValueProperty) player.Volume = (float)slider.Value;
            };
            var row = new DockPanel { Margin = new Thickness(0, 6, 0, 0) };
            var mute = new Glyph(Icons.Volume2, 16) { Margin = new Thickness(7, 0), Opacity = 0.7 };
            DockPanel.SetDock(mute, Dock.Left);
            row.Children.Add(mute);
            row.Children.Add(slider);
            Children.Add(row);
        }
        player.PropertyChanged += OnPlayer;
        DetachedFromVisualTree += (_, _) => player.PropertyChanged -= OnPlayer;
        Show();
    }

    void OnPlayer(object? s, PropertyChangedEventArgs e) => Show();

    void Show()
    {
        name.Text = player.Track?.Title;
        artist.Text = player.Track?.Artist;
        elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
        left.Text = player.Track is null ? "" : "-" + Kit.Time(player.Duration - player.Position);
        if (!seeking) progress.Value = player.Duration > TimeSpan.Zero ? Math.Clamp(player.Position / player.Duration, 0, 1) : 0;
        ((Glyph)toggle.Content!).Icon = player.Playing ? Icons.Pause : Icons.Play;
        shuffle.Classes.Set("on", player.Queue.Shuffle);
        repeat.Classes.Set("on", player.Queue.Repeat != Repeat.Off);
        ((Glyph)repeat.Content!).Icon = player.Queue.Repeat == Repeat.One ? Icons.RepeatOne : Icons.Repeat;
    }
}

/// Cider's fullscreen view (views/components/fullscreen.ejs; less/fullscreen.less): black under the
/// playing cover blurred (brightness 85 %), the artwork at half the window's height with the controls
/// under it, and on the right the lyrics at 35 px or the queue, switched by the two toggles at the bottom
/// right. A click on the artwork, or Escape, goes back.
public sealed class FullscreenView : Grid
{
    readonly Session session;
    readonly Nav nav;
    readonly ContentControl right = new();
    readonly Button lyrics, queue;

    public event Action? Closed;

    public FullscreenView(Session session, Nav nav)
    {
        this.session = session;
        this.nav = nav;
        Background = Brushes.Black;
        Focusable = true;
        var backdrop = new LyricsBackdrop { Url = session.Player.Track?.Cover, Opacity = 0.9 };
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) backdrop.Url = session.Player.Track?.Cover;
        };
        Children.Add(backdrop);

        var art = new CoverImage(session.Player.Track?.Cover, 400, 1200) { Cursor = new Cursor(StandardCursorType.Hand) };
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) art.Url = session.Player.Track?.Cover;
        };
        art.PointerPressed += (_, _) => Closed?.Invoke();
        var controls = new PlayerControls(session.Player, volume: true) { Margin = new Thickness(0, 12, 0, 0) };
        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { art, controls } };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*") };
        row.Children.Add(left);
        row.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = right, VerticalAlignment = VerticalAlignment.Center });
        Children.Add(row);

        // .tab-toggles: 2.5 vh glyphs, the active one on rgba(200 200 200 / .7), radius 3.
        lyrics = Kit.IconButton(Icons.Lyrics, 30, 30, 16, "Lyrics", () => Show("lyrics"), 1);
        queue = Kit.IconButton(Icons.Queue, 30, 30, 16, "Queue", () => Show("queue"), 1);
        Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 24, 18),
            Children = { lyrics, queue },
        });
        SizeChanged += (_, e) =>
        {
            var side = e.NewSize.Height / 2;
            art.Width = art.Height = controls.Width = side;
            right.Height = e.NewSize.Height * 0.62;
            right.Width = Math.Min(e.NewSize.Width / 2 - 48, e.NewSize.Height * 0.7);
        };
        Show("lyrics");
    }

    void Show(string tab)
    {
        right.Content = tab == "lyrics" ? new LyricsPanel(session, 35, withBackdrop: false) : new QueuePanel(session, nav);
        foreach (var (b, on) in new[] { (lyrics, tab == "lyrics"), (queue, tab == "queue") })
            b.Background = on ? new SolidColorBrush(Color.FromArgb(178, 200, 200, 200)) : Brushes.Transparent;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.Escape) Closed?.Invoke();
    }
}

/// Cider's mini player (views/components/miniplayer.ejs; less/miniplayer.less): a 300 px window that is the
/// cover; hovering shows the controls on a dark band at the bottom; pin keeps it on top, × goes back.
/// The cover moves the window.
public sealed class MiniPlayer : Panel
{
    public event Action? Closed;

    public MiniPlayer(Session session)
    {
        var art = new CoverImage(session.Player.Track?.Cover, double.NaN, 600, 0);
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) art.Url = session.Player.Track?.Cover;
        };
        Children.Add(art);
        var controls = new Border
        {
            Background = new SolidColorBrush(Color.Parse("#C8000000")), // #0000009e under a 10 px blur
            Padding = new Thickness(9),
            VerticalAlignment = VerticalAlignment.Bottom,
            Opacity = 0,
            Child = new PlayerControls(session.Player, volume: false),
        };
        Children.Add(controls);
        PointerEntered += (_, _) => controls.Opacity = 1;
        PointerExited += (_, _) => controls.Opacity = 0;

        var pin = Kit.IconButton(new Icon(24, 24, "", "M 12,17 l 0,5 M 9,10.76 a 2,2 0 0,1 -1.11,1.79 l -1.78,0.9 A 2,2 0 0,0 5,15.24 L 5,17 l 14,0 l 0,-1.76 a 2,2 0 0,0 -1.11,-1.79 l -1.78,-0.9 A 2,2 0 0,1 15,10.76 L 15,7 a 1,1 0 0,1 1,-1 a 2,2 0 0,0 0,-4 L 8,2 a 2,2 0 0,0 0,4 a 1,1 0 0,1 1,1 z", 2),
            22, 22, 14, "Pin to Top", () => { }, 1);
        pin.Click += (_, _) =>
        {
            if (TopLevel.GetTopLevel(this) is not Window w) return;
            w.Topmost = !w.Topmost;
            pin.Classes.Set("on", w.Topmost);
            ToolTip.SetTip(pin, w.Topmost ? "Unpin to Top" : "Pin to Top");
        };
        var exit = Kit.IconButton(Icons.X, 22, 22, 14, "Close", () => Closed?.Invoke(), 1);
        Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 5, 5, 0),
            Spacing = 3,
            Children = { pin, exit },
        });
        art.PointerPressed += (_, e) =>
        {
            if (TopLevel.GetTopLevel(this) is Window w && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) w.BeginMoveDrag(e);
        };
    }
}
