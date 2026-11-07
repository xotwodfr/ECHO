using System.Net;

namespace Echo.Playback;

/// A song arriving over HTTP that can be read as it arrives: one download at a time fills a buffer the
/// size the server announced, and a read waits only for the bytes it asks for. A read well past where
/// the download has got to starts it again from there with a Range request, when the server takes
/// them (a song as stored; a transcoded one arrives in order): the decoders jump over the cover art
/// embedded at the start of a FLAC or an MP3 (often a megabyte, up to seven) rather than read it, so
/// the music starts without waiting for the picture, and a seek ahead plays at once. Bytes jumped over
/// are fetched only if something reads them after all.
public sealed class ProgressiveStream : Stream
{
    /// How far past the download a read may be and still wait for it rather than start again there:
    /// about what arrives while a new request is answered.
    const long Near = 256 * 1024;

    readonly Func<long, CancellationToken, Task<HttpResponseMessage>> fetch;
    readonly object gate = new();
    readonly List<(long From, long To)> have = []; // sorted, apart
    byte[] buffer;
    long length, position, cursor;
    bool ranges, final, disposed;
    Exception? failed;
    CancellationTokenSource? download;

    ProgressiveStream(HttpResponseMessage first, Func<long, CancellationToken, Task<HttpResponseMessage>> fetch)
    {
        this.fetch = fetch;
        length = first.Content.Headers.ContentLength ?? 0;
        ranges = length > 0 && first.Headers.AcceptRanges.Contains("bytes");
        buffer = new byte[Math.Clamp(length, 64 * 1024, int.MaxValue)];
        lock (gate) Begin(0, first);
    }

    /// The song from its first byte; `fetch(from)` answers with its bytes from `from` on (headers read).
    public static async Task<ProgressiveStream> Open(Func<long, CancellationToken, Task<HttpResponseMessage>> fetch, CancellationToken token = default) =>
        new(await fetch(0, token), fetch);

    /// Starts the download at `from`, dropping the one before (its bytes stay); under the gate.
    void Begin(long from, HttpResponseMessage? answered = null)
    {
        download?.Cancel();
        var stop = download = new CancellationTokenSource();
        cursor = from;
        _ = Task.Run(() => Fill(from, answered, stop.Token));
    }

    async Task Fill(long from, HttpResponseMessage? answered, CancellationToken stop)
    {
        try
        {
            using var response = answered ?? await fetch(from, stop);
            if (from > 0 && (response.StatusCode != HttpStatusCode.PartialContent || response.Content.Headers.ContentRange?.From != from))
            {
                // Not the range asked for: the whole song again, in order.
                lock (gate)
                {
                    if (stop.IsCancellationRequested) return;
                    ranges = false;
                    cursor = from = 0;
                }
            }
            await using var source = await response.Content.ReadAsStreamAsync(stop);
            var chunk = new byte[64 * 1024];
            var at = from;
            while (true)
            {
                var n = await source.ReadAsync(chunk, stop);
                if (n == 0) break;
                lock (gate)
                {
                    if (stop.IsCancellationRequested) return;
                    if (at + n > buffer.Length) Array.Resize(ref buffer, (int)Math.Min(int.MaxValue, Math.Max(buffer.Length * 2L, at + n)));
                    Array.Copy(chunk, 0, buffer, at, n);
                    Have(at, at + n);
                    at += n;
                    cursor = at;
                    length = Math.Max(length, at);
                    Monitor.PulseAll(gate);
                }
            }
            lock (gate)
            {
                if (stop.IsCancellationRequested) return;
                // Every download runs to the song's end: its length is known now.
                length = at;
                final = true;
                Monitor.PulseAll(gate);
            }
        }
        catch (Exception) when (stop.IsCancellationRequested) { }
        catch (Exception e)
        {
            lock (gate)
            {
                failed = e;
                Monitor.PulseAll(gate);
            }
        }
    }

    /// Notes [from, to) as arrived; under the gate.
    void Have(long from, long to)
    {
        var i = 0;
        while (i < have.Count && have[i].To < from) i++;
        while (i < have.Count && have[i].From <= to)
        {
            (from, to) = (Math.Min(from, have[i].From), Math.Max(to, have[i].To));
            have.RemoveAt(i);
        }
        have.Insert(i, (from, to));
    }

    /// How many bytes from `at` on have arrived, in a row; under the gate.
    long Ready(long at)
    {
        foreach (var (from, to) in have)
            if (from <= at && at < to) return to - at;
        return 0;
    }

    /// Waits for all `count` bytes (or the end of the song): miniaudio's decoders (dr_flac, dr_mp3,
    /// dr_wav) take a short read for the end of the file, and a FLAC read short mid-song crashed them.
    public override int Read(byte[] destination, int offset, int count)
    {
        lock (gate)
        {
            while (true)
            {
                if (disposed) return 0;
                var want = final ? Math.Min(count, length - position) : count;
                if (want <= 0) return 0;
                var ready = Ready(position);
                if (ready >= want)
                {
                    Array.Copy(buffer, position, destination, offset, want);
                    position += want;
                    return (int)want;
                }
                if (failed is not null) throw new IOException("The song stopped arriving.", failed);
                // The first byte missing: the download is nearly there, or it starts again there.
                var gap = position + ready;
                if (ranges && !(gap >= cursor && gap <= cursor + Near)) Begin(gap);
                Monitor.Wait(gate);
            }
        }
    }

    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => false;

    public override long Length
    {
        get
        {
            lock (gate) return length;
        }
    }

    public override long Position
    {
        get => position;
        set => position = Math.Max(0, value);
    }

    public override long Seek(long offset, SeekOrigin origin) => Position = origin switch
    {
        SeekOrigin.Current => position + offset,
        SeekOrigin.End => Length + offset,
        _ => offset,
    };

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            lock (gate)
            {
                download?.Cancel();
                disposed = true;
                Monitor.PulseAll(gate);
            }
        base.Dispose(disposing);
    }
}
