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

public sealed class Api(string baseUrl, HttpMessageHandler? handler = null)
{
    public string Base { get; } = baseUrl.TrimEnd('/');
    public string? Token { get; set; }
    readonly HttpClient http = new(handler ?? new HttpClientHandler()) { Timeout = TimeSpan.FromSeconds(30) };

    public Task<JsonNode> Get(string path) => Send(HttpMethod.Get, path);

    public async Task<JsonNode> Send(HttpMethod method, string path, JsonNode? body = null)
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

    /// A signed stream URL (6 h, this song only) the player opens without a header.
    /// As stored when miniaudio decodes it (StreamFormat), else MP3 320.
    public async Task<string> StreamUrl(Track track)
    {
        var path = Text((await Send(HttpMethod.Get, $"/navidrome/stream-url/{Uri.EscapeDataString(track.Id)}"))["url"]);
        if (path.Length == 0) throw new ApiException(HttpStatusCode.OK, "no stream URL");
        var format = StreamFormat.PlaysRaw(track.ContentType) ? "&format=raw" : "&format=mp3&maxBitRate=320&estimateContentLength=true";
        return $"{Base}{path}{format}";
    }

    /// A server path's bytes with the bearer header (covers: an Image cannot send it).
    public async Task<Stream> GetStream(string path)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, path.StartsWith("http") ? path : $"{Base}{path}");
        if (Token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        var res = await http.SendAsync(req);
        if (!res.IsSuccessStatusCode) throw new ApiException(res.StatusCode, null);
        return await res.Content.ReadAsStreamAsync();
    }

    internal static string Text(JsonNode? n) =>
        n is null ? "" : n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>() : n.ToJsonString();
}
