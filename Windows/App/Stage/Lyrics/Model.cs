namespace Echo.Stage.Lyrics;

// The lyric field's motion per frame (model.ts; LYRICS_EXPERIENCE.md §4–§9; Android's Model.kt): one
// column scrolled by springs from time, hand-over stagger, decay, word sweep, glow and emphasis. No
// drawing: LyricsField draws what this computes. A faithful port, so every client moves alike.

/// A rectangle in the line's own pixels (Android's Rect; Avalonia has its own).
public readonly record struct RectF(float X, float Y, float W, float H);

public sealed record Emphasis(double Swell, double Lift, double Spread, double StepMs);

public enum Side { Centre, Left, Right }

public sealed record WordBox(RectF Rect, Emphasis? Emphasis, IReadOnlyList<RectF> Graphemes);

public sealed record LineBox(float W, float H, Side Side, IReadOnlyList<WordBox> Words);

public enum Role { Zone, Past }

public enum Mode { Run, Scrub, Still }

public sealed class Leaving(double ms, double from)
{
    public readonly double Ms = ms;
    public readonly double From = from;
    public double Age;
}

public sealed class Inst
{
    public readonly int I;
    public Role Role;
    public int Rank;
    public readonly Spring X, Y, Z;
    public SpringParams Params;
    public double Delay, Tx, Ty, Tz, Age;
    public Leaving? Leaving;
    public double Scale = 1, Opacity, Blur, Mix, Fade, Wash;
    public readonly double[] P;
    public double[] Edge;
    public readonly double[][] Backing;
    public readonly double[] Glow;
    public double GlowR = L.Glow.Radius;
    public readonly Spring[][] Emph;
    public readonly double[] Wy;
    public readonly double[] Ws;

    public Inst(int i, Role role, int rank, Spring x, Spring y, Spring z, SpringParams p, double delay, double tx, double ty, double tz,
        double age, int words, IReadOnlyList<int> backing, IReadOnlyList<int> emph, bool reduced)
    {
        (I, Role, Rank, X, Y, Z, Params, Delay, Tx, Ty, Tz, Age) = (i, role, rank, x, y, z, p, delay, tx, ty, tz, age);
        P = new double[words];
        Edge = Enumerable.Repeat(Field.Unreached, words).ToArray();
        Backing = backing.Select(n => Enumerable.Repeat(Field.Unreached, n).ToArray()).ToArray();
        Glow = new double[words];
        Emph = emph.Select(n => Enumerable.Range(0, n).Select(_ => new Spring()).ToArray()).ToArray();
        Wy = Enumerable.Repeat(reduced ? 0 : L.Word.LiftEm, words).ToArray();
        Ws = Enumerable.Repeat(1.0, words).ToArray();
    }
}

public sealed class Dots
{
    public double Opacity;
    public readonly double[] Scale = [1, 1, 1];
    public readonly double[] Alpha = new double[3];
}

public static class Field
{
    public const double Unreached = -1e6;
    const double SettleMs = 250;

    static double Table((double Z, double V)[] points, double z)
    {
        if (z <= points[0].Z) return points[0].V;
        for (var i = 1; i < points.Length; i++)
        {
            var (z1, v1) = points[i];
            var (z0, v0) = points[i - 1];
            if (z <= z1) return v0 + (v1 - v0) * (z - z0) / (z1 - z0);
        }
        return points[^1].V;
    }

    public static double OpacityAt(double z) => Table(L.Opacity, z);

    public static double BlurAt(double z) => Table(L.Blur, z);

    public static double UnlitMixAt(double z) => L.UnlitMix * Math.Clamp(1 - z / L.Column.Dz, 0, 1);

    public static double SweepAt(LyricWord w, double t) => Math.Clamp((t - w.Start) / Math.Max(w.End - w.Start, L.Sweep.MinWordMs), 0, 1);

    /// The sweep as one soft edge along the whole line: the words end to end, the edge crossing each in
    /// that word's time; a word's value is how far the edge is through it (past 1, below 0 while the
    /// fades still touch it). Across a hold gap nothing ahead is lit.
    public static double[] LineEdges(IReadOnlyList<LyricWord> words, IReadOnlyList<float> widths, double t)
    {
        var w = new double[words.Count];
        var x = new double[words.Count];
        var acc = 0.0;
        for (var k = 0; k < words.Count; k++)
        {
            w[k] = Math.Max(1.0, k < widths.Count ? widths[k] : 1f);
            x[k] = acc;
            acc += w[k];
        }
        var edge = 0.0;
        var next = 0;
        while (next < words.Count && t >= words[next].Start)
        {
            edge = x[next] + w[next] * SweepAt(words[next], t);
            next++;
        }
        var reach = next - 1;
        while (reach >= 0 && reach + 1 < words.Count && words[reach + 1].Start - words[reach].End <= L.Sweep.HoldGapMs) reach++;
        var spill = reach >= next;
        var result = new double[words.Count];
        for (var k = 0; k < words.Count; k++)
        {
            if (k >= next) result[k] = k <= reach ? (edge - x[k]) / w[k] : Unreached;
            else
            {
                var along = (edge - x[k]) / w[k];
                result[k] = k == next - 1 && t > words[k].End && !spill ? Math.Max(along, 1 + (t - words[k].End) / SettleMs * 4) : along;
            }
        }
        return result;
    }

    /// A lead word's own motion (§5.1): it rises over max(1 s, its length) and swells while sung.
    public static (double Y, double Scale) WordMotion(LyricWord w, double t, bool emphasised)
    {
        double dur = w.End - w.Start;
        var u = Math.Clamp((t - w.Start) / Math.Max(1000, dur), 0, 1);
        var pop = Math.Max(1, Math.Min(L.Word.PopMs, dur / 2));
        var up = Math.Clamp((t - w.Start) / pop, 0, 1);
        var down = Math.Clamp((t - w.End) / L.Word.ReleaseMs, 0, 1);
        var peak = emphasised ? 1.0 : L.Word.Peak;
        return (L.Word.LiftEm * Math.Pow(1 - u, 3), 1 + (peak - 1) * (1 - Math.Pow(1 - up, 3)) * (1 - down * down * (3 - 2 * down)));
    }

    public static double WashAt(LyricLine line, double t)
    {
        var x = Math.Clamp((t - line.Start) / L.WashMs, 0, 1);
        return 1 - Math.Pow(1 - x, 4);
    }

    public static double StaggerMs(int rank) =>
        rank <= 0 ? 0 : L.Stagger.BaseMs * (1 - Math.Pow(L.Stagger.Decay, -rank)) / (1 - 1 / L.Stagger.Decay);
}

public sealed class FieldModel
{
    const double SeekJumpMs = 150;

    readonly double dotsH;
    readonly double[] leftAt;
    readonly Beat beats = new();
    BeatTerms beat = new(0.6, 0, 0, 0);
    double lastT = double.NaN;
    Mode lastMode = Mode.Run;
    FieldState? lastField;
    double pause = 1;
    bool reduced;
    double dotsLeave;

    public FieldModel(Timeline tl, IReadOnlyList<LineBox> boxes, double dotsH)
    {
        Tl = tl;
        Boxes = boxes;
        this.dotsH = dotsH;
        leftAt = Enumerable.Repeat(double.PositiveInfinity, tl.Lines.Count).ToArray();
        foreach (var s in tl.Spans)
            for (var j = 0; j < s.Next; j++)
                if (j != s.Line && double.IsPositiveInfinity(leftAt[j])) leftAt[j] = s.From;
    }

    public Timeline Tl { get; }
    public IReadOnlyList<LineBox> Boxes { get; private set; }
    IReadOnlyList<LyricLine> Lines => Tl.Lines;
    public OrderedDictionary<int, Inst> Insts { get; } = [];
    public List<Inst> Leaving { get; private set; } = [];
    public Dots Dots { get; } = new();
    /// The key light under the sung word, stage uv (y down); null with no line in the zone.
    public (double X, double Y)? Key { get; private set; }
    public int Active => lastField?.Active ?? -1;

    /// New measurements (resize): everything jumps to its new place (§9.10).
    public void Relayout(IReadOnlyList<LineBox> b)
    {
        Boxes = b;
        lastT = double.NaN;
    }

    public void Update(double t, double dt, bool playing, Mode mode, double W, double H, Features features, bool reduced)
    {
        var first = double.IsNaN(lastT);
        var jumped = !first && mode != Mode.Scrub && (t < lastT - 1 || Math.Abs(t - (lastT + (playing ? dt : 0))) > SeekJumpMs);
        var seek = jumped || (lastMode == Mode.Scrub && mode != Mode.Scrub);
        this.reduced = reduced;
        var direct = mode != Mode.Run || first || reduced;
        lastT = t;
        lastMode = mode;

        var fs = Timing.FieldAt(Tl, t);
        var prev = lastField;
        lastField = fs;
        var handover = prev is not null && (prev.Active != fs.Active || prev.Next != fs.Next);
        var slowHandover = handover && (prev!.Active < 0 || fs.Active < 0);
        var n = Lines.Count;

        var activeLine = fs.Active >= 0 ? Lines[fs.Active] : null;
        beat = beats.Update(features, dt, seek ? 0 : t - fs.From, Beat.VocalAt(activeLine?.Words, activeLine is not null, features.Mid, t), mode, reduced);

        var pauseTarget = playing ? 1.0 : L.Glow.Paused;
        var pauseRate = (1 - L.Glow.Paused) / (playing ? L.Glow.ResumeMs : L.Glow.PauseMs);
        pause = mode == Mode.Still ? pauseTarget : pause < pauseTarget ? Math.Min(pauseTarget, pause + pauseRate * dt) : Math.Max(pauseTarget, pause - pauseRate * dt);

        // ---- the column (§4) ----
        LineBox Box(int i) => Boxes[i];
        var anchorY = L.AnchorY * H;
        var gap = L.Column.Gap * dotsH;
        var h0 = fs.Active >= 0 ? Box(fs.Active).H : dotsH;
        var want = new OrderedDictionary<int, (Role Role, int Rank, double Y)>();
        if (fs.Active >= 0) want[fs.Active] = (Role.Zone, 0, anchorY);
        var edge = anchorY + h0 / 2;
        var j = fs.Next;
        while (j < n && edge < (1 + L.Column.Margin) * H)
        {
            var h = Box(j).H;
            want[j] = (Role.Zone, j - fs.Next + 1, edge + gap + h / 2);
            edge += gap + h;
            j++;
        }
        edge = anchorY - h0 / 2;
        j = Math.Min(fs.Next, n) - 1;
        var rank = -1;
        while (j >= 0 && edge > -L.Column.Margin * H)
        {
            if (j != fs.Active)
            {
                var h = Box(j).H;
                want[j] = (Role.Past, rank--, edge - gap - h / 2);
                edge -= gap + h;
            }
            j--;
        }

        foreach (var i in Insts.Keys.Where(k => !want.ContainsKey(k)).ToList())
        {
            var inst = Insts[i];
            Insts.Remove(i);
            if (mode == Mode.Still) continue;
            inst.Leaving = new Leaving(seek ? L.Build.SeekOutMs : L.Decay.DropMs, inst.Opacity);
            Leaving.Add(inst);
        }

        SpringParams Params(int i)
        {
            if (seek || slowHandover) return Springs.Slow;
            var a = fs.Active >= 0 ? fs.Active : i;
            var g = (a + 1 < Lines.Count ? Lines[a + 1].Start : double.PositiveInfinity) - Lines[a].Start;
            return Springs.LineNormal(g);
        }

        foreach (var (i, (role, rk, wy)) in want)
        {
            var tx = AnchorX(Box(i), W);
            var tz = Math.Min(1.0, Math.Abs(rk) * L.Column.Dz);
            if (!Insts.TryGetValue(i, out var inst))
            {
                // A line entering the column joins its neighbour where it is, delay and spring included.
                var nb = direct ? null : Insts.GetValueOrDefault(role == Role.Past ? i + 1 : i - 1);
                var off = nb is not null ? nb.Y.X - (want.TryGetValue(nb.I, out var nw) ? nw.Y : nb.Y.X) : 0;
                inst = Create(i, role, rk, tx, wy + off, tz, mode == Mode.Still);
                if (nb is not null)
                {
                    inst.Y.V = nb.Y.V;
                    inst.Delay = nb.Delay;
                    inst.Params = nb.Params;
                }
                Insts[i] = inst;
            }
            else if (inst.Rank != rk || inst.Role != role)
            {
                inst.Params = Params(i);
                inst.Delay = seek || direct ? 0 : Field.StaggerMs(rk);
                inst.Role = role;
                inst.Rank = rk;
            }
            else if (seek)
            {
                inst.Params = Springs.Slow;
                inst.Delay = 0;
            }
            inst.Delay = Math.Max(0, inst.Delay - dt);
            if (inst.Delay == 0)
            {
                inst.Tx = tx;
                inst.Ty = wy;
                inst.Tz = tz;
            }
            if (direct)
            {
                Springs.Snap(inst.X, inst.Tx);
                Springs.Snap(inst.Y, inst.Ty);
                Springs.Snap(inst.Z, inst.Tz);
            }
            else
            {
                Springs.Step(inst.X, inst.Tx, inst.Params, dt);
                Springs.Step(inst.Y, inst.Ty, inst.Params, dt);
                Springs.Step(inst.Z, inst.Tz, inst.Params, dt);
            }
            inst.Age += mode == Mode.Still ? L.Build.FadeInMs : dt;
            var shown = inst.Opacity;
            Style(inst, role, t);
            if (reduced && mode == Mode.Run)
                inst.Opacity = shown + Math.Clamp(inst.Opacity - shown, -dt / L.Reduced.CrossfadeMs, dt / L.Reduced.CrossfadeMs);
            Words(inst, t, dt, mode, seek || direct);
        }

        foreach (var inst in Leaving)
        {
            var l = inst.Leaving!;
            l.Age += dt;
            inst.Opacity = l.From * Math.Max(0, 1 - l.Age / l.Ms);
        }
        Leaving = Leaving.Where(x => (x.Leaving?.Age ?? 0) < (x.Leaving?.Ms ?? 0)).ToList();

        UpdateDots(fs, t, dt, mode == Mode.Still);
        UpdateKey(fs, W, H);
    }

    /// The column's start edge, or its end for the second voice of a duet (§4.4).
    static double AnchorX(LineBox b, double W)
    {
        var inset = (1 - L.MaxWidth) / 2 * W;
        return b.Side == Side.Right ? W - inset - b.W / 2 : inset + b.W / 2;
    }

    Inst Create(int i, Role role, int rank, double x, double y, double z, bool still)
    {
        var words = Lines[i].Words ?? [];
        var em = i < Boxes.Count ? Boxes[i].Words : [];
        return new Inst(i, role, rank, new Spring(x), new Spring(y), new Spring(z), Springs.Slow, 0, x, y, z,
            still ? L.Build.FadeInMs : 0, words.Count,
            (Lines[i].Background ?? []).Select(b => b.Words?.Count ?? 0).ToList(),
            Enumerable.Range(0, words.Count).Select(k => k < em.Count && em[k].Emphasis is not null ? em[k].Graphemes.Count : 0).ToList(),
            reduced);
    }

    void Style(Inst inst, Role role, double t)
    {
        var z = inst.Z.X;
        var born = reduced ? 1 : Math.Clamp(inst.Age / L.Build.FadeInMs, 0, 1);
        inst.Opacity = Field.OpacityAt(z) * born;
        inst.Blur = Field.BlurAt(z);
        inst.Scale = inst.Rank == 0 ? 1 + beat.Pulse : 1;
        inst.Mix = Field.UnlitMixAt(z);
        inst.Fade = role == Role.Past ? 1 - Math.Exp(-Math.Max(0, t - leftAt[inst.I]) / L.Decay.TauMs) : 0;
    }

    void Words(Inst inst, double t, double dt, Mode mode, bool settle)
    {
        var line = Lines[inst.I];
        var words = line.Words ?? [];
        for (var k = 0; k < words.Count; k++) inst.P[k] = Field.SweepAt(words[k], t);
        var boxes = inst.I < Boxes.Count ? Boxes[inst.I].Words : [];
        inst.Edge = Field.LineEdges(words, boxes.Select(b => b.Rect.W).ToList(), t);
        var background = line.Background ?? [];
        for (var b = 0; b < background.Count; b++) inst.Backing[b] = Field.LineEdges(background[b].Words ?? [], [], t);
        inst.Wash = words.Count == 0 ? Field.WashAt(line, t) : 0;
        for (var k = 0; k < words.Count; k++)
        {
            var (y, s) = reduced ? (0.0, 1.0) : Field.WordMotion(words[k], t, k < boxes.Count && boxes[k].Emphasis is not null);
            inst.Wy[k] = y;
            inst.Ws[k] = s;
        }

        // Glow (§5.2): the sweeping word of the line being sung (rank 0, or a line sweeping at +1).
        var sweeping = -1;
        for (var k = 0; k < words.Count; k++)
            if (t >= words[k].Start && t < words[k].End)
            {
                sweeping = k;
                break;
            }
        var lit = inst.Rank == 0 || (inst.Rank == 1 && sweeping >= 0);
        var slew = L.Glow.SlewPerS / 1000 * dt;
        var (alpha, radius) = Beat.GlowFor(beat.Sustain, beat.GlowAdd);
        inst.GlowR = radius;
        var target = lit && sweeping >= 0 ? alpha * pause : 0;
        var before = (double[])inst.Glow.Clone();
        double End(double a, double next) => next < 0.005 && a <= slew ? 0 : next;
        var fading = 0;
        for (var k = 0; k < words.Count; k++)
        {
            var a = before[k];
            if ((k == sweeping && target > 0) || a == 0) continue;
            var tau = words[k].End - words[k].Start < 150 ? L.Glow.DecayFastMs : L.Glow.DecayMs;
            var next = mode == Mode.Still ? 0 : Math.Max(a * Math.Exp(-dt / tau), a - slew);
            var g = End(a, next);
            inst.Glow[k] = g;
            if (g > 0) fading++;
        }
        // At most two words glow (§5.2): the older fades at the fastest permitted rate.
        var own = sweeping >= 0 && before[sweeping] > 0 ? 1 : 0;
        if (fading >= 2 || fading + own > 2)
        {
            var oldest = Enumerable.Range(0, inst.Glow.Length).Where(k => inst.Glow[k] > 0 && k != sweeping).DefaultIfEmpty(-1).First();
            if (oldest >= 0) inst.Glow[oldest] = End(before[oldest], Math.Max(0, before[oldest] - slew));
        }
        if (sweeping >= 0)
        {
            var a = before[sweeping];
            var room = Enumerable.Range(0, inst.Glow.Length).Count(k => inst.Glow[k] > 0 && k != sweeping) < 2;
            inst.Glow[sweeping] = mode == Mode.Still ? target
                : a < target ? (room ? Math.Min(target, a + Math.Min(L.Glow.Alpha / L.Glow.RiseMs * dt, slew)) : a)
                : Math.Max(target, a - slew);
        }

        // Emphasis (§5.5): graphemes lift and swell in sequence from 400 ms before the word.
        for (var k = 0; k < words.Count; k++)
        {
            if (k >= boxes.Count || boxes[k].Emphasis is not { } e || k >= inst.Emph.Length) continue;
            var w = words[k];
            for (var g = 0; g < inst.Emph[k].Length; g++)
            {
                var on = mode != Mode.Scrub && !reduced && t >= w.Start - L.Emphasis.AnticipateMs + g * e.StepMs && t < w.End - L.Emphasis.ReleaseMs;
                if (settle) Springs.Snap(inst.Emph[k][g], on ? 1 : 0);
                else Springs.Step(inst.Emph[k][g], on ? 1 : 0, Springs.Lift, dt);
            }
        }
    }

    void UpdateDots(FieldState fs, double t, double dt, bool still)
    {
        if (fs.Dots)
        {
            var since = t - fs.From;
            Dots.Opacity = Math.Clamp(since / L.Interlude.EnterMs, 0, 1);
            dotsLeave = Dots.Opacity;
            for (var k = 0; k < 3; k++)
            {
                var ph = (since - k * L.Interlude.DotStepMs) / L.Interlude.CycleMs;
                var b = 0.5 - 0.5 * Math.Cos(2 * Math.PI * ph);
                Dots.Scale[k] = reduced ? 1 : 0.4 + 0.85 * b;
                Dots.Alpha[k] = reduced ? L.Reduced.DotsAlpha : 0.2 + 0.7 * b;
            }
        }
        else
        {
            dotsLeave = still ? 0 : Math.Max(0, dotsLeave - dt / L.Interlude.FadeMs);
            Dots.Opacity = dotsLeave;
        }
    }

    void UpdateKey(FieldState fs, double W, double H)
    {
        if (fs.Active < 0 || !Insts.TryGetValue(fs.Active, out var a))
        {
            Key = null;
            return;
        }
        var line = Lines[a.I];
        var b = Boxes[a.I];
        var k = Array.FindIndex(a.P, p => p < 1);
        var idx = k < 0 ? (line.Words?.Count ?? 1) - 1 : k;
        RectF? r = idx >= 0 && idx < b.Words.Count ? b.Words[idx].Rect : null;
        var ox = r is { } rx ? (rx.X + rx.W / 2 - b.W / 2) * a.Scale : 0;
        var oy = r is { } ry ? (ry.Y + ry.H / 2 - b.H / 2) * a.Scale : 0;
        Key = ((a.X.X + ox) / W, (a.Y.X + oy) / H);
    }
}
