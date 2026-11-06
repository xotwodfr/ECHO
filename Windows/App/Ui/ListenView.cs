using System.ComponentModel;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Echo.Glass;
using Echo.Playback;
using Echo.Stage;
using Echo.Stage.Lyrics;
using SkiaSharp;

namespace Echo.Ui;

public enum StageViewMode { Lyrics, Cover, Visual }

/// The Listen room (PRODUCT_SPEC.md S1): the room fills the window; over it the lyric field, the cover
/// or nothing (Lyrics / Cover / Visual); over those the chrome, glass, which hides after 3 s of play.
/// No sidebar here, as on the web's Stage. The lyrics are never under glass: the chrome keeps to the
/// top and the bottom, and the field fades out before them.
public sealed class ListenView : Panel
{
    const double PillClear = 100; // the pill's height and margin: the lyrics fade out above it

    readonly Session session;
    readonly Player player;
    readonly StageView stage;
    readonly FallbackRoom fallback;
    readonly LyricsView lyrics;
    readonly Border cover;
    readonly CoverImage coverImage;
    readonly Panel chrome;
    readonly ContentControl queue = new();
    readonly ChromeTimer chromeTimer = new(() => Environment.TickCount64);
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };
    readonly List<Button> modeButtons = [];
    LyricsField? field;
    StagePalette palette;
    StageViewMode mode = StageViewMode.Lyrics;
    string? albumKey;

    public ListenView(Session session)
    {
        this.session = session;
        player = session.Player;
        palette = session.Fixtures ? Fixtures.Palette : StagePalette.Fallback;

        fallback = new FallbackRoom { Palette = palette };
        stage = new StageView(session.Tap) { Mode = session.Fixtures ? RoomMode.Ambient : RoomMode.Reverb, Palette = palette, Playing = player.Playing };
        stage.TrackStarted();

        lyrics = new LyricsView { FieldFor = MakeField };
        coverImage = new CoverImage { Pixels = 640 };
        cover = new Border
        {
            CornerRadius = new CornerRadius(8),
            ClipToBounds = true,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = coverImage,
            IsVisible = false,
            Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(420) }],
        };

        // The chrome: back at the top left; the view switch and full screen at the top right; the player.
        var modes = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        foreach (var m in Enum.GetValues<StageViewMode>())
        {
            var b = TextButton(m.ToString(), () => SetMode(m));
            b.Tag = m;
            modeButtons.Add(b);
            modes.Children.Add(b);
        }
        modes.Children.Add(TextButton("Full screen", () => (TopLevel.GetTopLevel(this) as MainWindow)?.ToggleFullScreen()));
        var pill = new PlayerPill { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 16) };
        pill.Bind(session);
        chrome = new Panel
        {
            Children =
            {
                new GlassPanel
                {
                    Name = "Back", Width = 44, Height = 44, CornerRadius = new CornerRadius(22), Margin = new Thickness(20),
                    HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
                    Child = Round("IconBack", () => session.Nav.Back()),
                },
                new GlassPanel
                {
                    Name = "Modes", Height = 44, CornerRadius = new CornerRadius(22), Padding = new Thickness(7, 0), Margin = new Thickness(20),
                    HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Child = modes,
                },
                pill,
            },
            Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(400) }],
        };

        Children.Add(fallback);
        Children.Add(stage);
        Children.Add(lyrics);
        Children.Add(cover);
        Children.Add(chrome);
        Children.Add(queue);
        Background = Brushes.Transparent; // pointer moves anywhere bring the chrome back

        SetMode(StageViewMode.Lyrics);
        tick.Tick += (_, _) => ShowChrome();
        PointerMoved += (_, _) => chromeTimer.Poke();
        DoubleTapped += (_, e) =>
        {
            if (e.Source == this || e.Source is LyricsField or StageView or FallbackRoom) (TopLevel.GetTopLevel(this) as MainWindow)?.ToggleFullScreen();
        };
    }

    static ControlTheme Bare => (ControlTheme)Application.Current!.FindResource("Bare")!;

    static Button TextButton(string text, Action click)
    {
        var b = new Button
        {
            Theme = Bare,
            Content = new TextBlock { Text = text, FontSize = 13, FontWeight = FontWeight.SemiBold },
            Padding = new Thickness(14, 7),
            CornerRadius = new CornerRadius(15),
        };
        b.Click += (_, _) => click();
        return b;
    }

    static Button Round(string icon, Action click)
    {
        var b = new Button
        {
            Theme = Bare,
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(22),
            Content = new PathIcon { Data = (StreamGeometry)Application.Current!.FindResource(icon)!, Width = 18, Height = 18 },
        };
        b.Click += (_, _) => click();
        return b;
    }

    Control MakeField(LyricsDoc doc)
    {
        field = new LyricsField(doc, () => player.PositionNow.TotalMilliseconds - session.Lyrics.OffsetMs, () => player.Playing,
            () => stage.Features, palette)
        {
            Dock = PillClear,
            KeyLight = (x, y) => (stage.KeyX, stage.KeyY) = ((float)x, (float)y),
        };
        field.Seek += ms =>
        {
            player.Seek(TimeSpan.FromMilliseconds(ms + session.Lyrics.OffsetMs));
            if (!player.Playing) player.Toggle();
        };
        return field;
    }

    public void SetMode(StageViewMode m)
    {
        mode = m;
        lyrics.IsVisible = m == StageViewMode.Lyrics;
        cover.IsVisible = m == StageViewMode.Cover;
        foreach (var b in modeButtons) b.Opacity = (StageViewMode)b.Tag! == m ? 1 : 0.55;
    }

    public void CycleMode() => SetMode(mode switch { StageViewMode.Lyrics => StageViewMode.Cover, StageViewMode.Cover => StageViewMode.Visual, _ => StageViewMode.Lyrics });

    void ShowChrome()
    {
        var visible = chromeTimer.Visible(player.Playing);
        chrome.Opacity = visible ? 1 : 0;
        chrome.IsHitTestVisible = visible;
        stage.Chrome = visible;
        Cursor = visible ? Cursor.Default : new Cursor(StandardCursorType.None);
    }

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        // Cover mode (DESIGN_SYSTEM.md §8): up to min(60vh, 640 px).
        cover.Width = cover.Height = Math.Min(e.NewSize.Height * 0.6, 640);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        player.PropertyChanged += OnPlayer;
        session.Lyrics.PropertyChanged += OnLyrics;
        session.QueueToggled += ToggleQueue;
        tick.Start();
        ShowTrack();
        if (session.Fixtures) lyrics.Show(LyricsStatus.Ready, Fixtures.Lyrics);
        else lyrics.Show(session.Lyrics.Status, session.Lyrics.Doc);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        player.PropertyChanged -= OnPlayer;
        session.Lyrics.PropertyChanged -= OnLyrics;
        session.QueueToggled -= ToggleQueue;
        tick.Stop();
        Cursor = Cursor.Default;
        base.OnDetachedFromVisualTree(e);
    }

    void ToggleQueue() => queue.Content = queue.Content is null ? new QueueSheet(session) : null;

    void OnPlayer(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Player.Playing)) stage.Playing = player.Playing;
        if (e.PropertyName == nameof(Player.Track)) ShowTrack();
    }

    void OnLyrics(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(Lyrics.Status) or nameof(Lyrics.Doc)) lyrics.Show(session.Lyrics.Status, session.Lyrics.Doc);
    }

    /// A new song: its cover crossfades in, and a new album brings its palette and its cover into the room.
    void ShowTrack()
    {
        var track = player.Track;
        stage.TrackStarted();
        cover.Opacity = 0;
        DispatcherTimer.RunOnce(() =>
        {
            coverImage.Url = track?.Cover;
            cover.Opacity = 1;
        }, TimeSpan.FromMilliseconds(cover.IsVisible ? 420 : 1));
        if (albumKey is not null && track?.Album.Key == albumKey) return;
        albumKey = track?.Album.Key;
        _ = Room(track);
    }

    async Task Room(Track? track)
    {
        var next = session.Fixtures ? Fixtures.Palette
            : track is not null && await session.Library.Palette(track.Album.Key) is { } p ? StagePalette.Of(p) : null;
        palette = next ?? StagePalette.Fallback;
        stage.Palette = palette;
        fallback.Palette = palette;
        if (field is not null) field.Palette = palette;
        if (await session.Covers.Get(track?.Cover, 300) is { } bitmap)
        {
            using var png = new MemoryStream();
            bitmap.Save(png, new Avalonia.Media.Imaging.PngBitmapEncoderOptions());
            png.Position = 0;
            using var decoded = SKBitmap.Decode(png);
            stage.Cover = StageView.CoverBitmap(decoded);
        }
        else stage.Cover = null;
    }
}
