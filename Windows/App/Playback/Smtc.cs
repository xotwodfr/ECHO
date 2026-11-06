#if WINDOWS
using System.ComponentModel;
using Avalonia.Threading;
using Echo.Ui;
using Windows.Media;
using Windows.Media.Playback;
using Windows.Storage.Streams;

namespace Echo.Playback;

/// The media keys and Windows' media overlay (SystemMediaTransportControls): what plays, its cover and
/// time, and Play / Pause / Next / Previous / seek from the keyboard or the overlay while a game has
/// the focus. A WinRT MediaPlayer with its own commands off lends its controls to ECHO's player.
static class Smtc
{
    static MediaPlayer? host;
    static SystemMediaTransportControls? controls;
    static Player? player;
    static Covers? covers;
    static DateTime lastTimeline;

    public static void Attach(Player p, Covers c)
    {
        try
        {
            if (player is not null) player.PropertyChanged -= Changed;
            (player, covers) = (p, c);
            if (controls is null)
            {
                host = new MediaPlayer();
                host.CommandManager.IsEnabled = false;
                controls = host.SystemMediaTransportControls;
                controls.IsPlayEnabled = controls.IsPauseEnabled = controls.IsNextEnabled = controls.IsPreviousEnabled = true;
                controls.ButtonPressed += (_, e) => Dispatcher.UIThread.Post(() => Pressed(e.Button));
                controls.PlaybackPositionChangeRequested += (_, e) => Dispatcher.UIThread.Post(() => player?.Seek(e.RequestedPlaybackPosition));
            }
            p.PropertyChanged += Changed;
            Show();
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ECHO media controls: {e.Message}"); // no overlay; everything else goes on
        }
    }

    static void Pressed(SystemMediaTransportControlsButton button)
    {
        if (player is not { } p) return;
        switch (button)
        {
            case SystemMediaTransportControlsButton.Play when !p.Playing:
            case SystemMediaTransportControlsButton.Pause when p.Playing:
                p.Toggle();
                break;
            case SystemMediaTransportControlsButton.Next:
                _ = p.Next();
                break;
            case SystemMediaTransportControlsButton.Previous:
                _ = p.Previous();
                break;
        }
    }

    static void Changed(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Player.Track)) Show();
        else if (e.PropertyName == nameof(Player.Playing)) Status();
        else if (e.PropertyName == nameof(Player.Position) && DateTime.UtcNow - lastTimeline > TimeSpan.FromSeconds(1)) Timeline();
    }

    static void Status()
    {
        if (controls is null || player is null) return;
        controls.PlaybackStatus = player.Track is null ? MediaPlaybackStatus.Closed
            : player.Playing ? MediaPlaybackStatus.Playing : MediaPlaybackStatus.Paused;
    }

    static void Timeline()
    {
        if (controls is null || player is null) return;
        lastTimeline = DateTime.UtcNow;
        controls.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties
        {
            StartTime = TimeSpan.Zero,
            EndTime = player.Duration,
            MinSeekTime = TimeSpan.Zero,
            MaxSeekTime = player.Duration,
            Position = player.Position,
        });
    }

    static async void Show()
    {
        try
        {
            if (controls is null || player is null) return;
            Status();
            var updater = controls.DisplayUpdater;
            if (player.Track is not { } t)
            {
                updater.ClearAll();
                updater.Update();
                return;
            }
            updater.Type = MediaPlaybackType.Music;
            updater.MusicProperties.Title = t.Title;
            updater.MusicProperties.Artist = t.Artist;
            updater.MusicProperties.AlbumTitle = t.Album.Title;
            updater.Thumbnail = null;
            if (covers is not null && await covers.Get(t.Cover, 300) is { } bitmap && player.Track == t)
            {
                using var png = new MemoryStream();
                bitmap.Save(png, new Avalonia.Media.Imaging.PngBitmapEncoderOptions());
                var stream = new InMemoryRandomAccessStream();
                var write = stream.AsStreamForWrite();
                await write.WriteAsync(png.ToArray());
                await write.FlushAsync();
                stream.Seek(0);
                updater.Thumbnail = RandomAccessStreamReference.CreateFromStream(stream);
            }
            updater.Update();
            Timeline();
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ECHO media controls: {e.Message}");
        }
    }
}
#endif
