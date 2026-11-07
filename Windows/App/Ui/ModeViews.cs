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

/// The full-screen lyrics as Spicy Lyrics lays them out (its Fullscreen.ts and CanvasImmersive.css):
/// the cover's flowing background; on the left the cover (a third of the width, at most 55 % of the
/// height, radius 10, a deep shadow) with the progress bar, its times either side, the title and the
/// artist centred under it, and the controls appearing there on a move (gone, with the pointer, after
/// 3 s still while the song plays); on the right the lyrics, no card. Escape or the exit button goes back.
public sealed class ImmersiveView : Grid
{
    readonly Session session;
    readonly StackPanel controls;
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
        var elapsed = Kit.Text(null, 12.8, FontWeight.Medium, 0.8);
        var total = Kit.Text(null, 12.8, FontWeight.Medium, 0.8);
        var seek = new SeekBar(player, "SpicyProgress") { Margin = new Thickness(10, 0) };
        var bar = new DockPanel { Margin = new Thickness(0, 18, 0, 0) };
        DockPanel.SetDock(elapsed, Dock.Left);
        DockPanel.SetDock(total, Dock.Right);
        bar.Children.Add(elapsed);
        bar.Children.Add(total);
        bar.Children.Add(seek);
        var title = Kit.Text(null, 22, FontWeight.Bold);
        var artist = Kit.Text(null, 16, opacity: 0.7);
        title.HorizontalAlignment = artist.HorizontalAlignment = HorizontalAlignment.Center;
        title.Margin = new Thickness(0, 14, 0, 2);
        var leave = Kit.IconButton(new Icon(24, 24, "", "M 4,14 l 6,0 l 0,6 M 20,10 l -6,0 l 0,-6 M 14,10 l 7,-7 M 3,21 l 7,-7", 2), 36, 32, 16, "Exit Full Screen", () => Closed?.Invoke());
        controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 12, 0, 0),
            Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(300) }],
            Children = { new Transport(player), leave },
        };
        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { artBox, bar, title, artist, controls } };
        void Show()
        {
            art.Url = player.Track?.Cover;
            title.Text = player.Track?.Title;
            artist.Text = player.Track?.Artist;
            elapsed.Text = player.Track is null ? "" : Kit.Time(player.Position);
            total.Text = player.Track is null ? "" : Kit.Time(player.Duration);
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
        Motion.Enter(left, dx: -24, dy: 0, ms: 420);
        Motion.Enter(Lyrics, dx: 24, dy: 0, ms: 420, delay: 60);
        SizeChanged += (_, e) =>
        {
            var side = Math.Min(e.NewSize.Width * 0.33, e.NewSize.Height * 0.55);
            art.Width = art.Height = Math.Max(160, side);
            bar.Width = title.MaxWidth = artist.MaxWidth = art.Width;
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
