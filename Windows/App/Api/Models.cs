using System.Text.Json.Serialization;

namespace Echo;

// The API's shapes (docs/api/openapi.yaml; src/shared/types.ts), as Android's Models.kt has them. A
// Track's artwork URLs are server paths, as the web keeps them, so a queue saved on one device plays
// on another.

public sealed record ArtistRef(string? Id, string Name);

public sealed record AlbumRef(string? Id, string Title, string Key);

public sealed record Artwork(string Url, int? Width = null, int? Height = null);

public sealed record ReplayGain(double? TrackGain = null, double? AlbumGain = null, double? TrackPeak = null, double? AlbumPeak = null);

public sealed record Track(
    string Key,
    string Id,
    string Title,
    IReadOnlyList<ArtistRef> Artists,
    AlbumRef Album,
    long DurationMs,
    IReadOnlyList<Artwork>? Artwork = null,
    string? Isrc = null,
    ReplayGain? ReplayGain = null,
    string? ContentType = null,
    string Provider = "navidrome")
{
    [JsonIgnore] public string Artist => string.Join(", ", Artists.Select(a => a.Name));
    [JsonIgnore] public string? Cover => Artwork is { Count: > 0 } a ? a[0].Url : null;
}

public sealed record Album(string Id, string Title, string Artist, string? ArtistId = null, int? Year = null, string? Cover = null)
{
    public IReadOnlyList<Track> Tracks { get; init; } = [];
    public string Key => $"navidrome:{Id}";
}

public sealed record Playlist(string Id, string Name, int Tracks, string? Cover = null, string? Owner = null);

/// An artist as a reference with a picture (similar artists, search, starred).
public sealed record ArtistCard(string Id, string Name, string? Image = null);

public sealed record ArtistInfo(string? Bio, string? Image, IReadOnlyList<ArtistCard> Similar);

public sealed record ArtistPage(string Name, IReadOnlyList<Album> Albums);

public sealed record PlaylistDetail(Playlist Playlist, string? Comment, IReadOnlyList<string> Covers, IReadOnlyList<Track> Entries)
{
    public long DurationMs => Entries.Sum(t => t.DurationMs);
}

public sealed record Starred(IReadOnlyList<Track> Tracks, IReadOnlyList<Album> Albums, IReadOnlyList<ArtistCard> Artists);

public sealed record SearchResult(IReadOnlyList<Track> Tracks, IReadOnlyList<Album> Albums, IReadOnlyList<ArtistCard> Artists);

public sealed record PlayContext(string Kind, string? Id, string Title);

/// The saved queue (QueueState, `/api/v1/me/queue`), shared with the web player.
public sealed record QueueState(
    string? Provider = "navidrome",
    Track? Now = null,
    IReadOnlyList<Track>? NextUp = null,
    IReadOnlyList<Track>? Context = null,
    PlayContext? ContextSource = null,
    IReadOnlyList<Track>? History = null)
{
    // The web reads the lists as arrays, never absent: written empty when null.
    public IReadOnlyList<Track> NextUp { get; init; } = NextUp ?? [];
    public IReadOnlyList<Track> Context { get; init; } = Context ?? [];
    public IReadOnlyList<Track> History { get; init; } = History ?? [];
}

/// The album's palette (VISUALIZER_SPEC.md §6), CSS colours.
public sealed record Palette(
    string Room,
    string Accent,
    string Highlight,
    string Glow,
    string Shadow,
    string? InkActive = null,
    string? Source = null);

public sealed record LyricWord(string Text, long Start, long End, bool IsPartOfWord = false);

public sealed record BackgroundLine(string Text, long? Start = null, long? End = null, IReadOnlyList<LyricWord>? Words = null);

public sealed record LyricLine(
    string Text,
    long Start = 0,
    long? End = null,
    string? Agent = null,
    bool OppositeAligned = false,
    IReadOnlyList<LyricWord>? Words = null,
    IReadOnlyList<BackgroundLine>? Background = null);

public sealed record Link(string Label, string Href);

public sealed record Attribution(string Text, IReadOnlyList<Link>? Links = null);

public sealed record Agent(string Id, string? Name = null, string Kind = "person");

public sealed record LyricsDoc(
    string TrackKey,
    string Sync, // word | line | none
    string Source,
    Attribution Attribution,
    IReadOnlyList<LyricLine> Lines,
    int Version = 1,
    string? Language = null,
    long OffsetMs = 0,
    long? DurationMs = null,
    IReadOnlyList<Agent>? Agents = null);

/// A Navidrome song as ECHO's play history keeps it (src/server/plays.ts).
public sealed record TrackRef(string Id, string Title, string Artist, string? ArtistId, string Album, string? AlbumId,
    long DurationMs, string? Cover = null)
{
    public Track ToTrack() => new($"navidrome:{Id}", Id, Title, [new ArtistRef(ArtistId, Artist)],
        new AlbumRef(AlbumId, Album, $"navidrome:{AlbumId ?? Id}"), DurationMs, Cover is null ? [] : [new Artwork(Cover)]);
}

/// One of Made For You's mixes.
public sealed record Mix(string Id, string Kind, string Title, string Subtitle, IReadOnlyList<TrackRef> Tracks);

/// Jump back in: an album, playlist, artist or mix played from lately.
public sealed record PlayedContext(string Kind, string Id, string? Title, string? Cover, long At);
