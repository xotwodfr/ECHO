using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.OpenGL;
using Avalonia.OpenGL.Controls;
using Avalonia.Threading;
using Echo.Playback;
using SkiaSharp;

namespace Echo.Stage;

// The room's frame loop (src/client/stage/loop.ts and engine.ts; Android's StageView.kt): it moves time
// (ambient flow and drift, slowed to 25% while paused), eases the chrome, crossfades the cover and the
// palette, steps Reverb and the governor, and draws. Still mode draws only while something changes.
// When GL cannot start (headless, or a driver without ES 3.0) the view hides, and the FallbackRoom
// under it shows instead.

public enum RoomMode { Ambient, Reverb, Still }

public sealed class StageView(AudioTap tap, Tier initialTier = Tier.T1, bool manualTier = false) : OpenGlControlBase
{
    const double AmbientFlowPerS = 0.05;
    const double PausedRate = 0.25;
    const double RateRampS = 1.5;
    const double MaxDtMs = 100;
    const double ChromeInMs = 160;
    const double ChromeOutMs = 640;
    const double PaletteMs = 1200;

    readonly StageRenderer renderer = new();
    readonly AnalyserFeatures analyser = new(tap);
    readonly Stopwatch clock = Stopwatch.StartNew();
    Governor? governor;
    Reverb reverb = new();
    Tier tier = initialTier;
    RoomMode mode = RoomMode.Ambient;
    SKBitmap? cover;
    bool coverPending;

    double last = -1;
    double flow;
    double drift;
    double rate = PausedRate;
    double chrome = 1;
    double coverAt;
    StagePalette palFrom = StagePalette.Fallback;
    StagePalette palTo = StagePalette.Fallback;
    double palAt = double.NegativeInfinity;
    bool ready;

    double Now => clock.Elapsed.TotalMilliseconds;
    bool Still => mode == RoomMode.Still || tier == Tier.T3;

    public bool Playing { get; set; }
    public bool Chrome { get; set { field = value; Kick(); } } = true;
    public float KeyX { get; set; } = 0.5f;
    public float KeyY { get; set; } = 0.4f;
    /// When the playing track started, on this view's clock (the governor waits 3 s after it).
    public double TrackStartedAt { get; set; }
    public void TrackStarted() => TrackStartedAt = Now;

    /// The newest audio features (§3.4), for the lyric field's beat terms.
    public Features Features { get; private set; } = Features.Silent;

    public event Action<Tier>? TierChanged;

    public RoomMode Mode
    {
        get => mode;
        set { mode = value; Kick(); }
    }

    public Intensity Intensity { set => reverb = new Reverb(value); }

    float brightness = 0.5f;
    public float Brightness
    {
        get => brightness;
        set { brightness = value; Kick(); }
    }

    public StagePalette Palette
    {
        get => palTo;
        set
        {
            palFrom = PaletteAt(Now);
            palTo = value;
            palAt = Now;
            Kick();
        }
    }

    /// The track's cover, already blurred by CoverBitmap, or null; crossfaded in.
    public SKBitmap? Cover
    {
        get => cover;
        set
        {
            cover = value;
            coverPending = true;
            Kick();
        }
    }

    void Kick() => RequestNextFrameRendering();

    protected override void OnOpenGlInit(GlInterface gl)
    {
        try
        {
            renderer.Init(gl, GlVersion.Type == GlProfileType.OpenGLES);
            renderer.SetTier(tier);
            governor = new Governor(tier, manualTier, () => Now);
            coverPending = true;
            ready = true;
            if (!manualTier && tier == Tier.T1 && Governor.FirstTier(renderer.Gpu) is var first && first != tier) ChangeTier(first);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ECHO room: {e.Message}");
            Dispatcher.UIThread.Post(() => IsVisible = false);
        }
    }

    protected override void OnOpenGlDeinit(GlInterface gl) => ready = false;

    void ChangeTier(Tier t)
    {
        tier = t;
        renderer.SetTier(t);
        TierChanged?.Invoke(t);
    }

    StagePalette PaletteAt(double now)
    {
        var k = Math.Clamp((now - palAt) / PaletteMs, 0, 1);
        return k >= 1 ? palTo : Lerp(palFrom, palTo, k);
    }

    protected override void OnOpenGlRender(GlInterface gl, int fb)
    {
        if (!ready) return;
        var scale = (float)(TopLevel.GetTopLevel(this)?.RenderScaling ?? 1);
        renderer.SetSize((int)(Bounds.Width * scale), (int)(Bounds.Height * scale), scale);
        renderer.SetBrightness(brightness);
        var now = Now;
        if (coverPending)
        {
            renderer.SetCover(cover);
            coverAt = now;
            coverPending = false;
        }
        var still = Still;
        var dt = still || last < 0 ? 0 : Math.Clamp(now - last, 0, MaxDtMs);
        last = now;

        // Ambient time: eases towards full speed while playing, 25% while paused.
        var target = Playing ? 1.0 : PausedRate;
        var ramp = (1 - PausedRate) / RateRampS * (dt / 1000);
        rate = rate < target ? Math.Min(target, rate + ramp) : Math.Max(target, rate - ramp);
        if (!still)
        {
            flow += AmbientFlowPerS * rate * (dt / 1000);
            drift += rate * (dt / 1000);
        }

        // Scrims follow the chrome: back in 160 ms, out over 640 ms; Still snaps.
        var ct = Chrome ? 1.0 : 0.0;
        chrome = still ? ct : chrome < ct ? Math.Min(ct, chrome + dt / ChromeInMs) : Math.Max(ct, chrome - dt / ChromeOutMs);

        var reverbOn = mode == RoomMode.Reverb && !still;
        Features = reverbOn ? analyser.Sample(dt) : Features.Silent;
        renderer.SetReverb(reverbOn, fb);
        var rv = reverbOn ? reverb.Step(Features, dt, KeyX, KeyY) : null;

        if (!still && governor?.Sample(dt, now - TrackStartedAt, false) is { } changed) ChangeTier(changed);

        renderer.SetPalette(PaletteAt(now));
        var coverK = still ? 1f : (float)Math.Min(1, (now - coverAt) / PaletteMs);
        renderer.Render(new FrameInput((float)flow, (float)drift, coverK, KeyX, KeyY, (float)chrome, 0, rv), fb);

        // Continuous while moving and visible; Still only while a palette or chrome change runs.
        if (IsEffectivelyVisible && (!still || now - palAt < PaletteMs || Math.Abs(chrome - ct) > 0.001)) Kick();
    }

    /// Two palettes mixed in OKLab (the web's palette animator), `k` from a to b.
    static StagePalette Lerp(StagePalette a, StagePalette b, double k)
    {
        Linear Mix(Linear x, Linear y)
        {
            var p = Oklab.LinearToOklab(x.R, x.G, x.B);
            var q = Oklab.LinearToOklab(y.R, y.G, y.B);
            var r = Oklab.OklabToLinear(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k);
            return new Linear((float)Math.Clamp(r[0], 0, 1), (float)Math.Clamp(r[1], 0, 1), (float)Math.Clamp(r[2], 0, 1),
                (float)(x.A + (y.A - x.A) * k));
        }
        return new StagePalette(Mix(a.Room, b.Room), Mix(a.Accent, b.Accent), Mix(a.Highlight, b.Highlight),
            Mix(a.Glow, b.Glow), Mix(a.Shadow, b.Shadow), Mix(a.Ink, b.Ink));
    }

    /// The room's base cover (renderer.ts coverTexture): 96 px, blurred once (5 px) and saturated 1.4,
    /// drawn with an overscan first so the blur never pulls in an edge.
    public static SKBitmap CoverBitmap(SKBitmap src)
    {
        const int size = 96;
        const int blur = 5;
        const int over = size + 4 * blur;
        using var big = new SKBitmap(over, over, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var canvas = new SKCanvas(big))
        using (var image = SKImage.FromBitmap(src))
        {
            const float s = 1.4f;
            float r = 0.213f * (1 - s), g = 0.715f * (1 - s), b = 0.072f * (1 - s);
            using var paint = new SKPaint
            {
                ColorFilter = SKColorFilter.CreateColorMatrix([r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0]),
                ImageFilter = SKImageFilter.CreateBlur(blur, blur),
            };
            var side = Math.Min(src.Width, src.Height);
            canvas.DrawImage(image, SKRect.Create((src.Width - side) / 2f, (src.Height - side) / 2f, side, side),
                new SKRect(0, 0, over, over), new SKSamplingOptions(SKFilterMode.Linear), paint);
        }
        var result = new SKBitmap(size, size, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var canvas = new SKCanvas(result))
            canvas.DrawBitmap(big, new SKRect(2 * blur, 2 * blur, 2 * blur + size, 2 * blur + size), new SKRect(0, 0, size, size));
        return result;
    }
}
