using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Animation;
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
    readonly SeekBar progress;

    public PlayerControls(Player player, bool volume)
    {
        this.player = player;
        progress = new SeekBar(player);
        name.HorizontalAlignment = artist.HorizontalAlignment = HorizontalAlignment.Center;
        Children.Add(name);
        Children.Add(artist);
        var times = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), Margin = new Thickness(0, 6, 0, 0) };
        times.Children.Add(elapsed);
        left.HorizontalAlignment = HorizontalAlignment.Right;
        times.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = left });
        Children.Add(times);
        Children.Add(progress);
        Children.Add(new Transport(player) { Margin = new Thickness(0, 12, 0, 0) });
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
        this.WhileShown(() => player.PropertyChanged += OnPlayer, () => player.PropertyChanged -= OnPlayer);
        Show();
    }

    void OnPlayer(object? s, PropertyChangedEventArgs e) => Show();

    void Show()
    {
        name.Text = player.Track?.Title;
        artist.Text = player.Track?.Artist;
        elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
        left.Text = player.Track is null ? "" : "-" + Kit.Time(player.Duration - player.Position);
        progress.Follow();
    }
}

/// The full-screen lyrics as Apple Music lays them out (as Lyricify's Apple Music style shows them): the
/// cover's flowing background; on the left the cover (a third of the width, at most 55 % of the height,
/// radius 10, a deep shadow), under it the title and artist on the left with a round "…" (the song's
/// menu) on the right, a thin progress bar with the time gone and the time left, then Shuffle and Repeat
/// small and dim at the cover's edges with Previous, Play/Pause and Next large between them; a pill at
/// the top goes back, as Escape does. The controls fade (with the pointer) after 3 s still while the
/// song plays and come back on a move. On the right the lyrics, no card.
public sealed class ImmersiveView : Grid
{
    readonly Session session;
    readonly Control controls;
    readonly Avalonia.Threading.DispatcherTimer idle = new() { Interval = TimeSpan.FromSeconds(3) };

    public event Action? Closed;

    public ImmersiveView(Session session, Nav nav)
    {
        this.session = session;
        var player = session.Player;
        Background = Brushes.Black;
        Focusable = true;
        Children.Add(new FluidBackground(session));

        var art = new CoverImage(player.Track?.Cover, 400, 1200, 10);
        var artBox = new Border { CornerRadius = new CornerRadius(10), BoxShadow = BoxShadows.Parse("0 12 48 0 #99000000"), Child = art };
        var title = Kit.Text(null, 17, FontWeight.SemiBold);
        var artist = Kit.Text(null, 17, opacity: 0.6);
        Button? more = null;
        more = Kit.IconButton(Icons.More, 30, 30, 22, "More", () => NowPlayingMenu.Show(more!, session, nav), opacity: 1);
        more.CornerRadius = new CornerRadius(15);
        more.Background = new SolidColorBrush(Color.FromArgb(38, 255, 255, 255));
        more.Classes.Add("nopress");
        var info = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        info.Children.Add(new StackPanel { Spacing = 1, Children = { title, artist } });
        more.Margin = new Thickness(12, 0, 0, 0);
        Grid.SetColumn(more, 1);
        info.Children.Add(more);
        var seek = new SeekBar(player, "AppleProgress");
        var elapsed = Kit.Text(null, 12, FontWeight.Medium, 0.55);
        var remaining = Kit.Text(null, 12, FontWeight.Medium, 0.55);
        remaining.HorizontalAlignment = HorizontalAlignment.Right;
        var times = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), Children = { elapsed, new Border { [Grid.ColumnProperty] = 1, Child = remaining } } };
        var transport = new Transport(player)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(300) }],
        };
        var grabber = new Border
        {
            Width = 44,
            Height = 5,
            CornerRadius = new CornerRadius(2.5),
            Background = new SolidColorBrush(Color.FromArgb(102, 255, 255, 255)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 18, 0, 0),
            Cursor = new Cursor(StandardCursorType.Hand),
        };
        ToolTip.SetTip(grabber, "Exit Full Screen");
        // A wider target than the pill itself.
        var grab = new Border { Background = Brushes.Transparent, Padding = new Thickness(24, 0, 24, 12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Child = grabber };
        grab.PointerPressed += (_, _) => Closed?.Invoke();
        controls = transport;
        var column = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { artBox, info, seek, times, transport } };
        var left = new Panel { Children = { column, grab } };
        void Show()
        {
            art.Url = player.Track?.Cover;
            title.Text = player.Track?.Title;
            artist.Text = player.Track?.Artist;
            elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
            remaining.Text = player.Track is null ? "" : "-" + Kit.Time(player.Duration - player.Position);
            seek.Follow();
        }
        PropertyChangedEventHandler follow = (_, _) => Show();
        this.WhileShown(() =>
        {
            player.PropertyChanged += follow;
            Show();
        }, () => player.PropertyChanged -= follow);

        Lyrics = new SongLyrics(session);
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("44*,56*") };
        row.Children.Add(left);
        row.Children.Add(new Border { [Grid.ColumnProperty] = 1, Margin = new Thickness(0, 0, 48, 0), Child = Lyrics });
        Children.Add(row);
        Motion.Enter(column, dx: -24, dy: 0, ms: 420);
        Motion.Enter(Lyrics, dx: 24, dy: 0, ms: 420, delay: 60);
        SizeChanged += (_, e) =>
        {
            // Apple's proportions, from the cover's width: the type 4.2 % of it, the gaps 8 %, 4 %, 6 %.
            var side = Math.Max(160, Math.Min(e.NewSize.Width * 0.33, e.NewSize.Height * 0.55));
            art.Width = art.Height = side;
            column.Width = side;
            title.FontSize = artist.FontSize = Math.Max(14, side * 0.042);
            more.Width = more.Height = Math.Max(26, side * 0.07);
            more.CornerRadius = new CornerRadius(more.Width / 2);
            info.Margin = new Thickness(0, side * 0.08, 0, 0);
            seek.Margin = new Thickness(0, side * 0.04, 0, 0);
            times.Margin = new Thickness(0, 2, 0, 0);
            elapsed.FontSize = remaining.FontSize = Math.Max(11, side * 0.028);
            transport.Margin = new Thickness(0, side * 0.05, 0, 0);
            transport.Spread(side);
        };

        idle.Tick += (_, _) =>
        {
            idle.Stop();
            if (!player.Playing || controls.IsPointerOver) return;
            controls.Opacity = 0;
            Cursor = new Cursor(StandardCursorType.None);
        };
        PointerMoved += (_, _) => Wake();
        this.WhileShown(Wake, idle.Stop);
    }

    /// The lyrics on show (tests read them).
    public SongLyrics Lyrics { get; }

    void Wake()
    {
        controls.Opacity = 1;
        Cursor = Cursor.Default;
        idle.Stop();
        idle.Start();
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
        PropertyChangedEventHandler track = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) art.Url = session.Player.Track?.Cover;
        };
        this.WhileShown(() => session.Player.PropertyChanged += track, () => session.Player.PropertyChanged -= track);
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
