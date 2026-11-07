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

/// No server: every request fails as a network error.
sealed class Unreachable : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
        throw new HttpRequestException("unreachable");
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
