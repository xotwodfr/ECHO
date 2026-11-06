using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Echo;

// The signed-in user's Navidrome library through ECHO's proxy (src/client/library-navidrome.ts; Android's
// Library.kt), and ECHO's own history: the album list in pages, an album's tracks when it is opened,
// the rest on demand. Navidrome refuses with HTTP 200 and `status: "failed"`: that is an error here
// (`subsonic.<code>`), never an empty answer; not found (70) is an answer, null.

public enum AlbumSort { Newest, AZ, Year, Frequent }

/// Home's shelves (getAlbumList2's kinds).
public enum AlbumList { Recent, Newest, Frequent, Random }

public enum StarKind { Track, Album, Artist }

public static class AlbumSorts
{
    public static string Label(this AlbumSort s) => s switch
    {
        AlbumSort.Newest => "Recently added",
        AlbumSort.AZ => "A–Z",
        AlbumSort.Year => "Year",
        _ => "Most played",
    };

    internal static string Api(this AlbumSort s) => s switch
    {
        AlbumSort.Newest => "newest",
        AlbumSort.AZ => "alphabeticalByName",
        AlbumSort.Year => "byYear",
        _ => "frequent",
    };
}

public sealed partial class Library(Api api)
{
    const int Page = 500;

    sealed record SubSong(string Id, string Title, string? Artist, string? ArtistId, string? Album, string? AlbumId,
        string? CoverArt, long? Duration, string? ContentType, string? Suffix, JsonElement? Isrc, ReplayGain? ReplayGain);

    sealed record SubAlbum(string Id, string Name, string? Artist, string? ArtistId, int? Year, string? CoverArt, List<SubSong>? Song);

    sealed record SubArtist(string Id, string Name, string? CoverArt);

    readonly Dictionary<string, Palette?> palettes = [];

    static string Enc(string s) => Uri.EscapeDataString(s);

    static string? Cover(string? id, int size = 300) => id is null ? null : $"/api/v1/navidrome/cover/{Enc(id)}?size={size}";

    static Track TrackOf(SubSong s, SubAlbum a)
    {
        var isrc = s.Isrc switch
        {
            { ValueKind: JsonValueKind.String } v => v.GetString(),
            { ValueKind: JsonValueKind.Array } v when v.GetArrayLength() > 0 => v[0].GetString(),
            _ => null,
        };
        var art = Cover(s.CoverArt ?? a.CoverArt, 600);
        return new Track($"navidrome:{s.Id}", s.Id, s.Title, [new ArtistRef(s.ArtistId, s.Artist ?? a.Artist ?? "")],
            new AlbumRef(a.Id, s.Album ?? a.Name, $"navidrome:{a.Id}"), (s.Duration ?? 0) * 1000,
            art is null ? [] : [new Artwork(art)], isrc, s.ReplayGain,
            s.ContentType ?? (s.Suffix is null ? null : $"audio/{s.Suffix}"));
    }

    static ArtistCard ArtistOf(SubArtist a) => new(a.Id, a.Name, Cover(a.CoverArt ?? $"ar-{a.Id}"));

    static Album AlbumOf(SubAlbum a) => new(a.Id, a.Name, a.Artist ?? "", a.ArtistId, a.Year, Cover(a.CoverArt))
    {
        Tracks = (a.Song ?? []).Select(s => TrackOf(s, a)).ToList(),
    };

    static List<Track> Songs(JsonNode? list) =>
        (Json.From<List<SubSong>>(list) ?? []).Select(s => TrackOf(s, new SubAlbum(s.AlbumId ?? "", s.Album ?? "", null, null, null, s.CoverArt, null))).ToList();

    async Task<JsonNode> Rest(string method, string query = "")
    {
        var r = (await api.Get($"/navidrome/rest/{method}{(query.Length == 0 ? "" : "?" + query)}"))["subsonic-response"]
            ?? throw new ApiException(HttpStatusCode.BadGateway, "no subsonic-response");
        if (Echo.Api.Text(r["status"]) == "failed")
            throw new ApiException(HttpStatusCode.OK, $"subsonic.{Echo.Api.Text(r["error"]?["code"])}");
        return r;
    }

    static bool NotFound(ApiException e) => e.Code == "subsonic.70";

    /// One page of the album list in `sort` order.
    public async Task<IReadOnlyList<Album>> Albums(AlbumSort sort, int offset = 0, int size = Page)
    {
        var year = sort == AlbumSort.Year ? "&fromYear=9999&toYear=0" : "";
        var r = await Rest("getAlbumList2", $"type={sort.Api()}&size={size}&offset={offset}{year}");
        return (Json.From<List<SubAlbum>>(r["albumList2"]?["album"]) ?? []).Select(AlbumOf).ToList();
    }

    /// The whole album list, page by page.
    public async Task<IReadOnlyList<Album>> AllAlbums(AlbumSort sort)
    {
        var all = new List<Album>();
        for (var offset = 0; ; offset += Page)
        {
            var page = await Albums(sort, offset);
            all.AddRange(page);
            if (page.Count < Page) return all;
        }
    }

    public async Task<IReadOnlyList<Album>> AlbumList(AlbumList kind, int size) =>
        (Json.From<List<SubAlbum>>((await Rest("getAlbumList2", $"type={kind.ToString().ToLowerInvariant()}&size={size}"))["albumList2"]?["album"]) ?? [])
            .Select(AlbumOf).ToList();

    /// An album with its tracks; null when Navidrome has no such album.
    public async Task<Album?> Album(string id)
    {
        try
        {
            return Json.From<SubAlbum>((await Rest("getAlbum", $"id={Enc(id)}"))["album"]) is { } a ? AlbumOf(a) : null;
        }
        catch (ApiException e) when (NotFound(e))
        {
            return null;
        }
    }

    public async Task<ArtistPage?> Artist(string id)
    {
        try
        {
            var a = (await Rest("getArtist", $"id={Enc(id)}"))["artist"];
            if (a is null) return null;
            return new ArtistPage(Echo.Api.Text(a["name"]), (Json.From<List<SubAlbum>>(a["album"]) ?? []).Select(AlbumOf).ToList());
        }
        catch (ApiException e) when (NotFound(e))
        {
            return null;
        }
    }

    /// Every artist, A–Z (getArtists' index flattened).
    public async Task<IReadOnlyList<ArtistCard>> Artists()
    {
        var index = (await Rest("getArtists"))["artists"]?["index"]?.AsArray() ?? [];
        return index.SelectMany(i => Json.From<List<SubArtist>>(i?["artist"]) ?? []).Select(ArtistOf).ToList();
    }

    public async Task<ArtistInfo> ArtistInfo(string id)
    {
        var r = (await Rest("getArtistInfo2", $"id={Enc(id)}&count=12"))["artistInfo2"];
        // Last.fm's biography ends in a "Read more on Last.fm" link: text only here.
        var bio = Echo.Api.Text(r?["biography"]);
        bio = ReadMore().Replace(Tags().Replace(bio, ""), "").Trim();
        var similar = (Json.From<List<SubArtist>>(r?["similarArtist"]) ?? []).Where(a => a.Id.Length > 0).Select(ArtistOf).ToList();
        return new ArtistInfo(bio.Length > 0 ? bio : null, Cover($"ar-{id}", 600), similar);
    }

    public async Task<IReadOnlyList<Track>> TopSongs(string artist, int count) =>
        Songs((await Rest("getTopSongs", $"artist={Enc(artist)}&count={count}"))["topSongs"]?["song"]);

    public async Task<IReadOnlyList<Playlist>> Playlists()
    {
        var list = (await Rest("getPlaylists"))["playlists"]?["playlist"]?.AsArray() ?? [];
        return list.Select(p => new Playlist(Echo.Api.Text(p?["id"]), Echo.Api.Text(p?["name"]),
            p?["songCount"]?.GetValue<int>() ?? 0, Cover(p?["coverArt"]?.GetValue<string>()), p?["owner"]?.GetValue<string>())).ToList();
    }

    public async Task<PlaylistDetail?> Playlist(string id)
    {
        try
        {
            var p = (await Rest("getPlaylist", $"id={Enc(id)}"))["playlist"];
            if (p is null) return null;
            var entries = Songs(p["entry"]);
            var comment = p["comment"]?.GetValue<string>();
            return new PlaylistDetail(
                new Playlist(id, Echo.Api.Text(p["name"]), entries.Count, Cover(p["coverArt"]?.GetValue<string>()), p["owner"]?.GetValue<string>()),
                string.IsNullOrWhiteSpace(comment) ? null : comment,
                entries.Select(t => t.Cover).OfType<string>().Distinct().Take(4).ToList(),
                entries);
        }
        catch (ApiException e) when (NotFound(e))
        {
            return null;
        }
    }

    public async Task<Starred> Starred()
    {
        var r = (await Rest("getStarred2"))["starred2"];
        return new Starred(Songs(r?["song"]), (Json.From<List<SubAlbum>>(r?["album"]) ?? []).Select(AlbumOf).ToList(),
            (Json.From<List<SubArtist>>(r?["artist"]) ?? []).Select(ArtistOf).ToList());
    }

    public async Task<SearchResult> Search(string q)
    {
        var r = (await Rest("search3", $"query={Enc(q)}&artistCount=6&albumCount=6&songCount=12"))["searchResult3"];
        return new SearchResult(Songs(r?["song"]), (Json.From<List<SubAlbum>>(r?["album"]) ?? []).Select(AlbumOf).ToList(),
            (Json.From<List<SubArtist>>(r?["artist"]) ?? []).Select(ArtistOf).ToList());
    }

    /// Heart or un-heart.
    public Task Star(StarKind kind, string id, bool on)
    {
        var param = kind switch { StarKind.Track => "id", StarKind.Album => "albumId", _ => "artistId" };
        return Write(on ? "star" : "unstar", $"{param}={Enc(id)}");
    }

    /// A new playlist; its id.
    public async Task<string?> CreatePlaylist(string name) =>
        (await Write("createPlaylist", $"name={Enc(name)}"))["playlist"]?["id"]?.GetValue<string>();

    /// Songs added to the end of a playlist.
    public Task AddToPlaylist(string playlist, IEnumerable<string> songs) =>
        Write("updatePlaylist", $"playlistId={Enc(playlist)}" + string.Concat(songs.Select(s => $"&songIdToAdd={Enc(s)}")));

    /// A page of every song, A–Z by title (search3 with an empty query, as Navidrome allows).
    public async Task<IReadOnlyList<Track>> Songs(int offset, int size = Page) =>
        Songs((await Rest("search3", $"query=&artistCount=0&albumCount=0&songCount={size}&songOffset={offset}"))["searchResult3"]?["song"]);

    /// Subsonic writes go as POST (ECHO's proxy takes them so only).
    async Task<JsonNode> Write(string method, string query)
    {
        var r = (await api.Send(HttpMethod.Post, $"/navidrome/rest/{method}?{query}"))["subsonic-response"]
            ?? throw new ApiException(HttpStatusCode.BadGateway, "no subsonic-response");
        if (Echo.Api.Text(r["status"]) == "failed") throw new ApiException(HttpStatusCode.OK, $"subsonic.{Echo.Api.Text(r["error"]?["code"])}");
        return r;
    }

    /// The album's palette (`/palette/{albumKey}`), kept; null when the server has none.
    public async Task<Palette?> Palette(string albumKey)
    {
        if (palettes.TryGetValue(albumKey, out var known)) return known;
        try
        {
            return palettes[albumKey] = Json.From<Palette>(await api.Get($"/palette/{Enc(albumKey)}"));
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or JsonException or TaskCanceledException)
        {
            return null; // not cached: the next album change asks again
        }
    }

    // ---- ECHO's own history (src/server/plays.ts) ----

    /// `POST /me/plays`'s body: the track with its provider said (the server keeps Navidrome's only).
    public static JsonObject PlayBody(Track t, PlayContext? ctx)
    {
        var body = new JsonObject { ["track"] = Json.ToNode(t) };
        if (ctx is not null) body["context"] = Json.ToNode(ctx);
        return body;
    }

    /// A play past the scrobble point, with what it was played from.
    public Task RecordPlay(Track t, PlayContext? ctx) => api.Send(HttpMethod.Post, "/me/plays", PlayBody(t, ctx));

    /// Made For You; the daylist follows this computer's time of day (getTimezoneOffset's sign).
    public async Task<IReadOnlyList<Mix>> Mixes()
    {
        var tz = -(int)TimeZoneInfo.Local.GetUtcOffset(DateTime.UtcNow).TotalMinutes;
        return Json.From<List<Mix>>((await api.Get($"/me/mixes?tz={tz}"))["mixes"]) ?? [];
    }

    public async Task<IReadOnlyList<PlayedContext>> PlayedContexts() =>
        Json.From<List<PlayedContext>>((await api.Get("/me/plays/contexts"))["contexts"]) ?? [];

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tags();

    [GeneratedRegex(@"\s*Read more on Last\.fm\.?\s*$")]
    private static partial Regex ReadMore();
}
