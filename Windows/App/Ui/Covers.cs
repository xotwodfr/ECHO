using Avalonia.Media.Imaging;

namespace Echo.Ui;

/// Covers by server path (`/api/v1/navidrome/cover/…`, a Track's artwork) at a size, fetched with the
/// bearer header and kept in memory; `fixture:<n>` draws a built-in one.
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

    async Task<Bitmap?> Load(string url, int size)
    {
        if (url.StartsWith("fixture:")) return Fixtures.Cover(int.Parse(url["fixture:".Length..]), size);
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
            return null; // the fallback square shows instead (DESIGN_SYSTEM.md §8)
        }
    }
}
