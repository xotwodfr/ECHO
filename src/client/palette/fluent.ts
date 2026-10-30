import { Hct, hexFromArgb, TonalPalette } from '@material/material-color-utilities';
import { linearToSrgb, oklabToLinearSrgb, oklchToOklab, parseColor } from '../../shared/oklab.ts';

// The shell's Fluent 2 accent (DESIGN_SYSTEM.md §3.1): one ramp from the playing album's accent
// (the grey fallback when nothing plays), published as --fl-<role> and animated with the artwork
// palette (animator.ts). Tones are HCT's, so a fixed tone gap keeps a pair readable for any seed.

const TONES = {
  accent: 80,
  'accent-hover': 85,
  'accent-press': 75,
  'on-accent': 10,
  'accent-text': 82,
  'accent-subtle': 30,
} as const;

export const FLUENT_ROLES = Object.keys(TONES) as (keyof typeof TONES)[];
export type FluentRole = keyof typeof TONES;

/** The CSS custom property a role is published as. */
export const flVar = (role: FluentRole) => `--fl-${role}`;

/** Any CSS colour `parseColor` reads, or `oklch(L C H)`, as opaque ARGB. */
function argbOf(css: string): number {
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css.trim());
  const rgb = ok
    ? oklabToLinearSrgb(oklchToOklab(Number(ok[1]), Number(ok[2]), Number(ok[3])))
    : parseColor(css).rgb;
  const [r, g, b] = rgb.map((v) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255)) as [
    number,
    number,
    number,
  ];
  return (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
}

/** The accent ramp for `seed` (any CSS colour), as hex per role. */
export function fluentAccent(seed: string): Record<FluentRole, string> {
  const hct = Hct.fromInt(argbOf(seed));
  // A grey seed (the fallback, a monochrome cover) stays grey; a coloured one is never washed out.
  const chroma = hct.chroma < 8 ? hct.chroma : Math.max(hct.chroma, 16);
  const p = TonalPalette.fromHueAndChroma(hct.hue, chroma);
  const out = {} as Record<FluentRole, string>;
  for (const r of FLUENT_ROLES) out[r] = hexFromArgb(p.tone(TONES[r]));
  return out;
}
