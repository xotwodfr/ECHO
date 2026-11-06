namespace Echo.Stage;

/// The room's palette roles (DESIGN_SYSTEM.md §3.3) as linear light; `Glow` keeps its alpha (Android's AlbumPalette.kt).
public sealed record StagePalette(Linear Room, Linear Accent, Linear Highlight, Linear Glow, Linear Shadow, Linear Ink)
{
    /// tokens.css: the achromatic fallback while nothing plays or the album has no palette.
    public static readonly StagePalette Fallback = Of(new Palette("oklch(0.16 0.006 250)", "#E3B26B",
        "oklch(0.92 0.04 80)", "oklch(0.68 0.10 75 / 0.35)", "oklch(0.08 0.004 250)", "oklch(0.95 0.006 80)"));

    public static StagePalette Of(Palette p) => new(Oklab.ParseCss(p.Room), Oklab.ParseCss(p.Accent),
        Oklab.ParseCss(p.Highlight), Oklab.ParseCss(p.Glow), Oklab.ParseCss(p.Shadow),
        Oklab.ParseCss(p.InkActive ?? "oklch(0.95 0.006 80)"));
}
