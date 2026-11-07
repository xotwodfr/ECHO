namespace Echo.Stage;

/// A damped spring moved in closed form (springs.ts; the web's and Android's lyric motion): one step is
/// the exact solution for a target held over `dt`, so the path does not depend on the frame rate and
/// never goes unstable. `f` in Hz, `zeta` 1 for no overshoot.
public struct Spring(double x)
{
    public double X = x;
    public double V;

    public readonly bool Settled(double target) => Math.Abs(X - target) < 0.05 && Math.Abs(V) < 0.05;

    /// A spring given by mass, damping and stiffness (AMLL's, CSS's) as Step's frequency and ratio.
    public static (double F, double Zeta) Of(double mass, double damping, double stiffness) =>
        (Math.Sqrt(stiffness / mass) / (2 * Math.PI), damping / (2 * Math.Sqrt(stiffness * mass)));

    public void Step(double target, double dtMs, double f = 2.2, double zeta = 1)
    {
        var t = Math.Clamp(dtMs, 0, 100) / 1000;
        if (t == 0) return;
        var w = 2 * Math.PI * f;
        var u0 = X - target;
        double u, v;
        if (Math.Abs(zeta - 1) < 1e-6)
        {
            var e = Math.Exp(-w * t);
            var b = V + w * u0;
            u = (u0 + b * t) * e;
            v = (b - w * (u0 + b * t)) * e;
        }
        else if (zeta < 1)
        {
            var wd = w * Math.Sqrt(1 - zeta * zeta);
            var e = Math.Exp(-zeta * w * t);
            var (c, s) = (Math.Cos(wd * t), Math.Sin(wd * t));
            var b = (V + zeta * w * u0) / wd;
            u = e * (u0 * c + b * s);
            v = e * ((b * wd - zeta * w * u0) * c - (u0 * wd + zeta * w * b) * s);
        }
        else
        {
            var r = w * Math.Sqrt(zeta * zeta - 1);
            var (r1, r2) = (-zeta * w + r, -zeta * w - r);
            var c2 = (V - r1 * u0) / (r2 - r1);
            var c1 = u0 - c2;
            var (e1, e2) = (Math.Exp(r1 * t), Math.Exp(r2 * t));
            u = c1 * e1 + c2 * e2;
            v = c1 * r1 * e1 + c2 * r2 * e2;
        }
        X = target + u;
        V = v;
    }
}
