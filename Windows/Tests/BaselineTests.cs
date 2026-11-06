using System.Net;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Echo.Playback;
using Echo.Ui;

namespace Echo.Tests;

public class BaselineTests
{
    const string GetAlbum = """
        {"subsonic-response":{"status":"ok","album":{"id":"al-1","name":"Neon Tide","artist":"Halcyon Drive","coverArt":"al-1","song":[
          {"id":"s1","title":"Afterglow","artist":"Halcyon Drive","albumId":"al-1","duration":214,"suffix":"flac","contentType":"audio/flac"},
          {"id":"s2","title":"Night Swim","artist":"Halcyon Drive","albumId":"al-1","duration":187,"suffix":"m4a","contentType":"audio/mp4"}]}}}
        """;

    [AvaloniaFact]
    public void TheWindowOpens()
    {
        var window = new MainWindow();
        window.Show();
        Assert.Equal("ECHO", window.Title);
        Assert.Equal(1024, window.MinWidth);
    }

    [AvaloniaFact]
    public async Task SignInShowsTheCodeFieldOnlyAfterTheServerAsks()
    {
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.Unauthorized, """{"error":"totp_required"}"""));
        var view = new SignInView(api, _ => { });
        new Window { Content = view }.Show();
        Assert.False(view.CodeVisible);
        view.Username = "ada";
        view.Password = "secret";
        await view.Submit();
        Assert.True(view.CodeVisible);
    }

    [Fact]
    public async Task AnAlbumBecomesItsTracks()
    {
        var album = await new Library(new Api("https://echo.test", new Answer(HttpStatusCode.OK, GetAlbum))).Album("al-1");
        Assert.NotNull(album);
        Assert.Equal(["Afterglow", "Night Swim"], album.Tracks.Select(t => t.Title));
        Assert.Equal(214_000, album.Tracks[0].DurationMs);
        Assert.Equal("audio/mp4", album.Tracks[1].ContentType);
    }

    [Theory]
    [InlineData("flac", true)]
    [InlineData("audio/mpeg", true)]
    [InlineData("audio/x-wav", true)]
    [InlineData("audio/mp4", false)]
    [InlineData("opus", false)]
    [InlineData(null, false)]
    public void OnlyFlacMp3AndWavStreamRaw(string? type, bool raw) => Assert.Equal(raw, StreamFormat.PlaysRaw(type));

    [Fact]
    public async Task TheTokenGoesOnlyToTheServer()
    {
        var answer = new Answer(HttpStatusCode.OK, "x");
        var api = new Api("https://echo.test", answer) { Token = "echo_dt_secret" };
        await api.GetStream("/api/v1/navidrome/cover/al-1?size=300");
        await api.GetStream("https://elsewhere.example/cover.jpg");
        Assert.Equal("echo_dt_secret", answer.Requests[0].Headers.Authorization?.Parameter);
        Assert.Null(answer.Requests[1].Headers.Authorization);
    }
}

// The tests that make an audio engine run one at a time: two SoundFlow engines alive at once interfere.
[Collection("audio")]
public class PlayerTests
{
    static IReadOnlyList<Track> Album(int n) => Enumerable.Range(0, n)
        .Select(i => new Track($"navidrome:a{i}", $"a{i}", $"Song {i}", [new ArtistRef(null, "Artist")], new AlbumRef("a", "Album", "navidrome:a"), 2000, ContentType: "audio/wav"))
        .ToList();

    [AvaloniaFact]
    public async Task TheAlbumGoesOnAndStopsAfterItsLastSong()
    {
        var wav = Wav.Silence(1);
        try
        {
            var api = new Api("https://echo.test", new Answer(HttpStatusCode.OK, "{}"));
            using var player = new Player(api, () => new AudioOut(nullDevice: true), _ => Task.FromResult(wav));
            var album = Album(2);
            await player.Play(album, 0);
            Assert.Equal("a0", player.Track?.Id);
            Assert.True(player.Playing);
            await player.Next();
            Assert.Equal("a1", player.Track?.Id);
            await player.Next(); // the last song: nothing after it, so it stops there
            Assert.Equal("a1", player.Track?.Id);
            Assert.False(player.Playing);
            player.Toggle(); // plays on
            Assert.True(player.Playing);
            player.Toggle(); // and pauses, holding its place
            Assert.False(player.Playing);
            var at = player.Position;
            await Task.Delay(200);
            Assert.Equal(at, player.Position);
        }
        finally
        {
            File.Delete(wav);
        }
    }
}

/// An HTTP answer for every request, and the requests it got.
sealed class Answer(HttpStatusCode status, string json) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        Requests.Add(request);
        return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(json) });
    }
}

static class Wav
{
    /// A temp file of `seconds` of 16-bit stereo silence.
    public static string Silence(double seconds, int rate = 44_100)
    {
        var frames = (int)(seconds * rate);
        var path = Path.Combine(Path.GetTempPath(), $"echo-{Guid.NewGuid():N}.wav");
        using var w = new BinaryWriter(File.Create(path));
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
        return path;
    }
}
