using Avalonia.Controls;
#if WINDOWS
using System.ComponentModel;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Echo.Playback;
using Windows.Media;
using Windows.Storage.Streams;
#endif

namespace Echo.Ui;

#if WINDOWS
/// Windows' media controls (SystemMediaTransportControls) for the window, as every Windows player has
/// them: the keyboard's media keys and a headset's buttons work while ECHO is in the background, and
/// the volume flyout and the lock screen show the song, its cover and where it is, with play, pause,
/// next, previous and seek. They follow the player.
sealed class MediaControls : IDisposable
{
    readonly SystemMediaTransportControls smtc;
    readonly Session session;
    DateTime timeline;

    MediaControls(SystemMediaTransportControls smtc, Session session)
    {
        this.smtc = smtc;
        this.session = session;
        smtc.IsEnabled = smtc.IsPlayEnabled = smtc.IsPauseEnabled = smtc.IsNextEnabled = smtc.IsPreviousEnabled = true;
        smtc.ButtonPressed += Pressed;
        smtc.PlaybackPositionChangeRequested += Seek;
        session.Player.PropertyChanged += Changed;
        _ = Song();
        State();
    }

    /// The window's controls, or null where Windows gives none (no window handle).
    public static IDisposable? For(Window window, Session session)
    {
        if (window.TryGetPlatformHandle()?.Handle is not { } hwnd || hwnd == 0) return null;
        try
        {
            return new MediaControls(SystemMediaTransportControlsInterop.GetForWindow(hwnd), session);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ECHO media controls: {e.Message}"); // the app plays on without them
            return null;
        }
    }

    // Windows raises these on a worker; the player lives on the window's thread.
    void Pressed(SystemMediaTransportControls sender, SystemMediaTransportControlsButtonPressedEventArgs e) =>
        Dispatcher.UIThread.Post(() =>
        {
            var player = session.Player;
            switch (e.Button)
            {
                case SystemMediaTransportControlsButton.Play: player.Play(); break;
                case SystemMediaTransportControlsButton.Pause: player.Pause(); break;
                case SystemMediaTransportControlsButton.Next: _ = player.Next(); break;
                case SystemMediaTransportControlsButton.Previous: _ = player.Previous(); break;
            }
        });

    void Seek(SystemMediaTransportControls sender, PlaybackPositionChangeRequestedEventArgs e) =>
        Dispatcher.UIThread.Post(() =>
        {
            session.Player.Seek(e.RequestedPlaybackPosition);
            Timeline();
        });

    void Changed(object? _, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(Player.Track):
                _ = Song();
                break;
            case nameof(Player.Playing):
                State();
                break;
            // Windows moves the time on by itself while playing: told again now and then, and on a seek.
            case nameof(Player.Position) when DateTime.UtcNow - timeline > TimeSpan.FromSeconds(5):
                Timeline();
                break;
        }
    }

    void State()
    {
        smtc.PlaybackStatus = session.Player.Track is null ? MediaPlaybackStatus.Closed
            : session.Player.Playing ? MediaPlaybackStatus.Playing : MediaPlaybackStatus.Paused;
        Timeline();
    }

    void Timeline()
    {
        timeline = DateTime.UtcNow;
        var p = session.Player;
        smtc.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties
        {
            StartTime = TimeSpan.Zero,
            MinSeekTime = TimeSpan.Zero,
            Position = p.Position,
            MaxSeekTime = p.Duration,
            EndTime = p.Duration,
        });
    }

    async Task Song()
    {
        var updater = smtc.DisplayUpdater;
        if (session.Player.Track is not { } t)
        {
            updater.ClearAll();
            updater.Update();
            return;
        }
        updater.Type = MediaPlaybackType.Music;
        updater.MusicProperties.Title = t.Title;
        updater.MusicProperties.Artist = t.Artist;
        updater.MusicProperties.AlbumArtist = t.Artist;
        updater.MusicProperties.AlbumTitle = t.Album.Title;
        updater.Thumbnail = null;
        updater.Update();
        // The cover from the covers already fetched (the server wants the device token, Windows has none).
        try
        {
            if (await session.Covers.Get(t.Cover, 300) is not { } cover || session.Player.Track != t) return;
            var png = new MemoryStream();
            cover.Save(png, new PngBitmapEncoderOptions());
            png.Position = 0;
            updater.Thumbnail = RandomAccessStreamReference.CreateFromStream(png.AsRandomAccessStream());
            updater.Update();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException or IOException) { }
    }

    public void Dispose()
    {
        session.Player.PropertyChanged -= Changed;
        smtc.ButtonPressed -= Pressed;
        smtc.PlaybackPositionChangeRequested -= Seek;
        smtc.DisplayUpdater.ClearAll();
        smtc.DisplayUpdater.Update();
        smtc.IsEnabled = false;
    }
}
#else
/// Windows' media controls; none on the dev box's build.
static class MediaControls
{
    public static IDisposable? For(Window window, Session session) => null;
}
#endif
