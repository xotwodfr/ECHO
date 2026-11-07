using System.Diagnostics;
using System.Net;
using Echo.Playback;

namespace Echo.Tests;

/// A song from a URL served at 4 MB/s (an internet connection's pace) makes sound long before it has
/// all arrived, from one request (SoundFlow's NetworkDataProvider sent three and waited for the whole
/// song: 4 s for a 15 MB FLAC). The songs are made here: 60 s of noise as WAV (FLAC and MP3 when this
/// machine's ffmpeg can make them; Windows CI has none).
[Collection("audio")]
public class StreamingStartTests(ITestOutputHelper output)
{
    static byte[]? Encode(string ext)
    {
        var wav = Path.Combine(Path.GetTempPath(), $"echo-noise-{Guid.NewGuid():N}.wav");
        var outFile = Path.ChangeExtension(wav, ext);
        try
        {
            var noise = new byte[44 + 60 * 44100 * 4];
            Random.Shared.NextBytes(noise);
            File.WriteAllBytes(wav, noise);
            using var w = new FileStream(wav, FileMode.Open);
            using var b = new BinaryWriter(w);
            b.Write("RIFF"u8); b.Write(noise.Length - 8); b.Write("WAVEfmt "u8); b.Write(16); b.Write((short)1); b.Write((short)2);
            b.Write(44100); b.Write(44100 * 4); b.Write((short)4); b.Write((short)16); b.Write("data"u8); b.Write(noise.Length - 44);
            b.Flush();
            w.Close();
            if (ext == ".wav") return File.ReadAllBytes(wav);
            var ff = Process.Start(new ProcessStartInfo("ffmpeg", $"-nostdin -loglevel error -y -i \"{wav}\" {(ext == ".mp3" ? "-b:a 320k" : "")} \"{outFile}\"") { RedirectStandardError = true, RedirectStandardInput = true });
            if (ff is null) return null;
            ff.StandardError.ReadToEnd();
            ff.WaitForExit();
            return ff.ExitCode == 0 ? File.ReadAllBytes(outFile) : null;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return null; // no ffmpeg
        }
        finally
        {
            File.Delete(wav);
            File.Delete(outFile);
        }
    }

    [Theory]
    [InlineData(".wav", "audio/wav")]
    [InlineData(".flac", "audio/flac")]
    [InlineData(".mp3", "audio/mpeg")]
    public async Task ASongSoundsBeforeItHasAllArrived(string ext, string type)
    {
        if (Encode(ext) is not { } bytes) return;
        var name = "song" + ext;
        var requests = new List<string>();
        using var listener = new HttpListener();
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
                    lock (requests) requests.Add($"{ctx.Request.HttpMethod} {ctx.Request.Headers["Range"]}");
                    ctx.Response.ContentType = type;
                    ctx.Response.ContentLength64 = bytes.Length;
                    try
                    {
                        if (ctx.Request.HttpMethod == "HEAD") { ctx.Response.Close(); return; }
                        // 4 MB/s, in 64 KB pieces.
                        for (var i = 0; i < bytes.Length; i += 65536)
                        {
                            await ctx.Response.OutputStream.WriteAsync(bytes.AsMemory(i, Math.Min(65536, bytes.Length - i)));
                            await Task.Delay(16);
                        }
                        ctx.Response.Close();
                    }
                    catch { }
                });
            }
        });
        using var audio = new AudioOut(nullDevice: true);
        var clock = Stopwatch.StartNew();
        await audio.Open($"http://127.0.0.1:{port}/{name}");
        var opened = clock.ElapsedMilliseconds;
        audio.Play();
        while (audio.Position <= TimeSpan.Zero && clock.ElapsedMilliseconds < 20_000) await Task.Delay(5);
        var first = clock.ElapsedMilliseconds;
        output.WriteLine($"{name} ({bytes.Length / 1048576.0:F1} MB at 4 MB/s, all in after {bytes.Length / 4194304.0 * 1000:F0} ms): Open returned after {opened} ms, first sound at {first} ms; requests: {string.Join(", ", requests)}");
        // Well before the song is in: a decoder that reads it all first (MP3's seek table) fails this.
        var allIn = bytes.Length / 4194304.0 * 1000;
        Assert.True(first < Math.Min(800, allIn / 3), $"first sound at {first} ms, all in after {allIn:F0} ms");
        Assert.Equal(["GET "], requests);
        // A seek past what has arrived: the caller (the window) goes on at once, the seek lands once
        // those bytes are in.
        var asked = clock.ElapsedMilliseconds;
        var seek = audio.Seek(TimeSpan.FromSeconds(40));
        Assert.True(clock.ElapsedMilliseconds - asked < 50, $"Seek held its caller {clock.ElapsedMilliseconds - asked} ms");
        await seek.WaitAsync(TimeSpan.FromSeconds(20), TestContext.Current.CancellationToken);
        Assert.InRange(audio.Position.TotalSeconds, 39.5, 42);
        listener.Stop();
    }
}
