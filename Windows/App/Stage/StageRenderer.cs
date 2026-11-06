using System.Runtime.InteropServices;
using Avalonia.OpenGL;
using SkiaSharp;
using static Avalonia.OpenGL.GlConsts;

namespace Echo.Stage;

// The room renderer (src/client/stage/renderer.ts; VISUALIZER_SPEC.md §5; Android's StageRenderer.kt) on
// OpenGL ES 3.0 (ANGLE on Windows) or desktop GL 3.3, with the web's own shaders, embedded from
// Android's assets: the room into a reduced-resolution target, Reverb's energy ping-pong, and the
// composite into the framebuffer Avalonia hands over. Runs on the GL control's thread only.

public sealed record FrameInput(float Flow, float Drift, float Cover, float KeyX, float KeyY, float Chrome, float Seed,
    ReverbFrame? Reverb);

public sealed unsafe class StageRenderer
{
    const int GL_RGBA16F = 0x881A;
    const int GL_HALF_FLOAT = 0x140B;
    const int GL_SRGB8_ALPHA8 = 0x8C43;
    const int GL_RGBA8 = 0x8058;
    const int GL_REPEAT = 0x2901;

    /// Filmic tone map (Hable), as palette.ts: the exposure that leaves dark colours unchanged.
    static readonly double BaseExposure = 1 / (H(1e-4) / 1e-4 * (1 / H(11.2)));

    static double H(double x) => (x * (0.15 * x + 0.1 * 0.5) + 0.2 * 0.02) / (x * (0.15 * x + 0.5) + 0.2 * 0.3) - 0.02 / 0.3;

    /// One of the room's shaders, as embedded from Android/app/src/main/assets/stage.
    internal static string Source(string name)
    {
        using var stream = typeof(StageRenderer).Assembly.GetManifestResourceStream($"stage.{name}.glsl")
            ?? throw new FileNotFoundException($"stage shader {name}");
        return new StreamReader(stream).ReadToEnd();
    }

    sealed class Program(GlInterface gl, int id)
    {
        readonly Dictionary<string, int> locs = [];
        public int Id => id;
        public int U(string name) => locs.TryGetValue(name, out var l) ? l : locs[name] = gl.GetUniformLocationString(id, name);
    }

    GlInterface gl = null!;
    delegate* unmanaged<int, float, float, void> uniform2f;
    delegate* unmanaged<int, float, float, float, void> uniform3f;
    delegate* unmanaged<int, int, float*, void> uniform4fv;
    Program roomP = null!;
    Program energyP = null!;
    Program compositeP = null!;
    int triangle;
    int vao;
    int noise;
    bool halfFloat;

    int roomTex;
    int roomFbo;
    readonly int[] energyTex = new int[2];
    readonly int[] energyFbo = new int[2];
    int energyHead;
    int[] covers = [0, 0]; // previous, current

    int w = 1;
    int h = 1;
    float dpr = 1;
    Tier tier = Tier.T1;
    bool built;

    StagePalette palette = StagePalette.Fallback;
    float brightness = MathF.Pow(0.5f, 2.2f);
    float scrimTop = 0.25f;
    float scrimDock = 0.4f;
    bool reverbOn;

    public string? Gpu => gl.Renderer;

    public void Init(GlInterface gl, bool es)
    {
        this.gl = gl;
        uniform2f = (delegate* unmanaged<int, float, float, void>)gl.GetProcAddress("glUniform2f");
        uniform3f = (delegate* unmanaged<int, float, float, float, void>)gl.GetProcAddress("glUniform3f");
        uniform4fv = (delegate* unmanaged<int, int, float*, void>)gl.GetProcAddress("glUniform4fv");
        // Desktop GL 3.3 renders to half float; ES only with the extension (ANGLE on D3D11 has it).
        var getString = (delegate* unmanaged<int, nint>)gl.GetProcAddress("glGetString");
        var ext = es ? Marshal.PtrToStringAnsi(getString(GL_EXTENSIONS)) ?? "" : "";
        halfFloat = !es || ext.Contains("EXT_color_buffer_half_float") || ext.Contains("EXT_color_buffer_float");
        var header = es ? "#version 300 es\n" : "#version 330 core\n";
        var vert = header + Source("fullscreen_vert");
        roomP = Link(vert, header + Source("room_frag"));
        energyP = Link(vert, header + Source("energy_frag"));
        compositeP = Link(vert, header + Source("composite_frag"));
        if (gl.IsGenVertexArraysAvailable) vao = gl.GenVertexArray(); // core profiles draw nothing without one
        triangle = gl.GenBuffer();
        gl.BindBuffer(GL_ARRAY_BUFFER, triangle);
        var tri = stackalloc float[] { -1, -1, 0, 3, -1, 0, -1, 3, 0 };
        gl.BufferData(GL_ARRAY_BUFFER, 9 * sizeof(float), (nint)tri, GL_STATIC_DRAW);
        noise = NoiseTexture();
        covers = [0, 0];
        built = false;
    }

    Program Link(string vert, string frag)
    {
        int Compile(int type, string src)
        {
            var s = gl.CreateShader(type);
            if (gl.CompileShaderAndGetError(s, src) is { } error) throw new InvalidOperationException($"room shader: {error}");
            return s;
        }
        var p = gl.CreateProgram();
        gl.AttachShader(p, Compile(GL_VERTEX_SHADER, vert));
        gl.AttachShader(p, Compile(GL_FRAGMENT_SHADER, frag));
        gl.BindAttribLocationString(p, 0, "position");
        if (gl.LinkProgramAndGetError(p) is { } error) throw new InvalidOperationException($"room program: {error}");
        return new Program(gl, p);
    }

    int Texture()
    {
        var t = gl.GenTexture();
        gl.BindTexture(GL_TEXTURE_2D, t);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        return t;
    }

    int NoiseTexture()
    {
        using var stream = typeof(StageRenderer).Assembly.GetManifestResourceStream("stage.blue_noise_64.png")!;
        using var bmp = SKBitmap.Decode(stream);
        var t = Texture();
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        Upload(bmp, GL_RGBA8);
        return t;
    }

    void Upload(SKBitmap bmp, int internalFormat)
    {
        using var rgba = bmp.Copy(SKColorType.Rgba8888);
        gl.TexImage2D(GL_TEXTURE_2D, 0, internalFormat, rgba.Width, rgba.Height, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba.GetPixels());
    }

    (int Tex, int Fbo) Target(int tw, int th)
    {
        var t = Texture();
        if (halfFloat) gl.TexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, tw, th, 0, GL_RGBA, GL_HALF_FLOAT, 0);
        else gl.TexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, tw, th, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
        var f = gl.GenFramebuffer();
        gl.BindFramebuffer(GL_FRAMEBUFFER, f);
        gl.FramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, t, 0);
        gl.ClearColor(0, 0, 0, 1);
        gl.Clear(GL_COLOR_BUFFER_BIT);
        return (t, f);
    }

    void BuildTargets()
    {
        foreach (var t in new[] { roomTex, energyTex[0], energyTex[1] }) if (t != 0) gl.DeleteTexture(t);
        foreach (var f in new[] { roomFbo, energyFbo[0], energyFbo[1] }) if (f != 0) gl.DeleteFramebuffer(f);
        var tw = Math.Max(1, (int)Math.Round(w * tier.RoomScale()));
        var th = Math.Max(1, (int)Math.Round(h * tier.RoomScale()));
        (roomTex, roomFbo) = Target(tw, th);
        for (var i = 0; i < 2; i++) (energyTex[i], energyFbo[i]) = Target(tw, th);
        built = true;
    }

    /// The surface in device pixels, and device pixels per DIP (the web's CSS px).
    public void SetSize(int width, int height, float pxPerDip)
    {
        if (width == w && height == h && built) return;
        w = Math.Max(1, width);
        h = Math.Max(1, height);
        dpr = pxPerDip;
        BuildTargets();
    }

    public void SetTier(Tier t)
    {
        tier = t;
        if (built) BuildTargets();
    }

    public void SetPalette(StagePalette p) => palette = p;

    /// The cover's brightness, 0…1 as the slider shows it; perceptual, so squared-ish into light.
    public void SetBrightness(float b) => brightness = MathF.Pow(Math.Max(0, b), 2.2f);

    public void SetScrims(float top, float dock)
    {
        scrimTop = top;
        scrimDock = dock;
    }

    /// The track's cover as the room's base (blurred, StageView.CoverBitmap), or null; crossfades from the last.
    public void SetCover(SKBitmap? bmp)
    {
        if (covers[0] != 0) gl.DeleteTexture(covers[0]);
        var next = 0;
        if (bmp is not null)
        {
            next = Texture();
            Upload(bmp, GL_SRGB8_ALPHA8); // sampled as linear light, like the room
        }
        covers = [covers[1], next];
    }

    public void SetReverb(bool on, int screenFbo)
    {
        if (on == reverbOn) return;
        reverbOn = on;
        if (!on && built)
            foreach (var f in energyFbo)
            {
                gl.BindFramebuffer(GL_FRAMEBUFFER, f);
                gl.Clear(GL_COLOR_BUFFER_BIT);
            }
        gl.BindFramebuffer(GL_FRAMEBUFFER, screenFbo);
    }

    void Bind(int unit, int tex)
    {
        gl.ActiveTexture(GL_TEXTURE0 + unit);
        gl.BindTexture(GL_TEXTURE_2D, tex);
    }

    void DrawTriangle()
    {
        if (vao != 0) gl.BindVertexArray(vao);
        gl.BindBuffer(GL_ARRAY_BUFFER, triangle);
        gl.EnableVertexAttribArray(0);
        gl.VertexAttribPointer(0, 3, GL_FLOAT, 0, 0, 0);
        gl.DrawArrays(GL_TRIANGLES, 0, 3);
    }

    void V3(Program p, string name, Linear c) => uniform3f(p.U(name), c.R, c.G, c.B);

    /// Draws one frame into `screenFbo`, the framebuffer Avalonia renders the control from.
    public void Render(FrameInput f, int screenFbo)
    {
        if (!built) return;
        var rv = f.Reverb;
        var p = palette;
        var aspect = (float)w / h;
        var roomW = Math.Max(1, (int)Math.Round(w * tier.RoomScale()));
        var roomH = Math.Max(1, (int)Math.Round(h * tier.RoomScale()));

        // Pass 1, the room.
        gl.BindFramebuffer(GL_FRAMEBUFFER, roomFbo);
        gl.Viewport(0, 0, roomW, roomH);
        gl.UseProgram(roomP.Id);
        gl.Uniform1f(roomP.U("uAspect"), aspect);
        gl.Uniform1f(roomP.U("uFlow"), rv is null ? f.Flow : (float)rv.Flow);
        gl.Uniform1f(roomP.U("uDrift"), f.Drift);
        gl.Uniform1f(roomP.U("uSeed"), f.Seed);
        Bind(3, covers[1]);
        gl.Uniform1i(roomP.U("uCover"), 3);
        Bind(4, covers[0]);
        gl.Uniform1i(roomP.U("uCoverPrev"), 4);
        uniform2f(roomP.U("uCoverOn"), covers[0] != 0 ? 1 : 0, covers[1] != 0 ? 1 : 0);
        gl.Uniform1f(roomP.U("uCoverFade"), f.Cover);
        gl.Uniform1f(roomP.U("uBrightness"), brightness);
        V3(roomP, "uRoom", p.Room);
        V3(roomP, "uAccent", p.Accent);
        V3(roomP, "uHighlight", p.Highlight);
        uniform3f(roomP.U("uGlow"), p.Glow.R * p.Glow.A, p.Glow.G * p.Glow.A, p.Glow.B * p.Glow.A);
        uniform2f(roomP.U("uKey"), f.KeyX, f.KeyY);
        gl.Uniform1f(roomP.U("uPoolScale"), rv is null ? 1 : (float)rv.PoolScale);
        gl.Uniform1f(roomP.U("uKeyScale"), rv is null ? 1 : (float)rv.KeyScale);
        DrawTriangle();

        // Pass 2, energy (Reverb only): the previous buffer decays, rings and the flare are added.
        if (rv is not null)
        {
            var prev = energyHead;
            var next = 1 - energyHead;
            gl.BindFramebuffer(GL_FRAMEBUFFER, energyFbo[next]);
            gl.UseProgram(energyP.Id);
            Bind(5, energyTex[prev]);
            gl.Uniform1i(energyP.U("uPrev"), 5);
            gl.Uniform1f(energyP.U("uAspect"), aspect);
            gl.Uniform1f(energyP.U("uDecay"), (float)rv.Decay);
            gl.Uniform1f(energyP.U("uWarp"), (float)rv.Warp);
            gl.Uniform1f(energyP.U("uFlow"), (float)rv.Flow);
            uniform2f(energyP.U("uKey"), f.KeyX, f.KeyY);
            var rings = stackalloc float[12];
            for (var i = 0; i < Math.Min(3, rv.Rings.Count); i++)
            {
                var r = rv.Rings[i];
                rings[i * 4] = (float)r.X;
                rings[i * 4 + 1] = (float)r.Y;
                rings[i * 4 + 2] = (float)r.Radius();
                rings[i * 4 + 3] = (float)r.Light();
            }
            uniform4fv(energyP.U("uRings[0]"), 3, rings);
            var tint = Reverb.SafeTint(p.Highlight.R, p.Highlight.G, p.Highlight.B);
            uniform3f(energyP.U("uTint"), tint[0], tint[1], tint[2]);
            gl.Uniform1f(energyP.U("uFlare"), (float)rv.Flare);
            DrawTriangle();
            energyHead = next;
        }

        // Pass 4, the composite.
        gl.BindFramebuffer(GL_FRAMEBUFFER, screenFbo);
        gl.Viewport(0, 0, w, h);
        gl.UseProgram(compositeP.Id);
        Bind(0, roomTex);
        gl.Uniform1i(compositeP.U("uRoomTex"), 0);
        Bind(1, noise);
        gl.Uniform1i(compositeP.U("uNoise"), 1);
        Bind(2, energyTex[energyHead]);
        gl.Uniform1i(compositeP.U("uEnergyTex"), 2);
        gl.Uniform1f(compositeP.U("uEnergyOn"), rv is null ? 0 : 1);
        uniform2f(compositeP.U("uRes"), w, h);
        gl.Uniform1f(compositeP.U("uDpr"), dpr);
        V3(compositeP, "uShadow", p.Shadow);
        gl.Uniform1f(compositeP.U("uChrome"), f.Chrome);
        gl.Uniform1f(compositeP.U("uScrimTop"), scrimTop);
        gl.Uniform1f(compositeP.U("uScrimDock"), scrimDock);
        gl.Uniform1f(compositeP.U("uExposure"), (float)(BaseExposure * (rv?.Exposure ?? 1.0)));
        gl.Uniform1f(compositeP.U("uZoneExposure"), 0);
        gl.Uniform1f(compositeP.U("uZoneScrim"), 0);
        uniform2f(compositeP.U("uKeyUv"), f.KeyX, 1 - f.KeyY);
        DrawTriangle();
    }
}
