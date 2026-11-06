using Echo.Playback;

namespace Echo.Stage;

/// One frame's audio features (src/shared/types.ts Features, VISUALIZER_SPEC.md §3.4).
public sealed record Features(
    bool Available = false,
    double Sub = 0,
    double Bass = 0,
    double Mid = 0,
    double High = 0,
    double Onset = 0,
    double Intensity = 0.6,
    double BassImpulse = 0)
{
    /// No audio to analyse: everything 0 but intensity (§3.4).
    public static readonly Features Silent = new();
}

/// Live features from the audio tap (src/client/playback/analyser.ts; Android's Features.kt): the Web
/// Audio analyser's spectrum (2048-point FFT, Blackman window, magnitudes / N in dB) reproduced, then
/// four bands with one-pole envelopes normalised by their running p95, spectral-flux onsets against the
/// median and MAD of the last 1.5 s, RMS, intensity and bassImpulse. Nothing is allocated per frame.
public sealed class AnalyserFeatures(AudioTap tap)
{
    sealed record Band(double Lo, double Hi, double AttackMs, double ReleaseMs);

    static readonly Band[] Bands =
    [
        new(20, 60, 10, 180), // sub
        new(20, 250, 10, 180), // bass
        new(250, 4000, 25, 250), // mid
        new(4000, 12000, 5, 120), // high
    ];
    const int N = 2048;
    const int Bins = N / 2;
    const double DbMin = -100;
    const double DbFloor = -60;
    const int Buckets = 64;
    const double Decay = 0.995;
    const int FluxWindow = 90;
    const double OnsetGapMs = 120;
    const double RateWindowMs = 4000;

    /// A running 95th percentile of dB values: a 64-bucket histogram that forgets 0.5% per frame.
    sealed class P95
    {
        readonly double[] h = new double[Buckets];
        double total;

        public void Add(double db)
        {
            for (var i = 0; i < Buckets; i++) h[i] *= Decay;
            total = total * Decay + 1;
            h[Math.Clamp((int)Math.Floor((db - DbMin) / -DbMin * Buckets), 0, Buckets - 1)] += 1;
        }

        public double Value()
        {
            var acc = 0.0;
            for (var i = 0; i < Buckets; i++)
            {
                acc += h[i];
                if (acc >= 0.95 * total) return Math.Max(DbFloor, DbMin + (i + 1.0) / Buckets * -DbMin);
            }
            return DbFloor;
        }
    }

    static double ToDb(double power) => power > 0 ? 10 * Math.Log10(power) : DbMin;

    static double Norm(double db, double p95) => Math.Min(1, Math.Max(0, Math.Pow(10, (db - p95) / 10)));

    static double OnePole(double prev, double x, double dtMs, double attackMs, double releaseMs) =>
        prev + (x - prev) * (1 - Math.Exp(-dtMs / (x > prev ? attackMs : releaseMs)));

    readonly float[] time = new float[N];
    readonly double[] re = new double[N];
    readonly double[] im = new double[N];
    readonly double[] spectrum = new double[Bins];
    readonly double[] prevMag = new double[Bins];
    readonly double[] window = Enumerable.Range(0, N)
        .Select(i => 0.42 - 0.5 * Math.Cos(2 * Math.PI * i / N) + 0.08 * Math.Cos(4 * Math.PI * i / N)).ToArray();
    readonly P95[] bandP95 = [new(), new(), new(), new()];
    readonly P95 rmsP95 = new();
    readonly double[] env = new double[4];
    readonly double[] values = new double[4];
    readonly double[] flux = new double[FluxWindow];
    readonly double[] sorted = new double[FluxWindow];
    int fluxN;
    int fluxAt;
    readonly double[] onsets = Enumerable.Repeat(double.NegativeInfinity, 64).ToArray();
    int onsetHead;
    double lastOnset = double.NegativeInfinity;
    double rms;
    double intensity = 0.6;
    double prevBass;
    double now;
    Features last = Features.Silent;

    public Features Sample(double dtMs)
    {
        if (dtMs <= 0) return last;
        if (!tap.Window(time)) return last = Features.Silent;
        now += dtMs;
        SpectrumOf();
        var hzPerBin = tap.SampleRate / 2.0 / Bins;
        int Bin(double hz) => Math.Clamp((int)Math.Round(hz / hzPerBin), 0, Bins - 1);

        for (var b = 0; b < Bands.Length; b++)
        {
            var p = 0.0;
            for (var i = Bin(Bands[b].Lo); i <= Bin(Bands[b].Hi); i++) p += Math.Pow(10, spectrum[i] / 10);
            var db = ToDb(p);
            bandP95[b].Add(db);
            env[b] = OnePole(env[b], Norm(db, bandP95[b].Value()), dtMs, Bands[b].AttackMs, Bands[b].ReleaseMs);
            values[b] = env[b];
        }

        // Spectral flux over 2–12 kHz (half-wave rectified, log magnitude).
        var f = 0.0;
        var lo = Bin(2000);
        var hi = Bin(12000);
        for (var i = lo; i <= hi; i++)
        {
            var d = spectrum[i] - prevMag[i];
            if (d > 0) f += d;
            prevMag[i] = spectrum[i];
        }
        flux[fluxAt] = f;
        fluxAt = (fluxAt + 1) % FluxWindow;
        fluxN = Math.Min(FluxWindow, fluxN + 1);
        for (var i = 0; i < fluxN; i++) sorted[i] = flux[i];
        var median = MedianOfSorted();
        for (var i = 0; i < fluxN; i++) sorted[i] = Math.Abs(flux[i] - median);
        var mad = MedianOfSorted();
        var threshold = median + 1.5 * mad + 0.5 * (hi - lo + 1);
        var onset = 0.0;
        if (fluxN >= 10 && f > threshold && now - lastOnset >= OnsetGapMs)
        {
            onset = Math.Min(1, (f - threshold) / threshold);
            lastOnset = now;
            onsets[onsetHead] = now;
            onsetHead = (onsetHead + 1) % onsets.Length;
        }

        var sq = 0.0;
        foreach (var s in time) sq += s * s;
        var rmsDb = ToDb(sq / N);
        rmsP95.Add(rmsDb);
        rms = OnePole(rms, Norm(rmsDb, rmsP95.Value()), dtMs, 300, 300);
        var recent = onsets.Count(t => now - t < RateWindowMs);
        var rate = Math.Min(1, recent / (RateWindowMs / 1000) / 4);
        intensity = OnePole(intensity, 0.7 * rms + 0.3 * rate, dtMs, 2000, 2000);

        var bass = values[1];
        var impulse = Math.Min(1, Math.Max(0, (bass - prevBass) / Math.Max(1, dtMs) * 40));
        prevBass = bass;
        return last = new Features(true, values[0], bass, values[2], values[3], onset, intensity, impulse);
    }

    double MedianOfSorted()
    {
        Array.Sort(sorted, 0, fluxN);
        var m = fluxN >> 1;
        return fluxN % 2 == 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
    }

    /// The analyser's dB spectrum: Blackman-windowed FFT, |X| / N, 20·log10.
    void SpectrumOf()
    {
        for (var i = 0; i < N; i++)
        {
            re[i] = time[i] * window[i];
            im[i] = 0;
        }
        Fft(re, im);
        for (var k = 0; k < Bins; k++)
        {
            var mag = Math.Sqrt(re[k] * re[k] + im[k] * im[k]) / N;
            spectrum[k] = mag > 0 ? Math.Max(DbMin, 20 * Math.Log10(mag)) : DbMin;
        }
    }

    /// In-place iterative radix-2 FFT (n a power of two).
    internal static void Fft(double[] re, double[] im)
    {
        var n = re.Length;
        var j = 0;
        for (var i = 1; i < n; i++)
        {
            var bit = n >> 1;
            while ((j & bit) != 0)
            {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if (i < j)
            {
                (re[i], re[j]) = (re[j], re[i]);
                (im[i], im[j]) = (im[j], im[i]);
            }
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * Math.PI / len;
            var wr = Math.Cos(ang);
            var wi = Math.Sin(ang);
            for (var i = 0; i < n; i += len)
            {
                var cr = 1.0;
                var ci = 0.0;
                for (var k = 0; k < len / 2; k++)
                {
                    var ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                    var ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                    re[i + k + len / 2] = re[i + k] - ar;
                    im[i + k + len / 2] = im[i + k] - ai;
                    re[i + k] += ar;
                    im[i + k] += ai;
                    var nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }
}
