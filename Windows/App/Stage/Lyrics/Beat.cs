namespace Echo.Stage.Lyrics;

// The lyric field's response to the music (beat.ts; LYRICS_EXPERIENCE.md §12; Android's Beat.kt): one
// set of beat terms per frame, with the readability caps of §12.4 applied after summing.

public sealed record BeatTerms(double G, double Pulse, double Sustain, double GlowAdd);

public sealed class Beat
{
    static readonly double W0 = 2 * Math.PI * Springs.Impulse.F;
    static readonly double Wd = W0 * Math.Sqrt(1 - Springs.Impulse.Zeta * Springs.Impulse.Zeta);
    static readonly double TPeak = Math.Atan2(Wd, Springs.Impulse.Zeta * W0) / Wd;

    /// The kick that makes a unit impulse peak at 1.
    public static readonly double UnitKick = Wd / (Math.Exp(-Springs.Impulse.Zeta * W0 * TPeak) * Math.Sin(Wd * TPeak));

    readonly Spring bass = new();
    double sustainV;
    double intense;

    static double Smoothstep(double a, double b, double x)
    {
        var k = Math.Clamp((x - a) / (b - a), 0, 1);
        return k * k * (3 - 2 * k);
    }

    public BeatTerms Update(Features ft, double dt, double sinceHandover, double vocal, Mode mode, bool reduced)
    {
        var on = ft.Available && !reduced;
        var g = ft.Available ? 0.35 + 0.65 * Math.Clamp(ft.Intensity, 0, 1) : 0.6;
        var still = mode == Mode.Still;
        if (still || !on) Springs.Snap(bass, 0);
        else
        {
            Springs.Step(bass, 0, Springs.Impulse, dt);
            if (mode == Mode.Run) bass.V += L.Beat.BassForce * UnitKick * ft.BassImpulse * dt;
        }
        var v = Math.Clamp(vocal, 0, 1);
        if (still) sustainV = v;
        else
        {
            var tau = v > sustainV ? L.Beat.SustainAttackMs : L.Beat.SustainReleaseMs;
            sustainV += (v - sustainV) * (1 - Math.Exp(-dt / tau));
        }
        var intenseOn = ft.Available && ft.Intensity > L.Beat.IntenseAbove;
        intense = still ? (intenseOn ? 1 : 0) : Math.Clamp(intense + (intenseOn ? 1 : -1) * dt / L.Beat.PassageMs, 0, 1);
        var gate = on ? Smoothstep(L.Beat.QuietMs, L.Beat.QuietMs + 100, sinceHandover) : 0;
        return new BeatTerms(
            g,
            Math.Clamp(L.Beat.ScaleMax * g * bass.X * gate, -L.Beat.ScaleCap, L.Beat.ScaleCap),
            reduced ? 0 : sustainV,
            reduced ? 0 : L.Beat.IntenseGlow * intense);
    }

    /// The sustained-vocal heuristic (§12.3) for the active line at `t`.
    public static double VocalAt(IReadOnlyList<LyricWord>? words, bool lineActive, double mid, double t)
    {
        if (!lineActive) return 0;
        if (words is null || words.Count == 0) return mid;
        var w = words.FirstOrDefault(x => t >= x.Start && t < x.End);
        return w is null ? 0 : Smoothstep(600, 1500, t - w.Start) * mid;
    }

    /// Glow alpha and radius for a sustain level (§12.3), capped at AlphaMax.
    public static (double Alpha, double Radius) GlowFor(double sustain, double add) =>
        (Math.Min(L.Glow.AlphaMax, L.Glow.Alpha + (L.Glow.AlphaMax - L.Glow.Alpha) * sustain + add),
            L.Glow.Radius + (L.Glow.RadiusMax - L.Glow.Radius) * sustain);
}
