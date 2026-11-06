using System.Net;
using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Echo.Ui;

namespace Echo.Tests;

public class LibraryViewTests
{
    [AvaloniaFact]
    public void AnAlbumWithoutCoverShowsItsTitleSquare()
    {
        var cover = new CoverImage { Width = 200, Height = 200, Fallback = "Neon Tide" };
        var window = new Window { Width = 200, Height = 200, Background = Avalonia.Media.Brushes.Black, Content = cover };
        window.Show();
        using var frame = window.CaptureRenderedFrame()!;
        // The square is Surface1 (#15151C), not empty, and the title is set in it, top left (DS §8).
        Assert.Equal((0x15, 0x15, 0x1C), Pixel(frame, 190, 190));
        Assert.True(Enumerable.Range(16, 60).Any(x => Enumerable.Range(16, 40).Any(y => Pixel(frame, x, y).R > 0x40)), "no title in the square");
    }

    [AvaloniaFact]
    public void TheSidebarListsThePlaylists()
    {
        var api = new Api("https://echo.test", new Routes
        {
            ["getPlaylists"] = """{"subsonic-response":{"status":"ok","playlists":{"playlist":[{"id":"p1","name":"Late drive","songCount":12}]}}}""",
        });
        var window = new Window { Width = 1280, Height = 800, Content = new Shell(Session.ForServer(api)) };
        window.Show();
        for (var i = 0; i < 5; i++) Dispatcher.UIThread.RunJobs();
        Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Late drive");
    }

    static readonly TrackRef Ref = new("al-1-t1", "Harbour Lights 1", "Lowfield", "ar-1", "Harbour Lights", "al-1", 200_000,
        "/api/v1/navidrome/cover/al-1?size=600");

    [Fact]
    public void AHistorySongPlaysAsTheNavidromeTrackItWas()
    {
        var t = Ref.ToTrack();
        Assert.Equal("navidrome:al-1-t1", t.Key);
        Assert.Equal("navidrome", t.Provider);
        Assert.Equal("Lowfield", Assert.Single(t.Artists).Name);
        Assert.Equal("navidrome:al-1", t.Album.Key);
        Assert.Equal("/api/v1/navidrome/cover/al-1?size=600", Assert.Single(t.Artwork!).Url);
        Assert.Empty((Ref with { Cover = null }).ToTrack().Artwork!);
    }

    [Fact]
    public void APlaySaysItsProviderAndWhatItWasPlayedFrom()
    {
        var body = Library.PlayBody(Ref.ToTrack(), new PlayContext("album", "al-1", "Harbour Lights"));
        // The server keeps only Navidrome songs: the default provider must be in the JSON.
        Assert.Equal("navidrome", (string?)body["track"]!["provider"]);
        Assert.Equal("Lowfield", (string?)body["track"]!["artists"]![0]!["name"]);
        Assert.Equal("al-1", (string?)body["context"]!["id"]);
        Assert.Null(Library.PlayBody(Ref.ToTrack(), null)["context"]);
    }

    [Fact]
    public void MixesReadAsTheServerSendsThem()
    {
        var mix = Json.From<Mix>(JsonNode.Parse("""
            {"id":"daily-1","kind":"daily","title":"Daily Mix 1","subtitle":"Lowfield and more",
             "tracks":[{"id":"x","title":"X","artist":"Lowfield","album":"A","durationMs":1000}]}
            """))!;
        Assert.Equal("x", Assert.Single(mix.Tracks).ToTrack().Id);
    }

    static (int R, int G, int B) Pixel(WriteableBitmap bitmap, int x, int y)
    {
        using var fb = bitmap.Lock();
        unsafe
        {
            var p = (byte*)fb.Address + y * fb.RowBytes + x * 4;
            return fb.Format == Avalonia.Platform.PixelFormat.Rgba8888 ? (p[0], p[1], p[2]) : (p[2], p[1], p[0]);
        }
    }
}

/// Answers by the first route the request's path contains; anything else is 404.
sealed class Routes : HttpMessageHandler, System.Collections.IEnumerable
{
    readonly List<(string Part, string Json)> routes = [];

    public string this[string part] { set => routes.Add((part, value)); }

    public System.Collections.IEnumerator GetEnumerator() => routes.GetEnumerator();

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        var path = request.RequestUri!.PathAndQuery;
        foreach (var (part, json) in routes)
            if (path.Contains(part)) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("""{"error":"not_found"}""") });
    }
}
