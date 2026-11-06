using System.Net;
using System.Text.Json.Nodes;

namespace Echo;

// The signed-in user's Navidrome library through ECHO's proxy (src/client/library-navidrome.ts; Android's
// Library.kt): the albums A–Z in pages, and an album's tracks when it is opened. Navidrome refuses with
// HTTP 200 and `status: "failed"`: that is an error here (`subsonic.<code>`); not found (70) is null.
public sealed class Library(Api api)
{
    const int Page = 500;

    sealed record SubSong(string Id, string Title, string? Artist, string? ArtistId, string? Album, string? AlbumId,
        string? CoverArt, long? Duration, string? ContentType, string? Suffix);

    sealed record SubAlbum(string Id, string Name, string? Artist, string? CoverArt, List<SubSong>? Song);

    static string? Cover(string? id, int size) => id is null ? null : $"/api/v1/navidrome/cover/{Uri.EscapeDataString(id)}?size={size}";

    static Track TrackOf(SubSong s, SubAlbum a) => new($"navidrome:{s.Id}", s.Id, s.Title,
        [new ArtistRef(s.ArtistId, s.Artist ?? a.Artist ?? "")], new AlbumRef(a.Id, s.Album ?? a.Name, $"navidrome:{a.Id}"),
        (s.Duration ?? 0) * 1000, Cover(s.CoverArt ?? a.CoverArt, 600) is { } art ? [new Artwork(art)] : [],
        s.ContentType ?? (s.Suffix is null ? null : $"audio/{s.Suffix}"));

    static Album AlbumOf(SubAlbum a) => new(a.Id, a.Name, a.Artist ?? "", Cover(a.CoverArt, 300))
    {
        Tracks = (a.Song ?? []).Select(s => TrackOf(s, a)).ToList(),
    };

    async Task<JsonNode> Rest(string method, string query)
    {
        var r = (await api.Get($"/navidrome/rest/{method}?{query}"))["subsonic-response"]
            ?? throw new ApiException(HttpStatusCode.BadGateway, "no subsonic-response");
        if (Api.Text(r["status"]) == "failed") throw new ApiException(HttpStatusCode.OK, $"subsonic.{Api.Text(r["error"]?["code"])}");
        return r;
    }

    /// Every album, A–Z.
    public async Task<IReadOnlyList<Album>> Albums()
    {
        var all = new List<Album>();
        for (var offset = 0; ; offset += Page)
        {
            var page = Json.From<List<SubAlbum>>((await Rest("getAlbumList2", $"type=alphabeticalByName&size={Page}&offset={offset}"))["albumList2"]?["album"]) ?? [];
            all.AddRange(page.Select(AlbumOf));
            if (page.Count < Page) return all;
        }
    }

    /// An album with its tracks; null when Navidrome has no such album.
    public async Task<Album?> Album(string id)
    {
        try
        {
            return Json.From<SubAlbum>((await Rest("getAlbum", $"id={Uri.EscapeDataString(id)}"))["album"]) is { } a ? AlbumOf(a) : null;
        }
        catch (ApiException e) when (e.Code == "subsonic.70")
        {
            return null;
        }
    }
}
