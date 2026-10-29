import {
  Blend,
  MaterialDynamicColors as C,
  type DynamicColor,
  Hct,
  hexFromArgb,
  SchemeContent,
  TonalPalette,
} from '@material/material-color-utilities';
import { linearToSrgb, oklabToLinearSrgb, oklchToOklab, parseColor } from '../../shared/oklab.ts';

// The shell's Material 3 colour scheme (DESIGN_SYSTEM.md §3.1): M3 Expressive, dark, from the
// playing album's accent as the seed (Sodium when nothing plays), so the shell takes the album's
// colour the way Material You takes the wallpaper's. Published as --md-sys-color-* and animated
// with the artwork palette (animator.ts).

const ROLES = {
  primary: C.primary,
  'on-primary': C.onPrimary,
  'primary-container': C.primaryContainer,
  'on-primary-container': C.onPrimaryContainer,
  secondary: C.secondary,
  'on-secondary': C.onSecondary,
  'secondary-container': C.secondaryContainer,
  'on-secondary-container': C.onSecondaryContainer,
  tertiary: C.tertiary,
  'on-tertiary': C.onTertiary,
  'tertiary-container': C.tertiaryContainer,
  'on-tertiary-container': C.onTertiaryContainer,
  error: C.error,
  'on-error': C.onError,
  'error-container': C.errorContainer,
  'on-error-container': C.onErrorContainer,
  surface: C.surface,
  'surface-dim': C.surfaceDim,
  'surface-bright': C.surfaceBright,
  'surface-container-lowest': C.surfaceContainerLowest,
  'surface-container-low': C.surfaceContainerLow,
  'surface-container': C.surfaceContainer,
  'surface-container-high': C.surfaceContainerHigh,
  'surface-container-highest': C.surfaceContainerHighest,
  'on-surface': C.onSurface,
  'on-surface-variant': C.onSurfaceVariant,
  outline: C.outline,
  'outline-variant': C.outlineVariant,
  'inverse-surface': C.inverseSurface,
  'inverse-on-surface': C.inverseOnSurface,
  'inverse-primary': C.inversePrimary,
  scrim: C.scrim,
  shadow: C.shadow,
} satisfies Record<string, DynamicColor>;

/** Status colours as M3 custom colours, harmonised toward the seed (§3.1: success, warning). */
const CUSTOM = { success: 0xff7fd6a0, warning: 0xffe5a93b } as const;

export const M3_ROLES = [
  ...(Object.keys(ROLES) as (keyof typeof ROLES)[]),
  ...(Object.keys(CUSTOM) as (keyof typeof CUSTOM)[]).flatMap(
    (c) => [c, `on-${c}`, `${c}-container`, `on-${c}-container`] as const,
  ),
];
export type M3Role = (typeof M3_ROLES)[number];

/** The CSS custom property a role is published as. */
export const m3Var = (role: M3Role) => `--md-sys-color-${role}`;

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

/** The dark M3 content scheme for `seed` (any CSS colour), as hex per role. */
export function m3Scheme(seed: string): Record<M3Role, string> {
  const source = argbOf(seed);
  const scheme = new SchemeContent(Hct.fromInt(source), true, 0, '2025');
  const out = {} as Record<M3Role, string>;
  for (const [role, color] of Object.entries(ROLES))
    out[role as M3Role] = hexFromArgb(color.getArgb(scheme));
  for (const [name, argb] of Object.entries(CUSTOM)) {
    const p = TonalPalette.fromInt(Blend.harmonize(argb, source));
    out[name as M3Role] = hexFromArgb(p.tone(80));
    out[`on-${name}` as M3Role] = hexFromArgb(p.tone(20));
    out[`${name}-container` as M3Role] = hexFromArgb(p.tone(30));
    out[`on-${name}-container` as M3Role] = hexFromArgb(p.tone(90));
  }
  return out;
}
