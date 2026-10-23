import { parseColor, type Vec3 } from '../../shared/oklab.ts';

// The Stage's palette roles (DESIGN_SYSTEM.md §3.3), read from the `--art-*` custom properties:
// one source of truth. In M2 those hold tokens.css's achromatic fallback; from M4 the
// PaletteAnimator writes extracted palettes into the same properties.

export interface Palette {
  room: string;
  accent: string;
  highlight: string;
  glow: string;
  shadow: string;
}

/** The roles as currently set on `el` (normally :root). */
export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(`--art-${name}`).trim();
  return {
    room: v('room'),
    accent: v('accent'),
    highlight: v('highlight'),
    glow: v('glow'),
    shadow: v('shadow'),
  };
}

/** Linear-sRGB uniforms ("converted OKLab → linear sRGB in JS before upload", VISUALIZER §5.2). */
export interface PaletteUniforms {
  room: Vec3;
  accent: Vec3;
  highlight: Vec3;
  /** Pre-multiplied by the role's alpha (≤ 0.35). */
  glow: Vec3;
  shadow: Vec3;
}

export function paletteUniforms(p: Palette): PaletteUniforms {
  const linear = (css: string) => parseColor(css).rgb;
  const glow = parseColor(p.glow);
  return {
    room: linear(p.room),
    accent: linear(p.accent),
    highlight: linear(p.highlight),
    glow: glow.rgb.map((c) => c * glow.alpha) as Vec3,
    shadow: linear(p.shadow),
  };
}

// Filmic tone map (Hable / Uncharted 2, VISUALIZER §5.2). Kept here so the shader and the exposure
// calibration below use the same curve.
export const HABLE = { A: 0.15, B: 0.5, C: 0.1, D: 0.2, E: 0.02, F: 0.3, W: 11.2 };
export function hable(x: number) {
  const { A, B, C, D, E, F } = HABLE;
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}

/**
 * Exposure so that dark colours come through the tone map unchanged: the curve's slope at 0
 * (normalised by the white point) is about 0.38, which would push the room (L 0.12–0.24) towards
 * black. Brighter light still rolls off into the shoulder.
 */
export const BASE_EXPOSURE = 1 / ((hable(1e-4) / 1e-4) * (1 / hable(HABLE.W)));
