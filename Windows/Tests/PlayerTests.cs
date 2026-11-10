using System.Net;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Echo.Playback;

namespace Echo.Tests;

[Collection("audio")]
public class PlayerTests
{
    static readonly PlayContext Ctx = new("album", "a", "Album");

    [AvaloniaFact]
    public async Task A401StopsPlaybackAndSignsOut()
    {
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.Unauthorized, """{"error":"unauthenticated"}"""));
        var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true));
        var signedOut = false;
        player.SignedOut += () => signedOut = true;

        await player.PlayList(QueueTests.Album(3), 0, Ctx);

        Assert.True(signedOut);
        Assert.False(player.Playing);
        Assert.Null(player.Track);
        Assert.Empty(player.Queue.Upcoming);
    }

    [AvaloniaFact]
    public async Task AnOfflineServerDoesNotSkipThroughTheQueue()
    {
        // Every song fails the same way when the server is gone: say so, and stay on the song.
        var api = new Api("https://echo.test", new Unreachable());
        using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true));
        await player.PlayList(QueueTests.Album(3), 0, Ctx);
        Assert.Equal("a0", player.Track?.Id);
        Assert.Equal(2, player.Queue.Upcoming.Count);
        Assert.False(player.Playing);
        Assert.Equal("Can't reach the server.", player.Notice);
    }

    [AvaloniaFact]
    public async Task PlayAndPauseAskForAStateNotAToggle()
    {
        // Windows' media controls send Play or Pause: Pause twice stays paused.
        var wav = Path.Combine(Path.GetTempPath(), $"echo-state-{Guid.NewGuid():N}.wav");
        File.WriteAllBytes(wav, Wav.Silence(seconds: 5));
        try
        {
            var api = new Api("https://echo.test", new Unreachable());
            using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true), _ => Task.FromResult(wav)) { Sync = false };
            await player.PlayList(QueueTests.Album(2), 0, Ctx);
            player.Play();
            Assert.True(player.Playing);
            player.Pause();
            player.Pause();
            Assert.False(player.Playing);
            player.Play();
            Assert.True(player.Playing);
        }
        finally
        {
            File.Delete(wav);
        }
    }

    [AvaloniaFact]
    public async Task PlayAfterTheServerWasUnreachableAsksAgain()
    {
        var server = new Unreachable();
        var api = new Api("https://echo.test", server);
        using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true)) { Sync = false };
        await player.PlayList(QueueTests.Album(3), 0, Ctx);
        Assert.Equal(1, server.Asked);

        player.Toggle();
        for (var i = 0; i < 100 && server.Asked < 2; i++) await Task.Delay(10);
        Assert.Equal(2, server.Asked);
        Assert.False(player.Playing);
    }

    [AvaloniaFact]
    public async Task AServerErrorDoesNotSkipThroughTheQueue()
    {
        // ECHO up, Navidrome down: every song answers 502. That is the server, not the song.
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.BadGateway, """{"error":"upstream"}"""));
        using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true));
        await player.PlayList(QueueTests.Album(3), 0, Ctx);
        Assert.Equal("a0", player.Track?.Id);
        Assert.Equal(2, player.Queue.Upcoming.Count);
        Assert.False(player.Playing);
        Assert.Equal("Can't reach the server.", player.Notice);
    }

    [AvaloniaFact]
    public async Task RepeatAllStopsWhenNoSongInTheQueuePlays()
    {
        var junk = Path.Combine(Path.GetTempPath(), $"echo-junk-{Guid.NewGuid():N}.flac");
        File.WriteAllText(junk, "this is not audio");
        try
        {
            var api = new Api("https://echo.test", new Unreachable());
            using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true), _ => Task.FromResult(junk)) { Sync = false };
            player.CycleRepeat();
            Assert.Equal(Repeat.All, player.Queue.Repeat);
            var play = player.PlayList(QueueTests.Album(3), 0, Ctx);
            Assert.Same(play, await Task.WhenAny(play, Task.Delay(5000)));
            Assert.False(player.Playing);
            Assert.Equal("This track could not be played.", player.Notice);
        }
        finally
        {
            File.Delete(junk);
        }
    }

    [AvaloniaFact]
    public async Task ASongThatCannotBeDecodedIsSkipped()
    {
        var junk = Path.Combine(Path.GetTempPath(), $"echo-junk-{Guid.NewGuid():N}.flac");
        var wav = Path.Combine(Path.GetTempPath(), $"echo-ok-{Guid.NewGuid():N}.wav");
        File.WriteAllText(junk, "this is not audio");
        File.WriteAllBytes(wav, Wav.Silence(seconds: 5));
        try
        {
            var api = new Api("https://echo.test", new Unreachable());
            using (var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true),
                       t => Task.FromResult(t.Id == "a0" ? junk : wav)) { Sync = false })
            {
                await player.PlayList(QueueTests.Album(2), 0, Ctx);
                Assert.Equal("a1", player.Track?.Id);
                Assert.True(player.Playing);
                Assert.Equal("This track could not be played. Skipped to the next.", player.Notice);
            }
        }
        finally
        {
            File.Delete(junk);
            File.Delete(wav);
        }
    }

    [AvaloniaFact]
    public async Task ALongQueueIsTrimmedToFitTheServer()
    {
        // The server takes 64 KB at most: a whole library's queue is cut as the web cuts it (trimQueue).
        var server = new QueueServer();
        var api = new Api("https://echo.test", server);
        using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true));
        var songs = QueueTests.Album(3000);
        player.Show(new QueueState(Now: songs[100], Context: songs.Skip(101).ToList(), History: songs.Take(100).ToList(), ContextSource: Ctx), TimeSpan.Zero);

        await player.SaveNow();

        var saved = Json.From<QueueState>(server.Saved?["queue"]);
        Assert.Equal("a100", saved?.Now?.Id);
        Assert.Equal("a101", saved?.Context[0].Id);
        Assert.Equal(20, saved?.History.Count);
        Assert.Null(player.Notice);
    }

    [AvaloniaFact]
    public async Task AQueueTheServerHoldsIsNotSentAgain()
    {
        // The save every 15 s, a pause, a seek: the position alone (PATCH), until the queue changes.
        var server = new QueueServer();
        var api = new Api("https://echo.test", server);
        using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true));
        var songs = QueueTests.Album(3);
        player.Show(new QueueState(Now: songs[0], Context: [songs[1]], ContextSource: Ctx), TimeSpan.FromSeconds(7));

        await player.SaveNow();
        await player.SaveNow();
        Assert.Equal(["PUT", "PATCH"], server.Methods);
        Assert.Null(server.Saved?["queue"]);
        Assert.Equal(7000, server.Saved?["positionMs"]?.GetValue<long>());
        Assert.Equal(5, server.Saved?["baseUpdatedAt"]?.GetValue<long>());

        player.Show(new QueueState(Now: songs[1], Context: [songs[2]], ContextSource: Ctx), TimeSpan.Zero);
        await player.SaveNow();
        Assert.Equal("PUT", server.Methods[^1]);

        // A server without PATCH (an older one), or with no queue saved: the whole queue, as before.
        server.NoPatch = true;
        await player.SaveNow();
        Assert.Equal(["PATCH", "PUT"], server.Methods[^2..]);
        Assert.Equal("a1", Json.From<QueueState>(server.Saved?["queue"])?.Now?.Id);
    }

    [Fact]
    public async Task AReadThatFailedOnTheWayIsAskedAgainAndAWriteIsNot()
    {
        var flaky = new Flaky(fails: 2);
        var api = new Api("https://echo.test", flaky);
        Assert.Equal(1, (await api.Get("/me"))["ok"]?.GetValue<int>());
        Assert.Equal(3, flaky.Asked);

        flaky = new Flaky(fails: 3); // twice at most
        await Assert.ThrowsAsync<HttpRequestException>(() => new Api("https://echo.test", flaky).Get("/me"));
        Assert.Equal(3, flaky.Asked);

        flaky = new Flaky(fails: 1);
        await Assert.ThrowsAsync<HttpRequestException>(() => new Api("https://echo.test", flaky).Send(HttpMethod.Post, "/me", new System.Text.Json.Nodes.JsonObject()));
        Assert.Equal(1, flaky.Asked);

        Assert.Equal(150, Api.RetryDelay(0, 0).TotalMilliseconds);
        Assert.Equal(1350, Api.RetryDelay(1, 1).TotalMilliseconds);
    }

    [AvaloniaFact]
    public async Task AQueueFromAnotherDeviceOpensOnTheSameAudioOutput()
    {
        // Paused, and another device saved a newer queue: it shows, and Play opens its song, without
        // leaving the old output (an audio device) open behind it.
        var wav = Path.Combine(Path.GetTempPath(), $"echo-conflict-{Guid.NewGuid():N}.wav");
        File.WriteAllBytes(wav, Wav.Silence(seconds: 5));
        try
        {
            var other = QueueTests.Album(2, "b");
            var api = new Api("https://echo.test", new NewerElsewhere(new QueueState(Now: other[0], Context: [other[1]], ContextSource: Ctx)));
            var made = 0;
            using var player = new Player(api, new Library(api), () =>
            {
                made++;
                return new AudioOut(nullDevice: true);
            }, _ => Task.FromResult(wav));
            await player.PlayList(QueueTests.Album(3), 0, Ctx);
            player.Toggle();
            await player.SaveNow();
            Assert.Equal("b0", player.Track?.Id);

            player.Toggle();
            for (var i = 0; i < 100 && !player.Playing; i++) await Task.Delay(10);
            Assert.True(player.Playing);
            Assert.Equal(1, made);
        }
        finally
        {
            File.Delete(wav);
        }
    }

    [AvaloniaFact]
    public async Task AnOfflineServerKeepsTheSongPlaying()
    {
        var wav = Path.Combine(Path.GetTempPath(), $"echo-offline-{Guid.NewGuid():N}.wav");
        File.WriteAllBytes(wav, Wav.Silence(seconds: 5));
        try
        {
            var api = new Api("https://echo.test", new Unreachable());
            using var player = new Player(api, new Library(api), () => new AudioOut(nullDevice: true), _ => Task.FromResult(wav));
            await player.PlayList(QueueTests.Album(3), 0, Ctx);
            await player.SaveNow(); // the queue PUT: the server cannot be reached

            Assert.True(player.Playing);
            Assert.Equal("Can't reach the server.", player.Notice);
        }
        finally
        {
            File.Delete(wav);
        }
    }
}

/// The server's queue endpoint: refuses a body over 64 KB as ECHO does (http.ts BODY_LIMIT), else keeps it.
sealed class QueueServer : HttpMessageHandler
{
    public System.Text.Json.Nodes.JsonNode? Saved { get; private set; }
    public List<string> Methods { get; } = [];
    public bool NoPatch { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        Methods.Add(request.Method.Method);
        if (NoPatch && request.Method == HttpMethod.Patch)
            return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("""{"error":"no_queue"}""") };
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(token);
        if (System.Text.Encoding.UTF8.GetByteCount(body) > 64 * 1024)
            return new HttpResponseMessage((HttpStatusCode)413) { Content = new StringContent("""{"error":"too_large"}""") };
        Saved = System.Text.Json.Nodes.JsonNode.Parse(body);
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"updatedAt":5}""") };
    }
}

/// A connection that fails `fails` times, then answers.
sealed class Flaky(int fails) : HttpMessageHandler
{
    public int Asked { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
        ++Asked <= fails
            ? Task.FromException<HttpResponseMessage>(new HttpRequestException("no route"))
            : Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"ok":1}""") });
}

/// Another device saved a newer queue: a save answers 409, a read answers with that queue.
sealed class NewerElsewhere(QueueState newer) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        var body = request.Method == HttpMethod.Put
            ? new HttpResponseMessage(HttpStatusCode.Conflict) { Content = new StringContent("""{"error":"conflict"}""") }
            : new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(new System.Text.Json.Nodes.JsonObject
                {
                    ["queue"] = Json.ToNode(newer), ["positionMs"] = 0, ["updatedAt"] = 9,
                }.ToJsonString()),
            };
        return Task.FromResult(body);
    }
}

/// No server: every request fails as a network error.
sealed class Unreachable : HttpMessageHandler
{
    public int Asked;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        Interlocked.Increment(ref Asked);
        throw new HttpRequestException("unreachable");
    }
}

static class Wav
{
    public static byte[] Silence(double seconds, int rate = 44_100)
    {
        var frames = (int)(seconds * rate);
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("RIFF"u8);
        w.Write(36 + frames * 4);
        w.Write("WAVEfmt "u8);
        w.Write(16);
        w.Write((short)1);
        w.Write((short)2);
        w.Write(rate);
        w.Write(rate * 4);
        w.Write((short)4);
        w.Write((short)16);
        w.Write("data"u8);
        w.Write(frames * 4);
        w.Write(new byte[frames * 4]);
        return ms.ToArray();
    }
}
