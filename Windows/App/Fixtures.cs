using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using SkiaSharp;

namespace Echo;

/// A built-in ECHO server for the smoke run, the screenshots and the tests: the Subsonic proxy, covers,
/// lyrics and the saved queue answered from a small made-up library, so every screen runs its real code
/// with no network. Songs do not stream (there is no audio here).
public sealed class Fixtures : HttpMessageHandler
{
    public const string Base = "https://fixtures.invalid";

    static readonly (string Title, string Artist, int Year)[] Names =
    [
        ("Low Orbit", "Mira Vale", 2021), ("Heat Index", "The Long Summer", 2019), ("Monochrome", "Ostrava", 2023),
        ("Prism Hours", "Kai Lumen", 2020), ("Greenhouse", "Fern & Field", 2018), ("Red Shift", "Velvet Static", 2024),
        ("Honeycomb", "Ada Sol", 2022), ("Half Light", "Northbound", 2017), ("Tidepool", "Mira Vale", 2024),
        ("Kaleido", "Junebug", 2016), ("Neon Tide", "Halcyon Drive", 2024), ("Static Bloom", "Ostrava", 2025),
    ];

    static readonly string[] SongTitles = ["Afterglow", "Night Swim", "Overpass", "Glass Hours", "Low Tide", "Coda"];

    static readonly string[] Artists = Names.Select(n => n.Artist).Distinct().ToArray();

    static string ArtistId(string name) => $"ar{Array.IndexOf(Artists, name) + 1}";

    static JsonObject Song(int album, int k)
    {
        var (title, artist, year) = Names[album];
        return new JsonObject
        {
            ["id"] = $"f{album + 1}-{k}", ["title"] = SongTitles[k], ["artist"] = artist, ["artistId"] = ArtistId(artist),
            ["album"] = title, ["albumId"] = $"f{album + 1}", ["coverArt"] = $"f{album + 1}", ["duration"] = 180 + 17 * k,
            ["track"] = k + 1, ["year"] = year, ["suffix"] = "flac", ["contentType"] = "audio/flac",
        };
    }

    static JsonObject Album(int i, bool songs = false)
    {
        var (title, artist, year) = Names[i];
        var a = new JsonObject
        {
            ["id"] = $"f{i + 1}", ["name"] = title, ["artist"] = artist, ["artistId"] = ArtistId(artist), ["year"] = year,
            ["coverArt"] = $"f{i + 1}", ["songCount"] = SongTitles.Length, ["genre"] = i % 3 == 0 ? "Synthpop" : i % 3 == 1 ? "Indie Rock" : "Electronic",
        };
        if (songs) a["song"] = new JsonArray(SongTitles.Select((_, k) => (JsonNode)Song(i, k)).ToArray());
        return a;
    }

    static readonly (string Name, (int Album, int Song)[] Songs)[] Playlists =
    [
        ("Late Night Drive", [(10, 0), (0, 1), (5, 2), (7, 4), (3, 0)]),
        ("Focus", [(2, 3), (11, 1), (4, 5), (9, 2)]),
        ("Summer 2025", [(6, 0), (1, 3), (8, 1)]),
    ];

    static JsonObject Playlist(int i, bool entries = false)
    {
        var p = new JsonObject
        {
            ["id"] = $"pl{i + 1}", ["name"] = Playlists[i].Name, ["songCount"] = Playlists[i].Songs.Length,
            ["owner"] = "ada", ["coverArt"] = $"f{Playlists[i].Songs[0].Album + 1}",
        };
        if (entries) p["entry"] = new JsonArray(Playlists[i].Songs.Select(s => (JsonNode)Song(s.Album, s.Song)).ToArray());
        return p;
    }

    static IEnumerable<int> AlbumsOf(string artistId) => Enumerable.Range(0, Names.Length).Where(i => ArtistId(Names[i].Artist) == artistId);

    static IEnumerable<JsonObject> AllSongs => Enumerable.Range(0, Names.Length).SelectMany(i => SongTitles.Select((_, k) => Song(i, k)));

    static JsonArray Arr(IEnumerable<JsonNode> items) => new(items.ToArray());

    /// Word-timed lyrics for Neon Tide's "Afterglow" (f11-0), around 1:18 where the smoke run shows it:
    /// a held word, background vocals, a 10 s break (the interlude's dots) and a duet line.
    public static readonly LyricsDoc Lyrics = new("navidrome:f11-0", "word", "fixture", new Attribution("Lyrics: fixture"),
        [
            Timed("Streetlights hum a borrowed tune", 66_000, 3_600),
            Timed("We drive until the city's gone", 70_500, 3_600),
            Timed("Every echo finds its way home", 75_000, 3_600),
            Timed("And the afterglow holds on", 80_000, 3_000, hold: "on"),
            Timed("Hold on, hold on", 84_500, 2_800) with
            {
                Background = [new BackgroundLine("(hold on)", 86_000, 87_300, [new LyricWord("(hold", 86_000, 86_600), new LyricWord("on)", 86_600, 87_300)])],
            },
            Timed("Till the morning comes", 88_000, 3_600),
            Timed("Every echo, every echo", 101_500, 3_200) with { OppositeAligned = true, Agent = "v2" },
            Timed("Comes back to me", 105_500, 3_000),
        ]);

    /// A line sung word by word over `ms`, evenly, its `hold` word held for 1.2 s at the end.
    static LyricLine Timed(string text, long start, long ms, string? hold = null)
    {
        var words = text.Split(' ');
        var held = hold is null ? 0 : 1_200;
        var step = (ms - held) / words.Length;
        var timed = words.Select((w, i) =>
        {
            var from = start + i * step;
            var last = i == words.Length - 1 && w == hold;
            return new LyricWord(w, from, last ? from + step + held : from + step);
        }).ToList();
        return new LyricLine(text, start, timed[^1].End, Words: timed);
    }

    /// The queue the smoke run opens on: Neon Tide from its first song, at 1:18.
    static JsonObject SavedQueue()
    {
        var songs = SongTitles.Select((_, k) => Json.ToNode(LibraryTrack(10, k))!).ToArray();
        return new JsonObject
        {
            ["queue"] = new JsonObject
            {
                ["provider"] = "navidrome", ["now"] = songs[0].DeepClone(), ["nextUp"] = new JsonArray(),
                ["context"] = new JsonArray(songs.Skip(1).Select(s => s.DeepClone()).ToArray()),
                ["contextSource"] = new JsonObject { ["kind"] = "album", ["id"] = "f11", ["title"] = "Neon Tide" },
                ["history"] = new JsonArray(),
            },
            ["positionMs"] = 78_000, ["updatedAt"] = 1,
        };
    }

    static Track LibraryTrack(int album, int k) => new($"navidrome:f{album + 1}-{k}", $"f{album + 1}-{k}", SongTitles[k],
        [new ArtistRef(ArtistId(Names[album].Artist), Names[album].Artist)], new AlbumRef($"f{album + 1}", Names[album].Title, $"navidrome:f{album + 1}"),
        (180 + 17 * k) * 1000L, [new Artwork($"/api/v1/navidrome/cover/f{album + 1}?size=600")], ContentType: "audio/flac");

    /// Recently played: four albums and a playlist, newest first.
    static JsonArray Played() => Arr(new (string Kind, string Id, string Title, string Cover)[]
    {
        ("album", "f11", "Neon Tide", "f11"), ("playlist", "pl1", "Late Night Drive", "f11"), ("album", "f4", "Prism Hours", "f4"),
        ("album", "f6", "Red Shift", "f6"), ("album", "f1", "Low Orbit", "f1"), ("album", "f8", "Half Light", "f8"),
    }.Select((c, i) => (JsonNode)new JsonObject
    {
        ["kind"] = c.Kind, ["id"] = c.Id, ["title"] = c.Title, ["cover"] = $"/api/v1/navidrome/cover/{c.Cover}?size=300", ["at"] = 1_800_000_000_000L - i * 3_600_000L,
    }));

    /// Made For You: two of ECHO's mixes.
    static JsonArray Mixes() => Arr(new (string Id, string Kind, string Title, string Subtitle, int First)[]
    {
        ("daily-1", "daily", "Daily Mix 1", "Halcyon Drive, Ostrava and more", 10), ("discover", "discover", "Discover Weekly", "New to you", 3),
        ("daylist", "daylist", "Late night daylist", "Synth, night drive", 5),
    }.Select(m => (JsonNode)new JsonObject
    {
        ["id"] = m.Id, ["kind"] = m.Kind, ["title"] = m.Title, ["subtitle"] = m.Subtitle,
        ["tracks"] = Arr(Enumerable.Range(0, 4).Select(k => (JsonNode)new JsonObject
        {
            ["id"] = $"f{(m.First + k) % Names.Length + 1}-{k}", ["title"] = SongTitles[k], ["artist"] = Names[(m.First + k) % Names.Length].Artist,
            ["album"] = Names[(m.First + k) % Names.Length].Title, ["albumId"] = $"f{(m.First + k) % Names.Length + 1}", ["durationMs"] = (180 + 17 * k) * 1000,
            ["cover"] = $"/api/v1/navidrome/cover/f{(m.First + k) % Names.Length + 1}?size=300",
        })),
    }));

    static JsonObject Ok(string key, JsonNode value) =>
        new() { ["subsonic-response"] = new JsonObject { ["status"] = "ok", [key] = value } };

    static JsonNode? Rest(string method, Func<string, string?> q)
    {
        int Int(string k, int d) => int.TryParse(q(k), out var v) ? v : d;
        switch (method)
        {
            case "getAlbumList2":
                var order = Enumerable.Range(0, Names.Length);
                order = q("type") switch
                {
                    "alphabeticalByName" => order.OrderBy(i => Names[i].Title),
                    "newest" or "recent" => order.Reverse(),
                    "byYear" => order.OrderByDescending(i => Names[i].Year),
                    _ => order,
                };
                return Ok("albumList2", new JsonObject { ["album"] = Arr(order.Skip(Int("offset", 0)).Take(Int("size", 10)).Select(i => Album(i))) });
            case "getAlbum":
                var a = int.TryParse(q("id")?.TrimStart('f'), out var n) && n >= 1 && n <= Names.Length ? n - 1 : -1;
                return a < 0 ? Failed(70) : Ok("album", Album(a, songs: true));
            case "getArtists":
                return Ok("artists", new JsonObject
                {
                    ["index"] = Arr(Artists.OrderBy(x => x).GroupBy(x => x[..1].ToUpperInvariant()).Select(g => (JsonNode)new JsonObject
                    {
                        ["name"] = g.Key,
                        ["artist"] = Arr(g.Select(x => (JsonNode)new JsonObject { ["id"] = ArtistId(x), ["name"] = x, ["albumCount"] = AlbumsOf(ArtistId(x)).Count() })),
                    })),
                });
            case "getArtist":
                var id = q("id") ?? "";
                var albums = AlbumsOf(id).ToList();
                return albums.Count == 0 ? Failed(70) : Ok("artist", new JsonObject
                {
                    ["id"] = id, ["name"] = Names[albums[0]].Artist, ["album"] = Arr(albums.Select(i => (JsonNode)Album(i))),
                });
            case "getArtistInfo2":
                return Ok("artistInfo2", new JsonObject { ["biography"] = "A made-up artist from ECHO's built-in library." });
            case "getTopSongs":
                return Ok("topSongs", new JsonObject { ["song"] = Arr(AllSongs.Where(s => (string?)s["artist"] == q("artist")).Take(Int("count", 10))) });
            case "getPlaylists":
                return Ok("playlists", new JsonObject { ["playlist"] = Arr(Playlists.Select((_, i) => (JsonNode)Playlist(i))) });
            case "getPlaylist":
                var p = int.TryParse(q("id")?.Replace("pl", ""), out var m) && m >= 1 && m <= Playlists.Length ? m - 1 : -1;
                return p < 0 ? Failed(70) : Ok("playlist", Playlist(p, entries: true));
            case "getStarred2":
                return Ok("starred2", new JsonObject { ["song"] = Arr(AllSongs.Where((_, i) => i % 7 == 0)), ["album"] = Arr([Album(10), Album(3)]) });
            case "search3":
                var term = (q("query") ?? "").Trim('"').ToLowerInvariant();
                bool Hit(string s) => term.Length == 0 || s.Contains(term, StringComparison.OrdinalIgnoreCase);
                return Ok("searchResult3", new JsonObject
                {
                    ["song"] = Arr(AllSongs.Where(s => Hit((string)s["title"]!) || Hit((string)s["artist"]!)).Skip(Int("songOffset", 0)).Take(Int("songCount", 20))),
                    ["album"] = Arr(Enumerable.Range(0, Names.Length).Where(i => Hit(Names[i].Title) || Hit(Names[i].Artist)).Take(Int("albumCount", 20)).Select(i => (JsonNode)Album(i))),
                    ["artist"] = Arr(Artists.Where(Hit).Take(Int("artistCount", 20)).Select(x => (JsonNode)new JsonObject { ["id"] = ArtistId(x), ["name"] = x })),
                });
            default: // scrobble, star, unstar…
                return new JsonObject { ["subsonic-response"] = new JsonObject { ["status"] = "ok" } };
        }
    }

    static JsonObject Failed(int code) =>
        new() { ["subsonic-response"] = new JsonObject { ["status"] = "failed", ["error"] = new JsonObject { ["code"] = code } } };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        var uri = request.RequestUri!;
        var path = uri.AbsolutePath.Replace("/api/v1", "");
        if (path.StartsWith("/navidrome/stream/")) return Task.FromException<HttpResponseMessage>(new HttpRequestException("The fixtures have no audio."));
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        if (path.StartsWith("/navidrome/cover/"))
        {
            var id = Uri.UnescapeDataString(path["/navidrome/cover/".Length..]);
            var i = int.TryParse(id.TrimStart('f'), out var n) ? n - 1 : Math.Abs(id.GetHashCode()) % Names.Length;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(Cover(i, int.TryParse(query["size"], out var s) ? Math.Clamp(s, 32, 1200) : 300)),
            });
        }
        JsonNode? answer = path switch
        {
            _ when path.StartsWith("/navidrome/rest/") => Rest(path["/navidrome/rest/".Length..], k => query[k]),
            "/lyrics" => query["trackKey"] == Lyrics.TrackKey ? new JsonObject { ["doc"] = Json.ToNode(Lyrics) } : new JsonObject { ["doc"] = null },
            "/me/queue" when request.Method == HttpMethod.Get => SavedQueue(),
            "/me/queue" => new JsonObject { ["updatedAt"] = 2 },
            "/me/plays/contexts" => new JsonObject { ["contexts"] = Played() },
            "/me/mixes" => new JsonObject { ["mixes"] = Mixes() },
            _ => new JsonObject(),
        };
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(answer?.ToJsonString() ?? "{}", Encoding.UTF8, "application/json"),
        });
    }

    static readonly SKColor[][] Colours =
    [
        [new(0x0B, 0x3D, 0x91), new(0x00, 0xC2, 0xA8)], [new(0xFF, 0x5E, 0x62), new(0xFF, 0x99, 0x66)],
        [new(0x11, 0x11, 0x11), new(0xEE, 0xEE, 0xEE)], [new(0xF9, 0xD4, 0x23), new(0x8E, 0x2D, 0xE2)],
        [new(0x1D, 0x97, 0x6C), new(0x93, 0xF9, 0xB9)], [new(0x20, 0x01, 0x22), new(0xFF, 0x00, 0x80)],
        [new(0xFF, 0xE2, 0x59), new(0xFF, 0xA7, 0x51)], [new(0x23, 0x25, 0x26), new(0xE0, 0xE0, 0xE0)],
        [new(0x0A, 0x1A, 0x3A), new(0x38, 0xF9, 0xD7)], [new(0xE9, 0x64, 0x43), new(0x90, 0x4E, 0x95)],
        [new(0x17, 0x0A, 0x3A), new(0xFF, 0x3D, 0x7F)], [new(0x2B, 0x10, 0x55), new(0x75, 0x97, 0xDE)],
    ];

    /// Cover `i` at `size` px, drawn (gradients, a sun, stripes, rings, a horizon), as PNG.
    public static byte[] Cover(int i, int size)
    {
        var (a, b) = (Colours[i % Colours.Length][0], Colours[i % Colours.Length][1]);
        using var surface = SKSurface.Create(new SKImageInfo(size, size));
        var c = surface.Canvas;
        using var paint = new SKPaint { IsAntialias = true };
        paint.Shader = SKShader.CreateLinearGradient(new(0, 0), new(size, size), [a, b], SKShaderTileMode.Clamp);
        c.DrawRect(0, 0, size, size, paint);
        paint.Shader = null;
        switch (i % 4)
        {
            case 0:
                paint.Color = b.WithAlpha(230);
                c.DrawCircle(size * 0.62f, size * 0.42f, size * 0.24f, paint);
                break;
            case 1:
                using (var line = new SKPaint { Color = a, StrokeWidth = size / 14f, IsAntialias = true })
                    for (var x = -size; x < size * 2; x += size / 6) c.DrawLine(x, 0, x + size, size, line);
                break;
            case 2:
                paint.Style = SKPaintStyle.Stroke;
                paint.StrokeWidth = size / 16f;
                paint.Color = b;
                for (var r = size / 10f; r < size * 0.5f; r += size / 7f) c.DrawCircle(size / 2f, size / 2f, r, paint);
                break;
            default:
                paint.Color = SKColors.Black.WithAlpha(110);
                for (var y = size * 0.6f; y < size; y += size / 12f) c.DrawRect(0, y, size, size / 30f, paint);
                break;
        }
        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
