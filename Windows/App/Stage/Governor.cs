namespace Echo.Stage;

// The quality governor (src/client/stage/governor.ts; VISUALIZER_SPEC.md §8.2; Android's Governor.kt).
// Pure: the room feeds it frame intervals and applies the tier it returns. The refresh rate is the
// median of the first 60 intervals; a tier steps down after 1 s over budget and up after 8 s at full
// refresh, never in the first 3 s of a track or during a scrub, and never up within 20 s of any
// change. On its own it goes no lower than T2: T3 is Still, which measures nothing and could never come back.

public enum Tier { T0, T1, T2, T3 }

public static class Tiers
{
    public static float DprCap(this Tier t) => t switch { Tier.T0 => 1.5f, Tier.T1 => 1.25f, _ => 1.0f };
    public static float RoomScale(this Tier t) => t is Tier.T0 or Tier.T1 ? 1 / 2f : 1 / 3f;
}

public sealed class Governor(Tier tier, bool manual, Func<double> now)
{
    const double Alpha = 0.1;
    const double DownAfterMs = 1000;
    const double UpAfterMs = 8000;
    const double SettleMs = 20_000;
    const double TrackStartMs = 3000;
    const double EmergencyMs = 3000;
    const double EmergencyFrameMs = 50;
    const double FullRate = 1.05;
    const double GapMs = 250;

    readonly List<double> intervals = new(60);
    double ema;
    double over;
    double under;
    double slow;
    double lastChange = double.NegativeInfinity;

    public Tier Tier { get; private set; } = tier;
    public double TargetMs { get; private set; } = 1000.0 / 60;

    Tier? Step(int dir)
    {
        var next = (int)Tier + dir;
        if (next is < 0 or > (int)Tier.T3) return null;
        if ((Tier)next == Tier.T3 && !manual) return null;
        Tier = (Tier)next;
        lastChange = now();
        over = 0;
        under = 0;
        slow = 0;
        return Tier;
    }

    /// One frame; the new tier when it changes, else null.
    public Tier? Sample(double dtMs, double trackMs, bool scrubbing)
    {
        if (dtMs <= 0 || dtMs > GapMs) return null;
        if (intervals.Count < 60)
        {
            intervals.Add(dtMs);
            if (intervals.Count == 60)
            {
                TargetMs = intervals.Order().ElementAt(30);
                ema = TargetMs;
            }
            return null;
        }
        ema += Alpha * (dtMs - ema);
        if (manual)
        {
            slow = ema > EmergencyFrameMs ? slow + dtMs : 0;
            return slow >= EmergencyMs ? Step(1) : null;
        }
        if (trackMs < TrackStartMs || scrubbing)
        {
            over = 0;
            under = 0;
            return null;
        }
        over = ema > 1.15 * TargetMs ? over + dtMs : 0;
        under = ema <= FullRate * TargetMs ? under + dtMs : 0;
        if (over >= DownAfterMs) return Step(1);
        if (under >= UpAfterMs && now() - lastChange >= SettleMs) return Step(-1);
        return null;
    }

    /// §8.2 first run: T1 on integrated and software renderers; T0 on NVIDIA and AMD.
    public static Tier FirstTier(string? renderer)
    {
        if (renderer is null) return Tier.T1;
        var r = renderer.ToLowerInvariant();
        string[] modest = ["swiftshader", "llvmpipe", "software", "warp", "intel", "apple", "mali", "adreno", "powervr", "xclipse", "immortalis"];
        if (modest.Any(r.Contains)) return Tier.T1;
        string[] strong = ["nvidia", "geforce", "radeon", "amd"];
        return strong.Any(r.Contains) ? Tier.T0 : Tier.T1;
    }
}
