using System.Diagnostics;
using System.Net;
using Echo.Playback;

namespace Echo.Tests;

/// A song from the server, served at 4 MB/s (an internet connection's pace), makes sound long before it
/// has all arrived, from one request with the device's bearer header (no signed URL fetched first;
/// SoundFlow's NetworkDataProvider sent three and waited for the whole song: 4 s for a 15 MB FLAC).
/// Cover art embedded at the start of a FLAC or an MP3 is skipped with a Range request instead of
/// waited for, and a seek ahead plays at once. The songs are made here: 60 s of noise as WAV (FLAC
/// and MP3, and a 1600 px noise cover, when this machine's ffmpeg can make them; Windows CI has none).
[Collection("audio")]
public class StreamingStartTests(ITestOutputHelper output)
{
    const double BytesPerMs = 4 * 1024 * 1024 / 1000.0;

    static byte[]? Encode(string ext, bool art)
    {
        var wav = Path.Combine(Path.GetTempPath(), $"echo-noise-{Guid.NewGuid():N}.wav");
        var outFile = Path.ChangeExtension(wav, ext);
        var cover = Path.ChangeExtension(wav, ".png");
        try
        {
            var noise = new byte[44 + 60 * 44100 * 4];
            Random.Shared.NextBytes(noise);
            File.WriteAllBytes(wav, noise);
            using (var w = new FileStream(wav, FileMode.Open))
            using (var b = new BinaryWriter(w))
            {
                b.Write("RIFF"u8); b.Write(noise.Length - 8); b.Write("WAVEfmt "u8); b.Write(16); b.Write((short)1); b.Write((short)2);
                b.Write(44100); b.Write(44100 * 4); b.Write((short)4); b.Write((short)16); b.Write("data"u8); b.Write(noise.Length - 44);
            }
            if (ext == ".wav") return File.ReadAllBytes(wav);
            if (art && !Ffmpeg($"-f lavfi -i \"nullsrc=s=1600x1600,geq=random(1)*255:random(1)*255:random(1)*255\" -frames:v 1 \"{cover}\"")) return null;
            var picture = art ? $"-i \"{cover}\" -map 0:a -map 1:v -c:v copy -disposition:v attached_pic {(ext == ".mp3" ? "-id3v2_version 3" : "")}" : "";
            return Ffmpeg($"-i \"{wav}\" {picture} {(ext == ".mp3" ? "-b:a 320k" : "")} \"{outFile}\"") ? File.ReadAllBytes(outFile) : null;
        }
        finally
        {
            File.Delete(wav);
            File.Delete(outFile);
            File.Delete(cover);
        }
    }

    static bool Ffmpeg(string args)
    {
        try
        {
            using var ff = Process.Start(new ProcessStartInfo("ffmpeg", $"-nostdin -loglevel error -y {args}") { RedirectStandardError = true, RedirectStandardInput = true });
            if (ff is null) return false;
            ff.StandardError.ReadToEnd();
            ff.WaitForExit();
            return ff.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false; // no ffmpeg
        }
    }

    /// Serves `bytes` at 4 MB/s in 64 KB pieces, taking ranges as Navidrome does for a song as stored;
    /// keeps each request as "METHOD range" with whether it carried the bearer header.
    static (HttpListener Listener, int Port, List<string> Requests) Serve(byte[] bytes, string type)
    {
        var requests = new List<string>();
        var listener = new HttpListener();
        var port = Random.Shared.Next(20000, 30000);
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        _ = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); } catch { return; }
                _ = Task.Run(async () =>
                {
                    var range = ctx.Request.Headers["Range"];
                    lock (requests) requests.Add($"{ctx.Request.HttpMethod} {range}{(ctx.Request.Headers["Authorization"] == "Bearer device" ? "" : " (no token)")}");
                    var from = range is { } r && r.StartsWith("bytes=") ? long.Parse(r[6..].TrimEnd('-')) : 0;
                    ctx.Response.ContentType = type;
                    ctx.Response.Headers["Accept-Ranges"] = "bytes";
                    if (from > 0)
                    {
                        ctx.Response.StatusCode = 206;
                        ctx.Response.Headers["Content-Range"] = $"bytes {from}-{bytes.Length - 1}/{bytes.Length}";
                    }
                    ctx.Response.ContentLength64 = bytes.Length - from;
                    try
                    {
                        for (var i = (int)from; i < bytes.Length; i += 65536)
                        {
                            await ctx.Response.OutputStream.WriteAsync(bytes.AsMemory(i, Math.Min(65536, bytes.Length - i)));
                            await Task.Delay(16);
                        }
                        ctx.Response.Close();
                    }
                    catch { } // the player dropped it (it jumped ahead)
                });
            }
        });
        return (listener, port, requests);
    }

    /// The song's bytes up to `upTo`, then the connection drops (an error) or goes silent (sleep, a new
    /// Wi-Fi network: nothing more ever comes).
    sealed class Cut(byte[] bytes, int upTo, bool silent) : Stream
    {
        int at;

        public override async ValueTask<int> ReadAsync(Memory<byte> into, CancellationToken token = default)
        {
            if (at >= upTo)
            {
                if (!silent) throw new IOException("connection reset");
                await Task.Delay(Timeout.Infinite, token);
            }
            var n = Math.Min(into.Length, upTo - at);
            bytes.AsMemory(at, n).CopyTo(into);
            at += n;
            return n;
        }

        public override Task<int> ReadAsync(byte[] b, int o, int c, CancellationToken token) => ReadAsync(b.AsMemory(o, c), token).AsTask();
        public override int Read(byte[] b, int o, int c) => ReadAsync(b.AsMemory(o, c)).AsTask().GetAwaiter().GetResult();
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => at; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
        public override void SetLength(long v) => throw new NotSupportedException();
        public override void Write(byte[] b, int o, int c) => throw new NotSupportedException();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ASongWhoseConnectionDiesCarriesOnFromWhereItGotTo(bool silent)
    {
        var bytes = new byte[300_000];
        Random.Shared.NextBytes(bytes);
        var asked = new List<long>();
        Task<HttpResponseMessage> Fetch(long from, CancellationToken token)
        {
            int n;
            lock (asked)
            {
                asked.Add(from);
                n = asked.Count;
            }
            Stream body = n == 1 ? new Cut(bytes, 100_000, silent) : new MemoryStream(bytes, (int)from, bytes.Length - (int)from);
            var r = new HttpResponseMessage(from > 0 ? HttpStatusCode.PartialContent : HttpStatusCode.OK) { Content = new StreamContent(body) };
            r.Content.Headers.ContentLength = bytes.Length - from;
            r.Headers.AcceptRanges.Add("bytes");
            if (from > 0) r.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(from, bytes.Length - 1, bytes.Length);
            return Task.FromResult(r);
        }

        using var song = await ProgressiveStream.Open(Fetch, quiet: TimeSpan.FromMilliseconds(300));
        var read = new byte[bytes.Length];
        var all = Task.Run(() => song.ReadExactly(read), TestContext.Current.CancellationToken);
        Assert.Same(all, await Task.WhenAny(all, Task.Delay(10_000, TestContext.Current.CancellationToken)));
        await all;
        Assert.Equal(bytes, read);
        lock (asked) Assert.Equal([0L, 100_000L], asked);
    }

    [Theory]
    [InlineData(".wav", "audio/wav", false)]
    [InlineData(".flac", "audio/flac", false)]
    [InlineData(".mp3", "audio/mpeg", false)]
    [InlineData(".flac", "audio/flac", true)]
    [InlineData(".mp3", "audio/mpeg", true)]
    public async Task ASongSoundsBeforeItHasAllArrived(string ext, string type, bool art)
    {
        if (Encode(ext, art) is not { } bytes) return;
        var (listener, port, requests) = Serve(bytes, type);
        using var _ = listener;
        var api = new Api($"http://127.0.0.1:{port}") { Token = "device" };
        var track = QueueTests.Album(1)[0] with { ContentType = type };
        using var audio = new AudioOut(nullDevice: true);
        var clock = Stopwatch.StartNew();
        await audio.Open((from, token) => api.Stream(track, from, token), play: true);
        while (audio.Position <= TimeSpan.Zero && clock.ElapsedMilliseconds < 20_000) await Task.Delay(5);
        var first = clock.ElapsedMilliseconds;
        List<string> asked;
        lock (requests) asked = [.. requests];
        output.WriteLine($"{track.ContentType}{(art ? " with cover" : "")} ({bytes.Length / 1048576.0:F1} MB at 4 MB/s, all in after {bytes.Length / BytesPerMs:F0} ms): first sound at {first} ms; requests: {string.Join(", ", asked)}");
        // Well before the song is in: a decoder that reads it all first (MP3's seek table) fails this.
        Assert.True(first < Math.Min(800, bytes.Length / BytesPerMs / 3), $"first sound at {first} ms");
        Assert.Equal("GET ", asked[0]); // one request, with the device's header
        if (art) Assert.Contains(asked, r => r.StartsWith("GET bytes=")); // the cover jumped over
        else Assert.Single(asked);

        // A seek well past what has arrived: the caller (the window) goes on at once, and a song as
        // stored is fetched from there rather than waited for.
        var asking = clock.ElapsedMilliseconds;
        var seek = audio.Seek(TimeSpan.FromSeconds(40));
        Assert.True(clock.ElapsedMilliseconds - asking < 50, $"Seek held its caller {clock.ElapsedMilliseconds - asking} ms");
        await seek.WaitAsync(TimeSpan.FromSeconds(20), TestContext.Current.CancellationToken);
        output.WriteLine($"seek to 0:40 landed after {clock.ElapsedMilliseconds - asking} ms");
        Assert.InRange(audio.Position.TotalSeconds, 39.5, 42);
        listener.Stop();
    }
}
