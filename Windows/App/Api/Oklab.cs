using System.Globalization;
using System.Text.RegularExpressions;

namespace Echo;

// OKLab / OKLCH ↔ linear sRGB (src/shared/oklab.ts, Björn Ottosson's matrices; Android's Oklab.kt): the
// server sends the album palette as CSS oklch(), the room wants linear light and the UI wants sRGB.

/// Linear sRGB, 0..1 per channel, and alpha.
public readonly record struct Linear(float R, float G, float B, float A = 1f)
{
    /// Opaque sRGB as ARGB.
    public uint ToArgb()
    {
        static uint Ch(float v) => (uint)(Oklab.LinearToSrgb(Math.Clamp(v, 0, 1)) * 255 + 0.5);
        return 0xFF000000u | Ch(R) << 16 | Ch(G) << 8 | Ch(B);
    }
}

public static partial class Oklab
{
    public static double[] OklabToLinear(double l0, double a, double b)
    {
        var l = Math.Pow(l0 + 0.3963377774 * a + 0.2158037573 * b, 3);
        var m = Math.Pow(l0 - 0.1055613458 * a - 0.0638541728 * b, 3);
        var s = Math.Pow(l0 - 0.0894841775 * a - 1.291485548 * b, 3);
        return
        [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ];
    }

    public static double[] LinearToOklab(double r, double g, double b)
    {
        var l = Math.Cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        var m = Math.Cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        var s = Math.Cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return
        [
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ];
    }

    public static double SrgbToLinear(double c) => c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);

    public static double LinearToSrgb(double c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.Pow(c, 1 / 2.4) - 0.055;

    /// A CSS number or percentage; `pct` is what 100% means.
    static double Num(string token, double pct = 1.0)
    {
        var v = double.Parse(token.TrimEnd('%'), CultureInfo.InvariantCulture);
        return token.EndsWith('%') ? v / 100 * pct : v;
    }

    static double Hue(string token)
    {
        var v = double.Parse(new string(token.Where(c => char.IsDigit(c) || c is '.' or '-').ToArray()), CultureInfo.InvariantCulture);
        return token.EndsWith("turn") ? v * 360
            : token.EndsWith("grad") ? v * 0.9
            : token.EndsWith("rad") ? v * 180 / Math.PI
            : v;
    }

    /// `#rgb[a]`, `#rrggbb[aa]` and `oklch(L C H [/ A])`, as linear sRGB (gamut-clipped) and alpha.
    public static Linear ParseCss(string css)
    {
        var s = css.Trim().ToLowerInvariant();
        if (s.StartsWith('#'))
        {
            var hex = s[1..];
            if (hex.Length <= 4) hex = string.Concat(hex.Select(c => $"{c}{c}"));
            if (hex.Length is not (6 or 8)) throw new FormatException($"unsupported colour: {css}");
            double Byte(int i) => Convert.ToInt32(hex.Substring(i * 2, 2), 16) / 255.0;
            return new Linear((float)SrgbToLinear(Byte(0)), (float)SrgbToLinear(Byte(1)), (float)SrgbToLinear(Byte(2)),
                hex.Length == 8 ? (float)Byte(3) : 1f);
        }
        if (!s.StartsWith("oklch(") || !s.EndsWith(')')) throw new FormatException($"unsupported colour: {css}");
        var parts = s["oklch(".Length..^1].Split('/');
        var lch = Spaces().Split(parts[0].Trim());
        var hr = Hue(lch[2]) * Math.PI / 180;
        var rgb = OklabToLinear(Num(lch[0]), Num(lch[1], 0.4) * Math.Cos(hr), Num(lch[1], 0.4) * Math.Sin(hr));
        static float Clip(double v) => (float)Math.Clamp(v, 0, 1);
        return new Linear(Clip(rgb[0]), Clip(rgb[1]), Clip(rgb[2]), parts.Length > 1 ? (float)Num(parts[1].Trim()) : 1f);
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
