using System.Diagnostics;

namespace Echo.Playback;

/// The decoded audio on its way to the speaker (VISUALIZER_SPEC.md §3.2; Android's AudioTap.kt): a mono
/// ring of the last ~1.5 s, each write stamped with the time it was made. The room reads the window
/// that is audible now: what was written LatencyMs ago, the time the output buffer holds it.
public sealed class AudioTap(Func<long>? nowNs = null)
{
    // ponytail: a fixed output-latency estimate for WASAPI shared mode (SoundFlow's buffer plus the
    // device); measure it on Windows if the room ever looks late or early.
    public const long LatencyMs = 120;
    const int Size = 1 << 16;
    const int Stamps = 64;

    readonly Func<long> now = nowNs ?? (() => Stopwatch.GetTimestamp() * (1_000_000_000L / Stopwatch.Frequency));
    readonly float[] ring = new float[Size];
    readonly long[] stampFrames = new long[Stamps];
    readonly long[] stampNs = new long[Stamps];
    long written; // mono frames since start
    int stamp;
    long lastWriteNs;

    public int SampleRate { get; private set; } = 44_100;

    public void Write(ReadOnlySpan<float> interleaved, int channels, int sampleRate)
    {
        var ch = Math.Max(1, channels);
        lock (ring)
        {
            SampleRate = sampleRate;
            for (var f = 0; f + ch <= interleaved.Length; f += ch)
            {
                var sum = 0f;
                for (var c = 0; c < ch; c++) sum += interleaved[f + c];
                ring[written & (Size - 1)] = sum / ch;
                written++;
            }
            var t = now();
            stampFrames[stamp] = written;
            stampNs[stamp] = t;
            stamp = (stamp + 1) % Stamps;
            lastWriteNs = t;
        }
    }

    /// The `output.Length` frames that end at what is audible now, or false while there is nothing (no
    /// audio yet, or it stopped flowing more than a second ago: paused).
    public bool Window(float[] output)
    {
        lock (ring)
        {
            var t = now();
            if (written < output.Length || t - lastWriteNs > 1_000_000_000L + LatencyMs * 1_000_000L) return false;
            var at = t - LatencyMs * 1_000_000L;
            // The newest write made before `at`, and the frames played since it at the sample rate.
            var best = -1;
            for (var i = 0; i < Stamps; i++)
                if (stampNs[i] > 0 && stampNs[i] <= at && (best < 0 || stampNs[i] > stampNs[best])) best = i;
            var end = best < 0
                ? written - LatencyMs * SampleRate / 1000
                : Math.Min(written, stampFrames[best] + (at - stampNs[best]) * SampleRate / 1_000_000_000L);
            if (end < output.Length || written - end > Size - output.Length) return false;
            var start = end - output.Length;
            for (var i = 0; i < output.Length; i++) output[i] = ring[(start + i) & (Size - 1)];
            return true;
        }
    }
}
