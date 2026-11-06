using Avalonia.Media.Imaging;
using Echo.Stage;
using SkiaSharp;

namespace Echo;

/// A built-in library for the smoke run and the tests: no server, no network. The covers are drawn
/// (gradients, stripes, rings), loud enough that the glass over them shows its bend.
public static class Fixtures
{
    static readonly (string Title, string Artist)[] Names =
    [
        ("Low Orbit", "Mira Vale"), ("Heat Index", "The Long Summer"), ("Monochrome", "Ostrava"),
        ("Prism Hours", "Kai Lumen"), ("Greenhouse", "Fern & Field"), ("Red Shift", "Velvet Static"),
        ("Honeycomb", "Ada Sol"), ("Half Light", "Northbound"), ("Tidepool", "Mira Vale"),
        ("Kaleido", "Junebug"), ("Neon Tide", "Halcyon Drive"), ("Static Bloom", "Ostrava"),
    ];

    static readonly string[] SongTitles = ["Afterglow", "Night Swim", "Overpass", "Glass Hours", "Low Tide", "Coda"];

    public static readonly IReadOnlyList<Album> Albums = Names.Select((n, i) =>
    {
        var id = $"f{i + 1}";
        var cover = $"fixture:{i}";
        return new Album(id, n.Title, n.Artist, Cover: cover)
        {
            Tracks = SongTitles.Select((t, k) => new Track($"navidrome:{id}-{k}", $"{id}-{k}", t, [new ArtistRef(null, n.Artist)],
                new AlbumRef(id, n.Title, $"navidrome:{id}"), (180 + 17 * k) * 1000L, [new Artwork(cover)], ContentType: "audio/flac")).ToList(),
        };
    }).ToList();

    /// Word-timed lyrics for the first fixture song, around where the smoke run shows it (1:18).
    public static readonly LyricsDoc Lyrics = new("navidrome:f11-0", "word", "fixture", new Attribution("Lyrics: fixture"),
        new (string Text, long Start)[]
        {
            ("Streetlights hum a borrowed tune", 66_000), ("We drive until the city's gone", 70_500),
            ("Every echo finds its way home", 75_000), ("And the afterglow holds on", 80_000),
            ("Hold on, hold on", 84_500), ("Till the morning comes", 88_000),
        }.Select(l =>
        {
            var words = l.Text.Split(' ');
            var step = 3600 / words.Length;
            return new LyricLine(l.Text, l.Start, l.Start + 3600,
                Words: words.Select((w, i) => new LyricWord(w, l.Start + i * step, l.Start + (i + 1) * step)).ToList());
        }).ToList());

    /// The Neon Tide palette of board A: the room in violet, the accent in pink.
    public static readonly StagePalette Palette = StagePalette.Of(new Palette(
        "oklch(0.28 0.12 300)", "oklch(0.66 0.24 355)", "oklch(0.86 0.12 70)", "oklch(0.70 0.20 355 / 0.40)",
        "oklch(0.12 0.05 300)", "oklch(0.96 0.02 80)"));

    static readonly SKColor[][] Colours =
    [
        [new(0x0B, 0x3D, 0x91), new(0x00, 0xC2, 0xA8)],
        [new(0xFF, 0x5E, 0x62), new(0xFF, 0x99, 0x66)],
        [new(0x11, 0x11, 0x11), new(0xEE, 0xEE, 0xEE)],
        [new(0xF9, 0xD4, 0x23), new(0x8E, 0x2D, 0xE2)],
        [new(0x1D, 0x97, 0x6C), new(0x93, 0xF9, 0xB9)],
        [new(0x20, 0x01, 0x22), new(0xFF, 0x00, 0x80)],
        [new(0xFF, 0xE2, 0x59), new(0xFF, 0xA7, 0x51)],
        [new(0x23, 0x25, 0x26), new(0xE0, 0xE0, 0xE0)],
        [new(0x0A, 0x1A, 0x3A), new(0x38, 0xF9, 0xD7)],
        [new(0xE9, 0x64, 0x43), new(0x90, 0x4E, 0x95)],
        [new(0x17, 0x0A, 0x3A), new(0xFF, 0x3D, 0x7F)],
        [new(0x2B, 0x10, 0x55), new(0x75, 0x97, 0xDE)],
    ];

    /// Cover `i` at `size` px, drawn.
    public static Bitmap Cover(int i, int size)
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
            case 0: // a sun
                paint.Color = b.WithAlpha(230);
                c.DrawCircle(size * 0.62f, size * 0.42f, size * 0.24f, paint);
                break;
            case 1: // stripes
                paint.Color = a.WithAlpha(200);
                for (var x = -size; x < size * 2; x += size / 6) c.DrawLine(x, 0, x + size, size, new SKPaint { Color = a, StrokeWidth = size / 14f, IsAntialias = true });
                break;
            case 2: // rings
                paint.Style = SKPaintStyle.Stroke;
                paint.StrokeWidth = size / 16f;
                paint.Color = b;
                for (var r = size / 10f; r < size * 0.5f; r += size / 7f) c.DrawCircle(size / 2f, size / 2f, r, paint);
                break;
            default: // a horizon
                paint.Color = SKColors.Black.WithAlpha(110);
                for (var y = size * 0.6f; y < size; y += size / 12f) c.DrawRect(0, y, size, size / 30f, paint);
                break;
        }
        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return new Bitmap(data.AsStream());
    }
}
