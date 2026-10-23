// OKLab / OKLCH ↔ linear sRGB (Björn Ottosson's published matrices), shared by the client (Stage
// uniforms now, palette interpolation in M4) and the server (palette extraction in M4).

export type Vec3 = [number, number, number];

export function oklabToLinearSrgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function linearSrgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const oklchToOklab = (L: number, C: number, hDeg: number): Vec3 => {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
};

/** sRGB transfer function, one channel (0..1). */
export const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

/** A CSS number or percentage (`0.68`, `.68`, `68%`); `pct` is what 100% means. */
function num(token: string, pct = 1) {
  const v = Number.parseFloat(token);
  if (Number.isNaN(v)) throw new Error(`not a number: ${token}`);
  return token.endsWith('%') ? (v / 100) * pct : v;
}

/** A CSS hue: a number of degrees, or `deg`/`turn`/`rad`/`grad`. */
function hue(token: string) {
  const v = Number.parseFloat(token);
  if (token.endsWith('turn')) return v * 360;
  if (token.endsWith('grad')) return v * 0.9;
  if (token.endsWith('rad')) return (v * 180) / Math.PI;
  return v;
}

/**
 * Parses the colour forms ECHO's tokens use, as written or as a CSS minifier rewrites them:
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `oklch(L C H [/ A])` with numbers or percentages.
 * Returns linear sRGB (gamut-clipped to 0..1) and alpha.
 */
export function parseColor(css: string): { rgb: Vec3; alpha: number } {
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex && hex.length !== 5 && hex.length !== 7) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const byte = (i: number) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return {
      rgb: [srgbToLinear(byte(0)), srgbToLinear(byte(1)), srgbToLinear(byte(2))],
      alpha: full.length === 8 ? byte(3) : 1,
    };
  }
  const ok = /^oklch\((.*)\)$/.exec(s)?.[1];
  if (ok) {
    const [channels, alpha] = ok.split('/');
    const [L, C, H] = (channels ?? '').trim().split(/\s+/);
    if (L && C && H) {
      const lab = oklchToOklab(num(L), num(C, 0.4), hue(H));
      const rgb = oklabToLinearSrgb(lab).map((v) => Math.min(1, Math.max(0, v))) as Vec3;
      return { rgb, alpha: alpha === undefined ? 1 : num(alpha.trim()) };
    }
  }
  throw new Error(`unsupported colour: ${css}`);
}
