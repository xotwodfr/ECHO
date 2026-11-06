namespace Echo.Stage;

// Reverb mode's per-frame state (src/client/stage/reverb.ts; VISUALIZER_SPEC.md §4.2–§4.5, §7; Android's
// Reverb.kt): flow from intensity, bass breathing, onset rings (≤ 3), the key flare, feedback decay and
// warp, scaled by the intensity setting and held under the photosensitivity limit (§7.3), which always
// has the last word. Pure: the renderer only uploads what this returns.

public enum Intensity { Subtle, Balanced, Expressive }

sealed record IntensitySettings(double Breathe, double Threshold, double I0Cap, int Rings, double FlowHigh, double PoolBass, double Decay)
{
    public static IntensitySettings Of(Intensity i) => i switch
    {
        Intensity.Subtle => new(0.05, 0.55, 0.12, 2, 1.3, 0.03, -0.02),
        Intensity.Balanced => new(0.1, 0.35, 0.22, 3, 1.6, 0.06, 0.0),
        _ => new(0.15, 0.25, 0.22, 3, 2.0, 0.09, 0.02),
    };
}

public sealed record Ring(double X, double Y, double Age, double I0, double Tau)
{
    const double RingSpeed = 0.55; // H per second

    /// Ring light at its age: I₀·e^{−age/τ}.
    public double Light() => I0 * Math.Exp(-Age / Tau);

    public double Radius() => RingSpeed * Age;
}

public sealed record ReverbFrame(double Flow, double Exposure, IReadOnlyList<Ring> Rings, double Flare, double Decay,
    double Warp, double PoolScale, double KeyScale);

public sealed class Reverb(Intensity intensity = Intensity.Expressive, long seed = 1)
{
    /// §7.3: all luminance-driving terms together change by at most this per second.
    public const double LumaSlewPerS = 0.24;
    const double Flare = 0.15;
    const double FlareMs = 120;

    readonly IntensitySettings s = IntensitySettings.Of(intensity);
    double flow;
    List<Ring> rings = [];
    double flareMs;
    double shownExposure = 1.0;
    double shownRings;
    double shownFlare;
    long rnd = seed & 0xFFFFFFFFL;

    double Rand()
    {
        rnd = (rnd * 1664525 + 1013904223) & 0xFFFFFFFFL;
        return rnd / 4294967296.0;
    }

    public ReverbFrame Step(Features f, double dtMs, double keyX, double keyY)
    {
        var dt = dtMs / 1000;
        var it = f.Available ? f.Intensity : 0.6;
        var g = 0.35 + 0.65 * it;
        var busy = it > 0.75 ? s.FlowHigh : 1.0;
        flow += (it < 0.2 ? 0.04 : (0.04 + 0.1 * it) * busy) * dt;

        var threshold = it < 0.2 ? Math.Max(0.5, s.Threshold) : s.Threshold;
        rings = rings.Select(r => r with { Age = r.Age + dt }).Where(r => r.Light() > 0.002).ToList();
        if (f.Available && f.Onset > threshold)
        {
            var atKey = Rand() < 0.7;
            var ring = new Ring(
                X: atKey ? keyX : 0.2 + 0.6 * Rand(),
                Y: atKey ? keyY : 0.2 + 0.5 * Rand(),
                Age: 0,
                I0: Math.Min(s.I0Cap, 0.1 + 0.12 * f.Onset),
                Tau: 0.45 + 0.6 * (1 - it));
            if (rings.Count >= s.Rings)
            {
                rings = rings.OrderByDescending(r => r.Age).ToList();
                rings.RemoveAt(0);
            }
            rings.Add(ring);
            flareMs = FlareMs;
        }
        flareMs = Math.Max(0, flareMs - dtMs);

        var breathe = it < 0.2 ? Math.Min(0.03, s.Breathe) : s.Breathe;
        var wantExposure = 1 + breathe * g * (f.Available ? f.Bass : 0);
        var wantRings = rings.Sum(r => r.Light());
        var wantFlare = flareMs > 0 ? Flare : 0;

        // §7.3: the combined change is slew-limited; ring and flare light may fall at once.
        shownRings = Math.Min(shownRings, wantRings);
        shownFlare = Math.Min(shownFlare, wantFlare);
        var budget = LumaSlewPerS * dt;
        var d0 = wantExposure - shownExposure;
        var d1 = wantRings - shownRings;
        var d2 = wantFlare - shownFlare;
        var total = Math.Abs(d0) + Math.Abs(d1) + Math.Abs(d2);
        var k = total > budget ? budget / total : 1.0;
        shownExposure += d0 * k;
        shownRings += d1 * k;
        shownFlare += d2 * k;
        var ringGain = wantRings > 0 ? Math.Min(1, shownRings / wantRings) : 0;

        return new ReverbFrame(
            Flow: flow,
            Exposure: shownExposure,
            Rings: rings.Select(r => r with { I0 = r.I0 * ringGain }).ToList(),
            Flare: shownFlare,
            Decay: Math.Min(0.97, 0.9 + 0.06 * (1 - it) + s.Decay),
            Warp: Math.Min(0.003, 0.002 * (1 + 0.5 * (f.Available ? f.High : 0))),
            PoolScale: 1 + s.PoolBass * (f.Available ? f.Bass : 0),
            KeyScale: 1 + 0.08 * (f.Available ? f.Sub : 0));
    }

    /// §7.3: ring and flare tints never read as saturated red, R/(R+G+B) &lt; 0.8.
    public static float[] SafeTint(float r, float g, float b)
    {
        var sum = r + g + b;
        if (sum <= 0 || r / sum < 0.8f) return [r, g, b];
        var lift = (r / 0.79f - sum) / 2;
        return [r, g + lift, b + lift];
    }
}
