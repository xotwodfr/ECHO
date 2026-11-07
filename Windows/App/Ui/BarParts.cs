using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Styling;
using Echo.Playback;

namespace Echo.Ui;

/// Cider's five playback buttons, wherever its player sits (the bottom chrome, Maverick's top chrome, the
/// fullscreen view, the mini player): Shuffle and Repeat as small buttons (40×32, a 0.98 em glyph, rgb(200
/// 200 200 / 25%) behind when on), Previous and Next (40×36, the glyph at 60 %), Play/Pause round (42 px,
/// a 38 px glyph, 6 px apart). `solid`, for the bar: Play/Pause a white disc with a dark glyph, as
/// today's players have it.
public sealed class Transport : StackPanel
{
    readonly Player player;
    readonly Button shuffle, repeat, toggle, back, on;

    public Transport(Player player, bool solid = false)
    {
        this.player = player;
        Orientation = Orientation.Horizontal;
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Center;
        shuffle = Kit.IconButton(Icons.Shuffle, 40, 32, 15.7, "Shuffle", () => player.SetShuffle(!player.Queue.Shuffle));
        repeat = Kit.IconButton(Icons.Repeat, 40, 32, 15.7, "Repeat", () =>
        {
            player.CycleRepeat();
            Show();
        });
        toggle = Kit.IconButton(Icons.Play, 42, 42, 38, "Play", player.Toggle);
        toggle.CornerRadius = new CornerRadius(21);
        toggle.Margin = new Thickness(6);
        back = Kit.IconButton(Icons.Backward, 40, 36, 24, "Previous", () => _ = player.Previous());
        on = Kit.IconButton(Icons.Forward, 40, 36, 24, "Next", () => _ = player.Next());
        if (solid)
        {
            toggle.Theme = Kit.Res<ControlTheme>("PlayCircle");
            toggle.Width = toggle.Height = 36;
            toggle.Opacity = 1;
            toggle.Margin = new Thickness(12, 0);
            ((Glyph)toggle.Content!).Width = ((Glyph)toggle.Content!).Height = 30;
            back.Opacity = on.Opacity = 0.85;
        }
        Children.Add(shuffle);
        Children.Add(back);
        Children.Add(toggle);
        Children.Add(on);
        Children.Add(repeat);
        // Followed only while on screen: the fullscreen view and the mini player come and go.
        this.WhileShown(() =>
        {
            player.PropertyChanged += OnPlayer;
            player.QueueChanged += Show;
            Show();
        }, () =>
        {
            player.PropertyChanged -= OnPlayer;
            player.QueueChanged -= Show;
        });
        Show();
    }

    void OnPlayer(object? s, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(Player.Playing) or nameof(Player.Track)) Show();
    }

    /// Apple Music's row under a cover `width` wide: Shuffle and Repeat small and dim at its edges,
    /// Previous, Play/Pause and Next large and white between them, spread evenly.
    public void Spread(double width)
    {
        void Size(Button b, double box, double glyph, double opacity)
        {
            b.Width = b.Height = box;
            b.Opacity = opacity;
            ((Glyph)b.Content!).Width = ((Glyph)b.Content!).Height = glyph;
        }
        Size(shuffle, width * 0.1, width * 0.048, 0.55);
        Size(repeat, width * 0.1, width * 0.048, 0.55);
        Size(back, width * 0.16, width * 0.127, 1);
        Size(on, width * 0.16, width * 0.127, 1);
        Size(toggle, width * 0.16, width * 0.158, 1);
        toggle.Margin = default;
        toggle.CornerRadius = new CornerRadius(width * 0.08);
        Spacing = Math.Max(0, (width - width * (0.1 * 2 + 0.16 * 3)) / 4);
    }

    /// Shuffle and Repeat alone (Cider 4's queue drawer has them on top).
    public sealed class Toggles : StackPanel
    {
        readonly Player player;
        readonly Button shuffle, repeat;

        public Toggles(Player player)
        {
            this.player = player;
            Orientation = Orientation.Horizontal;
            shuffle = Kit.IconButton(Icons.Shuffle, 34, 28, 13, "Shuffle", () => player.SetShuffle(!player.Queue.Shuffle));
            repeat = Kit.IconButton(Icons.Repeat, 34, 28, 13, "Repeat", () =>
            {
                player.CycleRepeat();
                Show();
            });
            shuffle.CornerRadius = repeat.CornerRadius = new CornerRadius(14);
            Children.Add(shuffle);
            Children.Add(repeat);
            this.WhileShown(() => player.QueueChanged += Show, () => player.QueueChanged -= Show);
            Show();
        }

        void Show()
        {
            shuffle.Classes.Set("on", player.Queue.Shuffle);
            repeat.Classes.Set("on", player.Queue.Repeat != Repeat.Off);
            ((Glyph)repeat.Content!).Icon = player.Queue.Repeat == Repeat.One ? Icons.RepeatOne : Icons.Repeat;
        }
    }

    void Show()
    {
        var glyph = (Glyph)toggle.Content!;
        var icon = player.Playing ? Icons.Pause : Icons.Play;
        if (glyph.Icon is not null && glyph.Icon != icon)
        {
            // The new glyph pops in from 70 %.
            glyph.Transitions ??= [new Avalonia.Animation.TransformOperationsTransition { Property = Visual.RenderTransformProperty, Duration = TimeSpan.FromMilliseconds(240), Easing = new Avalonia.Animation.Easings.BackEaseOut() }];
            glyph.RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("scale(0.7)");
            Avalonia.Threading.Dispatcher.UIThread.Post(() => glyph.RenderTransform = Avalonia.Media.Transformation.TransformOperations.Parse("scale(1)"), Avalonia.Threading.DispatcherPriority.Render);
        }
        glyph.Icon = icon;
        ToolTip.SetTip(toggle, player.Playing ? "Pause" : "Play");
        shuffle.Classes.Set("on", player.Queue.Shuffle);
        repeat.Classes.Set("on", player.Queue.Repeat != Repeat.Off);
        ((Glyph)repeat.Content!).Icon = player.Queue.Repeat == Repeat.One ? Icons.RepeatOne : Icons.Repeat;
    }
}

/// The right end of Cider's player: the volume (a 30 px button and the slider, 100 px), then the queue and
/// lyrics buttons in 50 px each (Cider's Cast is AirPlay and Chromecast: not here). Lyrics is at 30 % and
/// does nothing while the song has none, as Cider's.
public sealed class BarTools : StackPanel
{
    readonly Session session;
    readonly Button queue, lyrics, mute;

    /// The queue or lyrics button: Cider's drawer opens (or closes) on that panel.
    public event Action<string>? DrawerRequested;

    public BarTools(Session session)
    {
        this.session = session;
        var player = session.Player;
        Orientation = Orientation.Horizontal;
        HorizontalAlignment = HorizontalAlignment.Right;
        VerticalAlignment = VerticalAlignment.Center;
        mute = Kit.IconButton(Icons.Volume2, 30, 15, 16, "Mute", () =>
        {
            player.Muted = !player.Muted;
            Show();
        });
        var volume = new Slider
        {
            Theme = Kit.Res<ControlTheme>("CiderVolume"),
            Minimum = 0,
            Maximum = 1,
            Width = 70,
            VerticalAlignment = VerticalAlignment.Center,
            Value = player.Volume,
        };
        volume.PropertyChanged += (_, e) =>
        {
            if (e.Property == RangeBase.ValueProperty) player.Volume = (float)volume.Value;
        };
        queue = Kit.IconButton(Icons.Queue, 40, 32, 15.7, "Queue", () => DrawerRequested?.Invoke("queue"));
        lyrics = Kit.IconButton(Icons.Lyrics, 40, 32, 15.7, "Lyrics", () => DrawerRequested?.Invoke("lyrics"));
        Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Width = 100, Margin = new Thickness(0, 0, 6, 0), Children = { mute, volume } });
        Children.Add(new Border { Width = 50, Child = queue });
        Children.Add(new Border { Width = 50, Child = lyrics });
        session.Lyrics.PropertyChanged += (_, _) => Show();
        Show();
    }

    /// Which drawer panel is open, for the buttons' active look.
    public string? OpenPanel
    {
        set
        {
            // Today's players light the open panel's icon in the key colour rather than boxing it.
            queue.Foreground = value == "queue" ? Kit.Brush("Key") : Kit.Brush("Text");
            lyrics.Foreground = value == "lyrics" ? Kit.Brush("Key") : Kit.Brush("Text");
            queue.Opacity = value == "queue" ? 1 : 0.7;
            Show();
            if (value == "lyrics") lyrics.Opacity = 1;
        }
    }

    void Show()
    {
        ((Glyph)mute.Content!).Icon = session.Player.Muted ? Icons.Volume : Icons.Volume2;
        var has = session.Lyrics.Status == LyricsStatus.Ready;
        lyrics.Opacity = has ? 0.7 : 0.3;
        lyrics.IsHitTestVisible = has;
    }
}

/// The song's progress as a seek bar: follows the player except while it is held.
public sealed class SeekBar : Slider
{
    readonly Player player;
    bool held;

    public SeekBar(Player player, string theme = "CiderProgress")
    {
        this.player = player;
        Theme = Kit.Res<ControlTheme>(theme);
        Minimum = 0;
        Maximum = 1;
        VerticalAlignment = VerticalAlignment.Center;
        AddHandler(PointerPressedEvent, (_, _) => held = true, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, (_, _) =>
        {
            held = false;
            player.Seek(player.Duration * Value);
        }, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        System.ComponentModel.PropertyChangedEventHandler playing = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Playing)) Glide();
        };
        this.WhileShown(() =>
        {
            player.PropertyChanged += playing;
            Glide();
        }, () => player.PropertyChanged -= playing);
    }

    bool gliding;

    /// While the song plays the bar moves every frame from the player's own clock, not 4 times a second.
    void Glide()
    {
        if (gliding || !player.Playing || TopLevel.GetTopLevel(this) is not { } top) return;
        gliding = true;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan _)
        {
            if (!held && player.Duration > TimeSpan.Zero) Value = Math.Clamp(player.PositionNow / player.Duration, 0, 1);
            if (player.Playing && TopLevel.GetTopLevel(this) is not null) top.RequestAnimationFrame(Frame);
            else gliding = false;
        }
    }

    protected override Type StyleKeyOverride => typeof(Slider);

    public void Follow()
    {
        if (!held) Value = player.Duration > TimeSpan.Zero ? Math.Clamp(player.Position / player.Duration, 0, 1) : 0;
    }
}

/// Maverick's player display in the top chrome (style.less .app-chrome-item.playback-controls,
/// .app-playback-controls): up to 500 px between two faint rules; the 42 px artwork, the song (600) over
/// "artist — album", centred and fading out at both ends, the 4 px progress along the bottom, and "…".
public sealed class Lcd : Border
{
    readonly Player player;
    readonly CoverImage art = new(null, 42, 96, 6) { Margin = new Thickness(4) };
    readonly TextBlock song = Kit.Text(null, 13, Avalonia.Media.FontWeight.SemiBold), by = Kit.Text(null, 12, opacity: 0.8);
    readonly SeekBar progress;

    /// "…": Cider's now-playing menu.
    public event Action<Control>? MenuRequested;
    public event Action<Control>? ArtworkClicked;

    public Lcd(Session session, Nav nav)
    {
        player = session.Player;
        progress = new SeekBar(player) { Height = 8, VerticalAlignment = VerticalAlignment.Bottom };
        MaxWidth = 500;
        Height = ChromeTop.HeightMaverick * 0.9;
        BorderBrush = new Avalonia.Media.SolidColorBrush(Avalonia.Media.Color.FromArgb(20, 200, 200, 200));
        BorderThickness = new Thickness(1, 0);
        song.HorizontalAlignment = by.HorizontalAlignment = HorizontalAlignment.Center;
        var info = new Panel
        {
            OpacityMask = new Avalonia.Media.LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(1, 0, RelativeUnit.Relative),
                GradientStops =
                {
                    new Avalonia.Media.GradientStop(Avalonia.Media.Colors.Transparent, 0.03), new Avalonia.Media.GradientStop(Avalonia.Media.Colors.Black, 0.1),
                    new Avalonia.Media.GradientStop(Avalonia.Media.Colors.Black, 0.9), new Avalonia.Media.GradientStop(Avalonia.Media.Colors.Transparent, 1),
                },
            },
            Children = { new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 0, 6), Children = { song, by } }, progress },
        };
        var more = Kit.IconButton(Icons.More, 42, 42, 20, "More", () => MenuRequested?.Invoke(this));
        art.Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Hand);
        art.PointerPressed += (_, _) => ArtworkClicked?.Invoke(art);
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        grid.Children.Add(art);
        grid.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = info });
        grid.Children.Add(new Border { [Grid.ColumnProperty] = 2, Child = more, Margin = new Thickness(6, 0) });
        Child = grid;
        player.PropertyChanged += (_, _) => Show();
        Show();
    }

    void Show()
    {
        var t = player.Track;
        art.Url = t?.Cover;
        song.Text = t?.Title ?? player.Notice;
        by.Text = t is null ? null : $"{t.Artist} — {t.Album.Title}";
        progress.IsVisible = t is not null;
        progress.Follow();
    }
}
