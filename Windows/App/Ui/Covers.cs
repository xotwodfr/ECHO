using Avalonia.Media.Imaging;

namespace Echo.Ui;

/// Covers by id and size, fetched with the bearer header and kept in memory.
public sealed class Covers(Api api)
{
    // ponytail: an LRU by count; by bytes if a long session ever holds too much memory.
    const int Keep = 300;
    readonly Dictionary<(string, int), Task<Bitmap?>> cache = [];
    readonly LinkedList<(string, int)> order = [];

    public Task<Bitmap?> Get(string? coverArt, int size)
    {
        if (coverArt is null) return Task.FromResult<Bitmap?>(null);
        var key = (coverArt, size);
        if (cache.TryGetValue(key, out var hit))
        {
            order.Remove(key);
            order.AddFirst(key);
            return hit;
        }
        var load = Load(coverArt, size);
        cache[key] = load;
        order.AddFirst(key);
        if (order.Count > Keep)
        {
            cache.Remove(order.Last!.Value);
            order.RemoveLast();
        }
        return load;
    }

    async Task<Bitmap?> Load(string coverArt, int size)
    {
        if (coverArt.StartsWith("fixture:")) return Fixtures.Cover(int.Parse(coverArt["fixture:".Length..]), size);
        try
        {
            await using var stream = await api.Cover(coverArt, size);
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
