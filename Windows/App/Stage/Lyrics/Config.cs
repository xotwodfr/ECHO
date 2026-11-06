namespace Echo.Stage.Lyrics;

// Every lyric-field constant (src/client/stage/lyrics/lyricsConfig.ts, LYRICS_EXPERIENCE.md §15; Android's
// Config.kt): the web's values, so every client moves the words alike. Change them there first.

public static class L
{
    public const double AnchorY = 0.4;
    public const double UnlitMix = 0.22;
    public const double MaxWidth = 0.84;
    public const int MaxRows = 2;
    public const double ShrinkMax = 0.12;

    public static class Column
    {
        public const double Gap = 0.45;
        public const double Dz = 0.25;
        public const double Margin = 0.25;
    }

    public static readonly (double Z, double V)[] Opacity = [(0.0, 1.0), (0.25, 0.5), (0.5, 0.42), (1.0, 0.32)];
    public static readonly (double Z, double V)[] Blur = [(0.0, 0.0), (0.25, 1.2), (0.5, 2.2), (0.75, 3.2), (1.0, 4.0)];

    public static class Word
    {
        public const double LiftEm = 0.05;
        public const double Peak = 1.07;
        public const double PopMs = 140;
        public const double ReleaseMs = 300;
    }

    public static class Sweep
    {
        public const double EdgeAhead = 0.35;
        public const double EdgeBehind = 0.6;
        public const double HoldGapMs = 300;
        public const double MinWordMs = 60;
    }

    public static class Glow
    {
        public const double Radius = 0.18;
        public const double RadiusMax = 0.26;
        public const double Alpha = 0.35;
        public const double AlphaMax = 0.55;
        public const double DecayMs = 220;
        public const double DecayFastMs = 120;
        public const double RiseMs = 90;
        public const double SlewPerS = 1.5;
        public const double Paused = 0.6;
        public const double PauseMs = 600;
        public const double ResumeMs = 300;
    }

    public const double WashMs = 420;

    public static class Handover
    {
        public const double LeadMinMs = 120;
        public const double LeadMaxMs = 300;
        public const double CoalesceMs = 350;
    }

    public static class Emphasis
    {
        public const double MinMs = 1000;
        public const int MinG = 2;
        public const int MaxG = 7;
        public const double AnticipateMs = 400;
        public const double ReleaseMs = 250;
        public const double SwellMax = 0.08;
    }

    public static class Springs
    {
        public const double FMin = 2.0;
        public const double FMax = 2.35;
        public const double ZNormal = 1.0;
        public static readonly (double F, double Zeta) Slow = (1.45, 1.0);
        public static readonly (double F, double Zeta) Lift = (1.2, 0.75);
        public static readonly (double F, double Zeta) Impulse = (2.0, 0.5);
    }

    public static class Stagger
    {
        public const double BaseMs = 50;
        public const double Decay = 1.05;
    }

    public static class Decay
    {
        public const double TauMs = 520;
        public const double DropMs = 120;
    }

    public static class Interlude
    {
        public const double MinGapMs = 7000;
        public const double CycleMs = 4000;
        public const double LeaveMs = 500;
        public const double EnterMs = 750;
        public const double FadeMs = 250;
        public const double DotEm = 0.22;
        public const double DotStepMs = 80;
    }

    public static class Build
    {
        public const double FadeInMs = 400;
        public const double SeekOutMs = 160;
        public const double RecedeMs = 420;
    }

    public static class Reduced
    {
        public const double CrossfadeMs = 180;
        public const double DotsAlpha = 0.6;
    }

    public static class LineTimed
    {
        public const double EndGapMs = 100;
        public const double LastLineMs = 6000;
    }

    public static class Beat
    {
        public const double ScaleMax = 0.012;
        public const double ScaleCap = 0.015;
        public const double QuietMs = 300;
        public const double BassForce = 0.022;
        public const double SustainAttackMs = 120;
        public const double SustainReleaseMs = 400;
        public const double IntenseAbove = 0.75;
        public const double PassageMs = 2000;
        public const double IntenseGlow = 0.05;
    }
}
