using SkiaSharp;

namespace Echo.Glass;

/// glass.sksl, compiled once, and its uniforms for one panel in device pixels.
static class GlassShader
{
    /// The compiled effect; throws with the compiler's message when glass.sksl is broken.
    internal static SKRuntimeEffect Compiled => Effect.Value;

    static readonly Lazy<SKRuntimeEffect> Effect = new(() =>
    {
        using var stream = typeof(GlassShader).Assembly.GetManifestResourceStream("glass.sksl")!;
        var source = new StreamReader(stream).ReadToEnd();
        return SKRuntimeEffect.CreateShader(source, out var error)
            ?? throw new InvalidOperationException($"glass.sksl does not compile: {error}");
    });

    static readonly Dictionary<GlassParams, float[]> Profiles = [];

    public static SKShader Make(SKShader backdrop, SKRect device, float scale, GlassParams g, float[] radii, double darken)
    {
        float[] profile;
        lock (Profiles)
            if (!Profiles.TryGetValue(g, out profile!)) Profiles[g] = profile = GlassMath.BendProfile(g);
        var light = g.Light * Math.PI / 180;
        var effect = Effect.Value;
        var u = new SKRuntimeEffectUniforms(effect);
        u.Add("origin", new[] { device.Left, device.Top });
        u.Add("size", new[] { device.Width, device.Height });
        u.Add("radii", radii);
        u.Add("bezel", (float)g.Bezel * scale);
        u.Add("profile", profile.Select(b => b * scale).ToArray());
        u.Add("light", new[] { (float)Math.Cos(light), (float)-Math.Sin(light) });
        u.Add("specular", (float)g.Specular);
        u.Add("saturation", (float)g.Saturate);
        u.Add("tint", (float)Math.Clamp(g.Tint + darken, 0, 1));
        u.Add("frost", (float)g.Frost * scale);
        var children = new SKRuntimeEffectChildren(effect);
        children.Add("backdrop", backdrop);
        return effect.ToShader(u, children);
    }
}
