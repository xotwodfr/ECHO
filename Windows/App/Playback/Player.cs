using Avalonia.Threading;

namespace Echo.Playback;

/// What plays: a list (an album) from a song on, through AudioOut; the list goes on and stops after its
/// last song. A refused token signs out; no server says so and stays on the song.
public sealed class Player : IDisposable
{
    readonly Api api;
    readonly Func<AudioOut> makeOutput;
    readonly Func<Track, Task<string>> source;
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };
    AudioOut? output;
    IReadOnlyList<Track> list = [];
    int index;

    public Player(Api api, Func<AudioOut> output, Func<Track, Task<string>>? source = null)
    {
        this.api = api;
        makeOutput = output;
        this.source = source ?? api.StreamUrl;
        tick.Tick += (_, _) => Changed?.Invoke();
    }

    public Track? Track { get; private set; }
    public bool Playing { get; private set; }
    public string? Notice { get; private set; }
    public TimeSpan Position => output?.Position ?? TimeSpan.Zero;
    public TimeSpan Duration => output?.Duration is { } d && d > TimeSpan.Zero ? d : TimeSpan.FromMilliseconds(Track?.DurationMs ?? 0);

    /// Something changed: the song, playing, the position (4× a second while there is a song).
    public event Action? Changed;

    /// The server refused the token: back to sign-in.
    public event Action? SignedOut;

    AudioOut Output
    {
        get
        {
            if (output is not null) return output;
            output = makeOutput();
            output.Ended += () => Dispatcher.UIThread.Post(() => _ = Next());
            tick.Start();
            return output;
        }
    }

    public async Task Play(IReadOnlyList<Track> tracks, int at)
    {
        if (tracks.Count == 0) return;
        (list, index) = (tracks, Math.Clamp(at, 0, tracks.Count - 1));
        Track = list[index];
        Notice = null;
        try
        {
            await Output.Open(await source(Track));
            Output.Play();
            Playing = true;
        }
        catch (ApiException e) when (e.SignedOut)
        {
            Stop();
            SignedOut?.Invoke();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            Playing = false;
            Notice = "Can't reach the server.";
        }
        catch (Exception)
        {
            // A song that cannot be played (refused, or a file the decoder cannot read) is skipped.
            Playing = false;
            Notice = "This track could not be played.";
            if (index + 1 < list.Count)
            {
                await Play(list, index + 1);
                return;
            }
        }
        Changed?.Invoke();
    }

    public void Toggle()
    {
        if (output is null || Track is null) return;
        if (Playing) output.Pause();
        else output.Play();
        Playing = !Playing;
        Changed?.Invoke();
    }

    /// The next song, or nothing after the last (it stops there).
    public async Task Next()
    {
        if (index + 1 < list.Count) await Play(list, index + 1);
        else if (Playing)
        {
            output?.Pause();
            Playing = false;
            Changed?.Invoke();
        }
    }

    /// Restart past 3 s, else the song before.
    public async Task Previous()
    {
        if (Position > TimeSpan.FromSeconds(3) || index == 0) output?.Seek(TimeSpan.Zero);
        else await Play(list, index - 1);
    }

    /// Signs this device out on the server too, then stops.
    public async Task SignOut()
    {
        try
        {
            await api.SignOut();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { }
        Stop();
        SignedOut?.Invoke();
    }

    void Stop()
    {
        output?.Pause();
        (Track, Playing, list, index) = (null, false, [], 0);
        Changed?.Invoke();
    }

    public void Dispose()
    {
        tick.Stop();
        output?.Dispose();
        output = null;
    }
}
