using System.Text.Json.Nodes;

namespace Echo;

/// What the library has for a Wanted item: an album, or a song (with its album).
public sealed record WantedFound(string Kind, string Id, string Title, string Artist, string? AlbumId = null);

/// One item on the Wanted list; AddedBy is null once that user is deleted.
public sealed record WantedItem(int Id, string Text, string? AddedBy, long AddedAt, WantedFound? Found = null);

/// The Wanted list (docs/api/openapi.yaml `/wanted`): one list for everyone on the server of music that
/// isn't in Navidrome yet. The server marks what the library gets.
public sealed class Wanted(Api api)
{
    public async Task<IReadOnlyList<WantedItem>> List() => Json.From<List<WantedItem>>(await api.Get("/wanted")) ?? [];

    /// Adds `text` (an artist and a song, or an album); the same words are the same item.
    public async Task<WantedItem> Add(string text) =>
        Json.From<WantedItem>(await api.Send(HttpMethod.Post, "/wanted", new JsonObject { ["text"] = text.Trim() }))
        ?? throw new ApiException(System.Net.HttpStatusCode.OK, "no item in the answer");

    public Task Remove(int id) => api.Send(HttpMethod.Delete, $"/wanted/{id}");
}
