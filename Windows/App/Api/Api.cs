using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Echo;

// ECHO's API as this client uses it (docs/api/openapi.yaml): a device token from POST /auth/device,
// sent as a bearer header (the server's Origin check exempts it), the allow-listed Subsonic proxy
// for the library, and signed stream URLs for the player, which sends no header of its own.

/// An answer other than 2xx: the status and ECHO's error code (`{ "error": … }`), when it sent one.
public sealed class ApiException(HttpStatusCode status, string? code) : Exception(code ?? $"HTTP {(int)status}")
{
    public HttpStatusCode Status { get; } = status;
    public string? Code { get; } = code;
    /// 401: the token was revoked or expired, or the credentials were wrong.
    public bool SignedOut => Status == HttpStatusCode.Unauthorized;
}

/// CoverArt: the cover's id for /navidrome/cover, when the album has one.
public record Album(string Id, string Name, string Artist, string? CoverArt = null);

/// Suffix: the file's type as Navidrome stores it ("flac", "mp3", "opus"…).
public record Song(string Id, string Title, string Artist, int Seconds, string Suffix);

public sealed class Api(string baseUrl, HttpMessageHandler? handler = null)
{
    public string Base { get; } = baseUrl.TrimEnd('/');
    public string? Token { get; set; }
    readonly HttpClient http = new(handler ?? new HttpClientHandler()) { Timeout = TimeSpan.FromSeconds(30) };

    async Task<JsonNode> Send(HttpMethod method, string path, JsonObject? body = null)
    {
        using var req = new HttpRequestMessage(method, $"{Base}/api/v1{path}");
        if (Token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (body is not null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req);
        JsonNode? answer = null;
        try
        {
            answer = JsonNode.Parse(await res.Content.ReadAsStringAsync());
        }
        catch (JsonException) { }
        if (!res.IsSuccessStatusCode)
            throw new ApiException(res.StatusCode, Text(answer?["error"] ?? answer?["code"]) is { Length: > 0 } c ? c : null);
        return answer ?? new JsonObject();
    }

    /// A device token for this computer: credentials and, with two-factor on, the code, in one go.
    public async Task<string> SignIn(string user, string password, string code, string name)
    {
        var body = new JsonObject { ["username"] = user, ["password"] = password, ["name"] = name };
        if (!string.IsNullOrWhiteSpace(code)) body["code"] = code.Trim();
        var token = Text((await Send(HttpMethod.Post, "/auth/device", body))["token"]);
        return token.Length > 0 ? token : throw new ApiException(HttpStatusCode.OK, "no token in the answer");
    }

    /// Ends this device's session on the server (Settings → Account → Sessions loses it).
    public Task SignOut() => Send(HttpMethod.Post, "/auth/logout", new JsonObject());

    async Task<JsonNode> Subsonic(string method, string query)
    {
        var r = (await Send(HttpMethod.Get, $"/navidrome/rest/{method}?{query}"))["subsonic-response"];
        if (Text(r?["status"]) != "ok")
            throw new ApiException(HttpStatusCode.BadGateway, Text(r?["error"]?["message"]) is { Length: > 0 } m ? m : "Navidrome refused");
        return r!;
    }

    public async Task<List<Album>> Albums()
    {
        var r = await Subsonic("getAlbumList2", "type=alphabeticalByName&size=500");
        var list = r["albumList2"]?["album"]?.AsArray() ?? new JsonArray();
        return list.Select(a => new Album(Text(a?["id"]), Text(a?["name"]), Text(a?["artist"]),
            Text(a?["coverArt"]) is { Length: > 0 } c ? c : null)).ToList();
    }

    public async Task<List<Song>> Songs(string albumId)
    {
        var r = await Subsonic("getAlbum", $"id={Uri.EscapeDataString(albumId)}");
        var list = r["album"]?["song"]?.AsArray() ?? new JsonArray();
        return list
            .Select(s => new Song(Text(s?["id"]), Text(s?["title"]), Text(s?["artist"]),
                int.TryParse(Text(s?["duration"]), out var d) ? d : 0, Text(s?["suffix"]).ToLowerInvariant()))
            .ToList();
    }

    /// miniaudio's own decoders play as stored: FLAC, MP3 and WAV. Anything else (AAC, Opus, Ogg, WMA)
    /// comes from Navidrome as MP3, 320 kbps.
    static readonly HashSet<string> Playable = ["mp3", "flac", "wav"];

    /// A signed stream URL (6 h, this song only) the player opens without a header.
    public async Task<string> StreamUrl(Song song)
    {
        var path = Text((await Send(HttpMethod.Get, $"/navidrome/stream-url/{Uri.EscapeDataString(song.Id)}"))["url"]);
        if (path.Length == 0) throw new ApiException(HttpStatusCode.OK, "no stream URL");
        var format = Playable.Contains(song.Suffix) ? "&format=raw" : "&format=mp3&maxBitRate=320&estimateContentLength=true";
        return $"{Base}{path}{format}";
    }

    /// A cover at `size` px (the bearer header is needed, so this is not a URL for an Image).
    public async Task<Stream> Cover(string coverArt, int size)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{Base}/api/v1/navidrome/cover/{Uri.EscapeDataString(coverArt)}?size={size}");
        if (Token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        var res = await http.SendAsync(req);
        if (!res.IsSuccessStatusCode) throw new ApiException(res.StatusCode, null);
        return await res.Content.ReadAsStreamAsync();
    }

    static string Text(JsonNode? n) =>
        n is null ? "" : n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>() : n.ToJsonString();
}
