namespace Echo.Glass;

// Liquid glass (docs/superpowers/specs/2026-11-06-windows-glass-design.md, board A), the 10-28 model
// of DESIGN_SYSTEM.md §7.11 (git show 8cbc0bb^:src/client/ui/glass.ts): the view through a convex
// squircle rim bends by Snell's law. glass.sksl does per pixel what glassMaps did per element.

/// The glass in device-independent pixels. Board A: clear (frost under a pixel, a 10% dark tint).
public sealed record GlassParams(
    double Thickness = 24, // slab under the flat top
    double Bezel = 20, // width of the curved rim
    double Ior = 1.5,
    double Refraction = 1.0, // scale on the computed bend (0 = flat glass)
    double Specular = 0.5, // rim light, 0…1
    double Light = 135, // rim light direction, degrees anticlockwise from +x: from the top left
    double Saturate = 1.5,
    double Frost = 0.75, // blur radius before the bend
    double Tint = 0.10); // share of black over what shows through

public static class GlassMath
{
    public const int Steps = 32;

    /// The rim's height, 0 at the outer edge to 1 where the flat top starts: a convex squircle.
    public static double Rim(double t) => Math.Pow(1 - Math.Pow(1 - t, 4), 0.25);

    /// How far the view through the rim shifts inward at fraction `t` across it (0 = the edge): a
    /// vertical ray meets the rim's slope, bends by Snell's law, and crosses the glass below.
    public static double Bend(GlassParams g, double t)
    {
        const double dt = 1e-4;
        var slope = (Rim(Math.Min(t + dt, 1)) - Rim(t)) / dt;
        var incidence = Math.Atan(slope);
        var deviation = incidence - Math.Asin(Math.Sin(incidence) / g.Ior);
        return (g.Thickness + Rim(t) * g.Bezel) * Math.Tan(deviation);
    }

    /// The bend at `n` even steps across the rim (edge first), refraction applied: the shader's lookup.
    public static float[] BendProfile(GlassParams g, int n = Steps) =>
        Enumerable.Range(0, n).Select(i => (float)(Bend(g, i / (n - 1.0)) * g.Refraction)).ToArray();
}
