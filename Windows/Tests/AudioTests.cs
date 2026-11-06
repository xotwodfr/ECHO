using Echo.Playback;
using Echo.Stage;

namespace Echo.Tests;

public class AudioTests
{
    [Fact]
    public async Task TheTapHearsTheSong()
    {
        var wav = Path.Combine(Path.GetTempPath(), $"echo-sine-{Guid.NewGuid():N}.wav");
        File.WriteAllBytes(wav, Sine(1000, seconds: 2, rate: 44_100));
        try
        {
            var tap = new AudioTap();
            using var output = new AudioOut(tap, nullDevice: true);
            await output.Open(wav);
            output.Play();

            // What is audible trails the writes by the output latency, and a loaded machine writes in
            // bursts: wait for the tone (up to 3 s) rather than for a fixed time.
            var window = new float[2048];
            var binHz = 0.0;
            var peakHz = 0.0;
            for (var tries = 0; tries < 30 && Math.Abs(peakHz - 1000) > binHz; tries++)
            {
                await Task.Delay(100);
                if (!tap.Window(window)) continue;
                var re = window.Select(s => (double)s).ToArray();
                var im = new double[re.Length];
                AnalyserFeatures.Fft(re, im);
                binHz = tap.SampleRate / (double)re.Length;
                peakHz = Enumerable.Range(1, re.Length / 2 - 1).MaxBy(i => re[i] * re[i] + im[i] * im[i]) * binHz;
            }
            Assert.InRange(peakHz, 1000 - binHz, 1000 + binHz);

            output.Pause();
            var at = output.Position;
            await Task.Delay(200);
            Assert.Equal(at, output.Position);
        }
        finally
        {
            File.Delete(wav);
        }
    }

    /// A 16-bit stereo PCM WAV of a sine at `hz`.
    static byte[] Sine(double hz, double seconds, int rate)
    {
        var frames = (int)(seconds * rate);
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("RIFF"u8);
        w.Write(36 + frames * 4);
        w.Write("WAVEfmt "u8);
        w.Write(16);
        w.Write((short)1); // PCM
        w.Write((short)2);
        w.Write(rate);
        w.Write(rate * 4);
        w.Write((short)4);
        w.Write((short)16);
        w.Write("data"u8);
        w.Write(frames * 4);
        for (var i = 0; i < frames; i++)
        {
            var s = (short)(Math.Sin(2 * Math.PI * hz * i / rate) * 12_000);
            w.Write(s);
            w.Write(s);
        }
        return ms.ToArray();
    }
}
