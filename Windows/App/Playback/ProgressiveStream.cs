namespace Echo.Playback;

/// A song arriving over HTTP that can be read as it arrives: a background copy fills a buffer the size
/// the server announced, and a read waits only for the bytes it asks for, not for the whole song. It
/// seeks anywhere (a read past what has arrived waits for it).
public sealed class ProgressiveStream : Stream
{
    readonly HttpResponseMessage response;
    readonly CancellationTokenSource stop = new();
    readonly object gate = new();
    readonly long announced;
    byte[] buffer;
    long arrived, position;
    bool done;
    Exception? failed;

    public ProgressiveStream(HttpResponseMessage response)
    {
        this.response = response;
        announced = response.Content.Headers.ContentLength ?? 0;
        buffer = new byte[Math.Clamp(announced, 64 * 1024, int.MaxValue)];
        _ = Task.Run(Fill);
    }

    async Task Fill()
    {
        try
        {
            await using var source = await response.Content.ReadAsStreamAsync(stop.Token);
            var chunk = new byte[64 * 1024];
            while (true)
            {
                var n = await source.ReadAsync(chunk, stop.Token);
                if (n == 0) break;
                lock (gate)
                {
                    if (arrived + n > buffer.Length) Array.Resize(ref buffer, (int)Math.Min(int.MaxValue, Math.Max(buffer.Length * 2L, arrived + n)));
                    Array.Copy(chunk, 0, buffer, arrived, n);
                    arrived += n;
                    Monitor.PulseAll(gate);
                }
            }
        }
        catch (Exception e)
        {
            failed = e;
        }
        finally
        {
            lock (gate)
            {
                done = true;
                Monitor.PulseAll(gate);
            }
            response.Dispose();
        }
    }

    /// Waits for all `count` bytes (or the end of the song): miniaudio's decoders (dr_flac, dr_mp3,
    /// dr_wav) take a short read for the end of the file, and a FLAC read short mid-song crashed them.
    public override int Read(byte[] destination, int offset, int count)
    {
        lock (gate)
        {
            while (position + count > arrived && !done) Monitor.Wait(gate);
            if (position >= arrived)
            {
                if (failed is not null && failed is not OperationCanceledException) throw new IOException("The song stopped arriving.", failed);
                return 0;
            }
            var n = (int)Math.Min(count, arrived - position);
            Array.Copy(buffer, position, destination, offset, n);
            position += n;
            return n;
        }
    }

    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => false;

    public override long Length
    {
        get
        {
            lock (gate) return done ? arrived : Math.Max(announced, arrived);
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
        {
            stop.Cancel();
            lock (gate)
            {
                done = true;
                Monitor.PulseAll(gate);
            }
        }
        base.Dispose(disposing);
    }
}
