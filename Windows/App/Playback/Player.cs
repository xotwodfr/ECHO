using System.Net;
using System.Text.Json.Nodes;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Echo.Playback;

/// The player as the app sees it (src/client/playback/controller.ts; Android's Playback.kt): the Queue
/// played through AudioOut, scrobbles at half the song or 4 minutes, ECHO's own play history, and the
/// queue that follows the user across devices (queueSync.ts). A token the server refuses stops it all
/// and clears the queue (REL-05).
public sealed partial class Player : ObservableObject, IDisposable
{
    const long ScrobbleMs = 4 * 60_000;
    const int SaveEveryMs = 15_000;
    const string Unreachable = "Can't reach the server.";

    readonly Api api;
    readonly Library library;
    readonly Func<AudioOut> makeOutput;
    readonly Func<Track, Task<string>> source;
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };
    readonly DispatcherTimer saveSoon = new() { Interval = TimeSpan.FromSeconds(2) };
    AudioOut? output;
    long queueBase;
    string scrobbled = "none";
    bool recorded;
    int sinceSave;

    public Player(Api api, Library library, Func<AudioOut> output, Func<Track, Task<string>>? source = null)
    {
        this.api = api;
        this.library = library;
        makeOutput = output;
        this.source = source ?? api.StreamUrl;
        tick.Tick += (_, _) => Tick();
        saveSoon.Tick += (_, _) =>
        {
            saveSoon.Stop();
            _ = SaveNow();
        };
    }

    public Queue Queue { get; private set; } = new();

    [ObservableProperty] public partial Track? Track { get; private set; }
    [ObservableProperty] public partial bool Playing { get; private set; }
    [ObservableProperty] public partial TimeSpan Position { get; private set; }
    [ObservableProperty] public partial TimeSpan Duration { get; private set; }
    /// 0…1 through the song.
    [ObservableProperty] public partial double Progress { get; private set; }
    /// A short message over the player (the web's toast).
    [ObservableProperty] public partial string? Notice { get; set; }

    /// Scrobbles to Navidrome (Settings → Playback).
    public bool Scrobble { get; set; } = true;
    /// Saves the queue to the server (false for the built-in fixtures).
    public bool Sync { get; set; } = true;

    /// The server refused the token: the window goes back to sign-in.
    public event Action? SignedOut;
    /// Next up or the context changed (the queue sheet).
    public event Action? QueueChanged;

    /// The position now, read from the output (the lyric field's clock; Position updates 4× a second).
    public TimeSpan PositionNow => output?.Position ?? Position;

    AudioOut Output
    {
        get
        {
            if (output is not null) return output;
            output = makeOutput();
            output.Ended += () => Dispatcher.UIThread.Post(() => _ = Ended());
            tick.Start();
            return output;
        }
    }

    public float Volume
    {
        get => output?.Volume ?? 1;
        set => Output.Volume = value;
    }

    public bool Muted
    {
        get => output?.Muted ?? false;
        set => Output.Muted = value;
    }

    // ---- commands ----

    public async Task PlayList(IReadOnlyList<Track> list, int index, PlayContext ctx)
    {
        if (list.Count == 0) return;
        Queue.PlayList(list, index, ctx);
        QueueChanged?.Invoke();
        await Start(Queue.Now!, play: true);
    }

    /// Shows a saved queue without playing (the fixtures; a restored queue waits for Play).
    public void Show(QueueState state, TimeSpan at)
    {
        Queue = Queue.FromState(state);
        Track = state.Now;
        Position = at;
        Duration = TimeSpan.FromMilliseconds(state.Now?.DurationMs ?? 0);
        QueueChanged?.Invoke();
    }

    public void Toggle()
    {
        if (Track is null) return;
        if (output is null || Position >= Duration && Duration > TimeSpan.Zero && !Playing)
        {
            _ = Start(Track, play: true, at: output is null ? Position : TimeSpan.Zero);
            return;
        }
        if (Playing) output.Pause();
        else output.Play();
        Playing = !Playing;
        Changed();
    }

    public async Task Next()
    {
        if (Queue.Advance(userSkip: true) is { } next) await Start(next, play: true);
    }

    /// Restart past 3 s, else the song before (the web's Previous).
    public async Task Previous()
    {
        if (PositionNow > TimeSpan.FromSeconds(3) || Queue.Back() is not { } before) Seek(TimeSpan.Zero);
        else await Start(before, play: true);
    }

    public void Seek(TimeSpan t)
    {
        if (t < TimeSpan.Zero) t = TimeSpan.Zero;
        output?.Seek(t);
        Position = t;
        Changed();
    }

    public void SetShuffle(bool on)
    {
        Queue.SetShuffle(on, Random.Shared);
        QueueChanged?.Invoke();
        Changed();
    }

    public void CycleRepeat()
    {
        Queue.Repeat = Queue.Repeat switch { Repeat.Off => Repeat.All, Repeat.All => Repeat.One, _ => Repeat.Off };
        QueueChanged?.Invoke();
    }

    /// "Play next" goes first in Next up; "Add to queue" goes last; with nothing playing, it plays.
    public Task PlayNext(Track t) => Enqueue(t, first: true);

    public Task AddToQueue(Track t) => Enqueue(t, first: false);

    async Task Enqueue(Track t, bool first)
    {
        if (Track is null)
        {
            await PlayList([t], 0, new PlayContext("search", null, t.Title));
            return;
        }
        if (first) Queue.PlayNext(t);
        else Queue.AddToQueue(t);
        Notice = first ? $"Playing “{t.Title}” next" : $"Added “{t.Title}” to the queue";
        QueueChanged?.Invoke();
        Changed();
    }

    public void Move(int from, int to) => Edit(() => Queue.Move(from, to));

    public void Remove(int upcoming) => Edit(() => Queue.Remove(upcoming));

    public void ClearUpcoming() => Edit(Queue.Clear);

    /// Plays an upcoming song now; what was before it in the list is skipped.
    public async Task JumpTo(int upcoming)
    {
        for (var i = 0; i < upcoming; i++) Queue.Remove(0);
        await Next();
    }

    void Edit(Action change)
    {
        change();
        QueueChanged?.Invoke();
        Changed();
    }

    /// Lets go of the audio device and the song's stream (a session ends; Windows locks open files).
    public void Dispose()
    {
        tick.Stop();
        saveSoon.Stop();
        output?.Dispose();
        output = null;
    }

    /// Signs this device out on the server too, then stops (Settings → Account).
    public async Task SignOut()
    {
        try
        {
            await api.SignOut();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { }
        Refused();
    }

    // ---- playing ----

    async Task Start(Track t, bool play, TimeSpan at = default)
    {
        Track = t;
        scrobbled = "none";
        recorded = false;
        Duration = TimeSpan.FromMilliseconds(t.DurationMs);
        Position = at;
        try
        {
            var url = await source(t);
            await Output.Open(url);
            if (at > TimeSpan.Zero) Output.Seek(at);
            if (play) Output.Play();
            Playing = play;
        }
        catch (ApiException e) when (e.SignedOut)
        {
            Refused();
            return;
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or IOException or InvalidOperationException or TaskCanceledException)
        {
            // A song that cannot be played is skipped, like the web (REL-02's last resort).
            if (Queue.Advance(userSkip: true) is { } next)
            {
                Notice = "This track could not be played. Skipped to the next.";
                await Start(next, play);
                return;
            }
            Notice = "This track could not be played.";
            Playing = false;
        }
        Changed();
    }

    async Task Ended()
    {
        if (Queue.Advance(userSkip: false) is { } next) await Start(next, play: true);
        else
        {
            Playing = false; // the end of the queue: it stays on the last song
            Changed();
        }
    }

    void Tick()
    {
        if (output is null) return;
        Position = output.Position;
        if (output.Duration > TimeSpan.Zero) Duration = output.Duration;
        Progress = Duration > TimeSpan.Zero ? Math.Clamp(Position / Duration, 0, 1) : 0;
        if (!Playing || Track is not { } t) return;
        var at = (long)Position.TotalMilliseconds;
        ScrobbleAt(t, at);
        Record(t, at);
        sinceSave += (int)tick.Interval.TotalMilliseconds;
        if (sinceSave >= SaveEveryMs)
        {
            sinceSave = 0;
            Changed();
        }
    }

    void ScrobbleAt(Track t, long at)
    {
        if (!Scrobble || !Sync) return;
        void Post(bool submission) => _ = Quietly(() =>
            api.Send(HttpMethod.Post, $"/navidrome/rest/scrobble?id={Uri.EscapeDataString(t.Id)}&submission={(submission ? "true" : "false")}"));
        if (scrobbled == "none")
        {
            scrobbled = "now";
            Post(false);
        }
        if (scrobbled == "now" && (at >= t.DurationMs / 2 || at >= ScrobbleMs))
        {
            scrobbled = "done";
            Post(true);
        }
    }

    /// ECHO's own history (mixes.ts): at the same point, songs of 30 s or more, Navidrome only.
    void Record(Track t, long at)
    {
        if (recorded || !Sync || t.Provider != "navidrome" || t.DurationMs < 30_000) return;
        if (at < t.DurationMs / 2 && at < ScrobbleMs) return;
        recorded = true;
        _ = Quietly(() => library.RecordPlay(t, Queue.Source));
    }

    static async Task Quietly(Func<Task> call)
    {
        try
        {
            await call();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException) { }
    }

    void Refused()
    {
        output?.Pause();
        Queue.Reset();
        Track = null;
        Playing = false;
        Position = TimeSpan.Zero;
        Progress = 0;
        queueBase = 0;
        QueueChanged?.Invoke();
        SignedOut?.Invoke();
    }

    // ---- the saved queue (queueSync.ts) ----

    void Changed()
    {
        if (!Sync) return;
        saveSoon.Stop();
        saveSoon.Start();
    }

    /// The queue from the server, shown paused, when nothing plays here yet.
    public async Task Restore()
    {
        if (!Sync) return;
        try
        {
            var saved = await api.Get("/me/queue");
            queueBase = saved["updatedAt"]?.GetValue<long>() ?? 0;
            var q = Json.From<QueueState>(saved["queue"]);
            if (q?.Now is null || q.Provider == "spotify" || Track is not null) return;
            Show(q, TimeSpan.FromMilliseconds(Json.SavedPositionMs(saved)));
        }
        catch (ApiException e) when (e.SignedOut)
        {
            Refused();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException or System.Text.Json.JsonException) { }
    }

    public async Task SaveNow()
    {
        if (!Sync) return;
        var body = new JsonObject
        {
            ["queue"] = Queue.Now is null ? null : Json.ToNode(Queue.ToState()),
            ["positionMs"] = (long)PositionNow.TotalMilliseconds,
            ["baseUpdatedAt"] = queueBase,
        };
        try
        {
            queueBase = (await api.Send(HttpMethod.Put, "/me/queue", body))["updatedAt"]?.GetValue<long>() ?? queueBase;
            if (Notice == Unreachable) Notice = null;
        }
        catch (ApiException e) when (e.SignedOut)
        {
            Refused();
        }
        catch (ApiException e) when (e.Status == HttpStatusCode.Conflict)
        {
            // Another device changed the queue: the one that is playing keeps its own.
            Notice = "Your queue changed on another device.";
            try
            {
                var newer = await api.Get("/me/queue");
                queueBase = newer["updatedAt"]?.GetValue<long>() ?? queueBase;
                if (!Playing && Json.From<QueueState>(newer["queue"]) is { Now: not null } q)
                {
                    output?.Pause();
                    output = null; // the restored song opens on Play
                    Show(q, TimeSpan.FromMilliseconds(Json.SavedPositionMs(newer)));
                }
            }
            catch (Exception x) when (x is HttpRequestException or ApiException or TaskCanceledException) { }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            Notice = Unreachable;
        }
    }
}
