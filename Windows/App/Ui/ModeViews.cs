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

/// Cider 4's immersive view (cider.sh; its plugin kit's CustomImmersiveLayout), in place of Cider 1's
/// fullscreen view: the window full screen over the cover's fluid background, the artwork on the left
/// (80 % of its half, at most 60 % of the height, radius 10, Cider's large shadow), the lyrics on the
/// right in a rounded card, and Cider's floating player along the bottom, which hides (with the
/// pointer) after 3 s without a move while the song plays. A click on the artwork hides the lyrics and
/// centres it; Escape goes back.
public sealed class ImmersiveView : Grid
{
    readonly Session session;
    readonly Border pill;
    readonly Avalonia.Threading.DispatcherTimer idle = new() { Interval = TimeSpan.FromSeconds(3) };
    bool lyricsShown = true;

    public event Action? Closed;

    public ImmersiveView(Session session, Nav nav)
    {
        this.session = session;
        Background = Brushes.Black;
        Focusable = true;
        Children.Add(new FluidBackground(session));

        var art = new CoverImage(session.Player.Track?.Cover, 400, 1200, 10) { Cursor = new Cursor(StandardCursorType.Hand) };
        var artBox = new Border
        {
            CornerRadius = new CornerRadius(10),
            BoxShadow = BoxShadows.Parse("0 8 40 0 #8C000000"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = art,
        };
        PropertyChangedEventHandler track = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) art.Url = session.Player.Track?.Cover;
        };
        this.WhileShown(() => session.Player.PropertyChanged += track, () => session.Player.PropertyChanged -= track);

        Lyrics = new SongLyrics(session, 40);
        var card = new Border
        {
            CornerRadius = new CornerRadius(20),
            Background = new SolidColorBrush(Color.FromArgb(70, 0, 0, 0)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(26, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            ClipToBounds = true,
            Padding = new Thickness(8, 24),
            Child = Lyrics,
        };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), Margin = new Thickness(0, 0, 0, 96) };
        row.Children.Add(artBox);
        var right = new Border { [Grid.ColumnProperty] = 1, Margin = new Thickness(0, 56, 56, 0), Child = card };
        row.Children.Add(right);
        Children.Add(row);
        art.PointerPressed += (_, _) =>
        {
            lyricsShown = !lyricsShown;
            right.IsVisible = lyricsShown;
            Grid.SetColumnSpan(artBox, lyricsShown ? 1 : 2);
            Fit();
        };

        pill = Pill();
        Children.Add(pill);
        void Fit()
        {
            var side = Math.Min((lyricsShown ? Bounds.Width / 2 : Bounds.Width) * 0.8, Bounds.Height * 0.6);
            art.Width = art.Height = Math.Max(120, side);
        }
        SizeChanged += (_, _) => Fit();

        idle.Tick += (_, _) =>
        {
            idle.Stop();
            if (!session.Player.Playing || pill.IsPointerOver) return;
            pill.Opacity = 0;
            Cursor = new Cursor(StandardCursorType.None);
        };
        PointerMoved += (_, _) => Wake();
        this.WhileShown(Wake, idle.Stop);
    }

    /// The lyrics on show (tests read them).
    public SongLyrics Lyrics { get; }

    void Wake()
    {
        pill.Opacity = 1;
        Cursor = Cursor.Default;
        idle.Stop();
        idle.Start();
    }

    /// Cider 4's floating player (cider-mojave-player): the Transport, the time, the song over its
    /// progress, the volume, and leaving full screen; dark glass in Cider, here its colour, opaque enough.
    Border Pill()
    {
        var player = session.Player;
        var time = Kit.Text(null, 12.8);
        time.Opacity = 0.8;
        time.Margin = new Thickness(10, 0);
        var title = Kit.Text(null, 13, FontWeight.SemiBold);
        var by = Kit.Text(null, 12, opacity: 0.75);
        var seek = new SeekBar(player) { Height = 10, Margin = new Thickness(0, 2, 0, 0) };
        void Show()
        {
            title.Text = player.Track?.Title;
            by.Text = player.Track is { } t ? $"{t.Album.Title} — {t.Artist}" : null;
            time.Text = player.Track is null ? "" : $"{Kit.Time(player.Position)} / -{Kit.Time(player.Duration - player.Position)}";
            seek.Follow();
        }
        PropertyChangedEventHandler follow = (_, _) => Show();
        var info = new Border
        {
            Width = 380,
            Padding = new Thickness(10, 4),
            CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Color.FromArgb(18, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(26, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Child = new StackPanel { Children = { title, by, seek } },
        };
        var volume = new Slider { Theme = Kit.Res<ControlTheme>("CiderVolume"), Minimum = 0, Maximum = 1, Width = 90, Value = player.Volume, VerticalAlignment = VerticalAlignment.Center };
        volume.PropertyChanged += (_, e) =>
        {
            if (e.Property == Avalonia.Controls.Primitives.RangeBase.ValueProperty) player.Volume = (float)volume.Value;
        };
        var leave = Kit.IconButton(new Icon(24, 24, "", "M 4,14 l 6,0 l 0,6 M 20,10 l -6,0 l 0,-6 M 14,10 l 7,-7 M 3,21 l 7,-7", 2), 36, 32, 16, "Exit Full Screen", () => Closed?.Invoke());
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                new Transport(player), time, info,
                new Glyph(Icons.Volume2, 16) { Margin = new Thickness(16, 0, 6, 0), Opacity = 0.7 }, volume, leave,
            },
        };
        var box = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, 24),
            Padding = new Thickness(14, 6),
            CornerRadius = new CornerRadius(16),
            Background = new SolidColorBrush(Color.FromArgb(200, 22, 22, 22)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(30, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            BoxShadow = BoxShadows.Parse("0 8 40 0 #8C000000"),
            Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(400) }],
            Child = row,
        };
        box.WhileShown(() =>
        {
            player.PropertyChanged += follow;
            Show();
        }, () => player.PropertyChanged -= follow);
        return box;
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
