using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using Echo.Playback;

namespace Echo;

// The lyrics loader (src/client/lyrics/loader.ts; LYRICS_INTEGRATION.md §6; Android's Lyrics.kt): follows
// the current track, asks the server 250 ms after a change, drops answers for any track but the current
// one, gives up at 6 s while still taking a late answer, and warms the server's cache for the next.

public enum LyricsStatus { Idle, Waiting, Ready, Missing }

public sealed partial class Lyrics(Api api, Func<TimeSpan, CancellationToken, Task>? wait = null) : ObservableObject
{
    static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(250);
    static readonly TimeSpan GiveUp = TimeSpan.FromSeconds(6);
    static readonly TimeSpan Prefetch = TimeSpan.FromSeconds(2);

    readonly Func<TimeSpan, CancellationToken, Task> wait = wait ?? Task.Delay;
    CancellationTokenSource? job;

    [ObservableProperty] public partial LyricsStatus Status { get; private set; }
    [ObservableProperty] public partial LyricsDoc? Doc { get; private set; }
    public string? TrackKey { get; private set; }
    /// This track's offset as the web saved it (`/me/tracks/{key}/override`), ms.
    public long OffsetMs { get; private set; }

    public static string Query(Track t)
    {
        static string E(string s) => Uri.EscapeDataString(s);
        var artist = t.Artists.Count > 0 ? t.Artists[0].Name : "";
        var q = $"trackKey={E(t.Key)}&title={E(t.Title)}&artist={E(artist)}&album={E(t.Album.Title)}&durationMs={t.DurationMs}";
        return $"/lyrics?{q}{(t.Isrc is { } isrc ? $"&isrc={E(isrc)}" : "")}";
    }

    /// Loads each new track the player plays.
    public void Follow(Player player) => player.PropertyChanged += (_, e) =>
    {
        if (e.PropertyName == nameof(Player.Track) && player.Track?.Key != TrackKey)
            _ = Load(player.Track, player.Queue.Upcoming.FirstOrDefault());
    };

    public async Task Load(Track? track, Track? next = null)
    {
        job?.Cancel();
        if (track is null)
        {
            (TrackKey, Status, Doc, OffsetMs) = (null, LyricsStatus.Idle, null, 0);
            return;
        }
        var cts = job = new CancellationTokenSource();
        (TrackKey, Status, Doc, OffsetMs) = (track.Key, LyricsStatus.Waiting, null, 0);
        _ = GiveUpLater(track.Key, cts.Token);
        if (next is not null && track.DurationMs - Prefetch.TotalMilliseconds >= 20_000) _ = Warm(next, cts.Token);
        try
        {
            await wait(Debounce, cts.Token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        LyricsDoc? doc = null;
        long offset = 0;
        try
        {
            var answer = await api.Get(Query(track));
            doc = Json.From<LyricsDoc>(answer["doc"]);
            offset = answer["override"]?["offsetMs"]?.GetValue<long>() ?? 0;
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or JsonException or TaskCanceledException or InvalidOperationException) { }
        // A late answer for a track that is no longer playing is dropped (the server cached it).
        if (TrackKey != track.Key) return;
        (Doc, OffsetMs, Status) = (doc, offset, doc is null ? LyricsStatus.Missing : LyricsStatus.Ready);
    }

    async Task GiveUpLater(string key, CancellationToken token)
    {
        try
        {
            await wait(GiveUp, token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        if (TrackKey == key && Status == LyricsStatus.Waiting) Status = LyricsStatus.Missing;
    }

    async Task Warm(Track next, CancellationToken token)
    {
        try
        {
            await wait(Prefetch, token);
            await api.Get(Query(next));
        }
        catch (Exception e) when (e is OperationCanceledException or ApiException or HttpRequestException) { }
    }
}
