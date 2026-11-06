using System.Net;
using System.Text.Json.Nodes;

namespace Echo.Tests;

public class LibraryTests
{
    const string GetAlbum = """
        {"subsonic-response":{"status":"ok","album":{"id":"al-1","name":"Neon Tide","artist":"Halcyon Drive","artistId":"ar-1",
          "year":2024,"coverArt":"al-1","song":[
            {"id":"s1","title":"Afterglow","artist":"Halcyon Drive","artistId":"ar-1","album":"Neon Tide","albumId":"al-1",
             "duration":214,"suffix":"flac","contentType":"audio/flac","isrc":"USRC17607839"},
            {"id":"s2","title":"Night Swim","artist":"Halcyon Drive","albumId":"al-1","duration":187,
             "suffix":"m4a","contentType":"audio/mp4","isrc":["GBAYE0601498","GBAYE0601499"]}]}}}
        """;

    [Fact]
    public async Task ASubsonicAlbumBecomesTracksWithCoverAndIsrc()
    {
        var library = new Library(new Api("https://echo.test", new Answer(HttpStatusCode.OK, GetAlbum)));
        var album = await library.Album("al-1");

        Assert.NotNull(album);
        Assert.Equal("navidrome:al-1", album.Key);
        Assert.Equal(2, album.Tracks.Count);
        var first = album.Tracks[0];
        Assert.Equal("navidrome:s1", first.Key);
        Assert.Equal("/api/v1/navidrome/cover/al-1?size=600", first.Cover);
        Assert.Equal("USRC17607839", first.Isrc);
        Assert.Equal(214_000, first.DurationMs);
        Assert.Equal("navidrome:al-1", first.Album.Key);
        Assert.Equal("GBAYE0601498", album.Tracks[1].Isrc); // OpenSubsonic: an array, the first one
    }

    [Theory]
    [InlineData("flac", true)]
    [InlineData("Mp3", true)]
    [InlineData("wav", true)]
    [InlineData("audio/flac", true)]
    [InlineData("audio/mpeg", true)]
    [InlineData("audio/x-wav", true)]
    [InlineData("m4a", false)]
    [InlineData("audio/mp4", false)]
    [InlineData("opus", false)]
    [InlineData("ogg", false)]
    [InlineData("wma", false)]
    [InlineData("aac", false)]
    [InlineData(null, false)]
    public void OnlyFlacMp3AndWavStreamRaw(string? type, bool raw) => Assert.Equal(raw, StreamFormat.PlaysRaw(type));

    [Fact]
    public void ASavedPositionIsAnyJsonNumberTheWebsFractionsToo()
    {
        Assert.Equal(8341, Json.SavedPositionMs(JsonNode.Parse("""{"positionMs":8341.517}""")));
        Assert.Equal(8341, Json.SavedPositionMs(JsonNode.Parse("""{"positionMs":8341}""")));
        Assert.Equal(0, Json.SavedPositionMs(JsonNode.Parse("""{"positionMs":null}""")));
        Assert.Equal(0, Json.SavedPositionMs(JsonNode.Parse("{}")));
    }

    [Fact]
    public void ASavedQueueWritesItsEmptyListsAndProviderWhichTheWebReads()
    {
        var q = Json.ToNode(new QueueState())!.AsObject();
        Assert.Equal("[]", q["nextUp"]!.ToJsonString());
        Assert.Equal("\"navidrome\"", q["provider"]!.ToJsonString());
    }
}

public class ApiTests
{
    [Fact]
    public async Task TheTokenGoesOnlyToTheServer()
    {
        var answer = new Answer(System.Net.HttpStatusCode.OK, "x");
        var api = new Api("https://echo.test", answer) { Token = "echo_dt_secret" };
        await api.GetStream("/api/v1/navidrome/cover/al-1?size=300");
        await api.GetStream("https://elsewhere.example/cover.jpg");
        Assert.Equal("echo_dt_secret", answer.Requests[0].Headers.Authorization?.Parameter);
        Assert.Null(answer.Requests[1].Headers.Authorization); // a cover URL from anywhere else gets no token
    }
}
