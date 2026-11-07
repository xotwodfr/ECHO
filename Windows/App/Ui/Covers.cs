using Avalonia.Media.Imaging;

namespace Echo.Ui;

/// Covers by server path (`/api/v1/navidrome/cover/…`, a Track's artwork) at a size, fetched with the
/// bearer header and kept in memory.
public sealed class Covers(Api api)
{
    // ponytail: an LRU by count; by bytes if a long session ever holds too much memory.
    const int Keep = 300;
    readonly Dictionary<(string, int), Task<Bitmap?>> cache = [];
    readonly LinkedList<(string, int)> order = [];

    public Task<Bitmap?> Get(string? url, int size)
    {
        if (url is null) return Task.FromResult<Bitmap?>(null);
        var key = (url, size);
        if (cache.TryGetValue(key, out var hit))
        {
            order.Remove(key);
            order.AddFirst(key);
            return hit;
        }
        var load = Load(url, size);
        cache[key] = load;
        order.AddFirst(key);
        if (order.Count > Keep)
        {
            cache.Remove(order.Last!.Value);
            order.RemoveLast();
        }
        return load;
    }

    readonly Dictionary<string, Avalonia.Media.Color?> keys = [];

    /// The cover's key colour, as Cider 4 tints a page with it: the most vivid hue of the cover (its
    /// pixels weighted by saturation × brightness, in 12 hue bins), kept bright enough to read on Cider's
    /// dark (brightness 55–85 %, saturation 35–85 %). Null without a cover.
    public async Task<Avalonia.Media.Color?> KeyColor(string? url)
    {
        if (url is null) return null;
        if (keys.TryGetValue(url, out var known)) return known;
        var cover = await Get(url, 96);
        return keys[url] = cover is null ? null : KeyOf(cover);
    }

    internal static Avalonia.Media.Color KeyOf(Bitmap cover)
    {
        using var png = new MemoryStream();
        cover.Save(png, new PngBitmapEncoderOptions());
        using var full = SkiaSharp.SKBitmap.Decode(png.ToArray());
        using var small = full.Resize(new SkiaSharp.SKImageInfo(16, 16), new SkiaSharp.SKSamplingOptions(SkiaSharp.SKFilterMode.Linear));
        var bins = new (double W, double R, double G, double B)[12];
        foreach (var p in small.Pixels)
        {
            p.ToHsv(out var h, out var sat, out var val);
            var w = sat / 100 * (val / 100);
            var bin = (int)(h / 30) % 12;
            bins[bin] = (bins[bin].W + w, bins[bin].R + p.Red * w, bins[bin].G + p.Green * w, bins[bin].B + p.Blue * w);
        }
        var best = bins.MaxBy(b => b.W);
        if (best.W < 0.5) return Avalonia.Media.Color.FromRgb(0xFC, 0x3C, 0x44); // a grey cover: Cider's own key colour
        var c = new SkiaSharp.SKColor((byte)(best.R / best.W), (byte)(best.G / best.W), (byte)(best.B / best.W));
        c.ToHsv(out var hue, out var s, out var v);
        var fixedColour = SkiaSharp.SKColor.FromHsv(hue, Math.Clamp(s, 35, 85), Math.Clamp(v, 55, 85));
        return Avalonia.Media.Color.FromRgb(fixedColour.Red, fixedColour.Green, fixedColour.Blue);
    }

    async Task<Bitmap?> Load(string url, int size)
    {
        try
        {
            var sized = url.Contains("size=") ? System.Text.RegularExpressions.Regex.Replace(url, @"size=\d+", $"size={size}") : url;
            await using var stream = await api.GetStream(sized);
            using var copy = new MemoryStream();
            await stream.CopyToAsync(copy);
            copy.Position = 0;
            return new Bitmap(copy);
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or ArgumentException or TaskCanceledException)
        {
            return null; // Cider's MissingArtwork shows instead
        }
    }
}
