using System.Text.Json.Serialization;

namespace Echo;

// The API's shapes the baseline needs (docs/api/openapi.yaml; src/shared/types.ts), as Android's Models.kt
// has them: a Track's artwork URLs are server paths, as the web keeps them.

public sealed record ArtistRef(string? Id, string Name);

public sealed record AlbumRef(string? Id, string Title, string Key);

public sealed record Artwork(string Url);

public sealed record Track(
    string Key,
    string Id,
    string Title,
    IReadOnlyList<ArtistRef> Artists,
    AlbumRef Album,
    long DurationMs,
    IReadOnlyList<Artwork>? Artwork = null,
    string? ContentType = null)
{
    [JsonIgnore] public string Artist => string.Join(", ", Artists.Select(a => a.Name));
    [JsonIgnore] public string? Cover => Artwork is { Count: > 0 } a ? a[0].Url : null;
}

public sealed record Album(string Id, string Title, string Artist, string? Cover = null)
{
    public IReadOnlyList<Track> Tracks { get; init; } = [];
    public string Key => $"navidrome:{Id}";
}
