namespace Echo.Stage.Lyrics;

// Damped harmonic springs (springs.ts, LYRICS_EXPERIENCE.md §6.1; Android's Springs.kt), integrated in
// closed form: one step is the exact solution for a target held over `dt`, so the path does not depend
// on the frame rate and never goes unstable.

public sealed class Spring(double x = 0, double v = 0)
{
    public double X = x;
    public double V = v;
}

public sealed record SpringParams(double F, double Zeta);

public static class Springs
{
    public const double MaxSpringDtMs = 100;

    public static readonly SpringParams Slow = new(L.Springs.Slow.F, L.Springs.Slow.Zeta);
    public static readonly SpringParams Lift = new(L.Springs.Lift.F, L.Springs.Lift.Zeta);
    public static readonly SpringParams Impulse = new(L.Springs.Impulse.F, L.Springs.Impulse.Zeta);

    public static Spring Step(Spring s, double target, SpringParams p, double dtMs)
    {
        var t = Math.Clamp(dtMs, 0, MaxSpringDtMs) / 1000;
        if (t == 0) return s;
        var w = 2 * Math.PI * p.F;
        var z = p.Zeta;
        var u0 = s.X - target;
        var v0 = s.V;
        double u, v;
        if (Math.Abs(z - 1) < 1e-6)
        {
            var e = Math.Exp(-w * t);
            var b = v0 + w * u0;
            u = (u0 + b * t) * e;
            v = (b - w * (u0 + b * t)) * e;
        }
        else if (z < 1)
        {
            var wd = w * Math.Sqrt(1 - z * z);
            var e = Math.Exp(-z * w * t);
            var c = Math.Cos(wd * t);
            var sn = Math.Sin(wd * t);
            var b = (v0 + z * w * u0) / wd;
            u = e * (u0 * c + b * sn);
            v = e * ((b * wd - z * w * u0) * c - (u0 * wd + z * w * b) * sn);
        }
        else
        {
            var r = w * Math.Sqrt(z * z - 1);
            var r1 = -z * w + r;
            var r2 = -z * w - r;
            var c2 = (v0 - r1 * u0) / (r2 - r1);
            var c1 = u0 - c2;
            var e1 = Math.Exp(r1 * t);
            var e2 = Math.Exp(r2 * t);
            u = c1 * e1 + c2 * e2;
            v = c1 * r1 * e1 + c2 * r2 * e2;
        }
        s.X = target + u;
        s.V = v;
        return s;
    }

    public static Spring Snap(Spring s, double target)
    {
        s.X = target;
        s.V = 0;
        return s;
    }

    /// `line.normal` for a hand-over `gapMs` apart: 2.35 Hz at 100 ms down to 2.0 Hz at 800 ms.
    public static SpringParams LineNormal(double gapMs)
    {
        var n = Math.Clamp((gapMs - 100) / 700, 0, 1);
        return new SpringParams(L.Springs.FMin + (L.Springs.FMax - L.Springs.FMin) * Math.Pow(1 - n, 0.2), L.Springs.ZNormal);
    }
}
