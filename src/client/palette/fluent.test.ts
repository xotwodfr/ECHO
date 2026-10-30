import { argbFromHex, Hct } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import { parseColor } from '../../shared/oklab.ts';
import { FLUENT_ROLES, fluentAccent } from './fluent.ts';

// The shell's Fluent accent ramp (DESIGN_SYSTEM.md §3.1): readable on its own text and on the
// Mica layers for any album seed, pale ones and the grey fallback included.

const lum = (css: string) => {
  const [r, g, b] = parseColor(css).rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const SEEDS = [
  '#E3B26B',
  '#3A6FF2',
  '#D9304A',
  '#2DBE6C',
  '#9B59D0',
  '#808080',
  'oklch(0.76 0.14 200)',
  '#FFF6B0',
  '#F5F5F5',
  '#535353',
];

describe('fluentAccent', () => {
  it.each(SEEDS)('%s: every role is a hex colour', (seed) => {
    const a = fluentAccent(seed);
    for (const r of FLUENT_ROLES) expect(a[r]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(SEEDS)('%s: text on the accent is readable', (seed) => {
    const a = fluentAccent(seed);
    for (const bg of ['accent', 'accent-hover', 'accent-press'] as const)
      expect(contrast(a['on-accent'], a[bg]), bg).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SEEDS)('%s: accent text is readable on the darkest and lightest layers', (seed) => {
    const a = fluentAccent(seed);
    expect(contrast(a['accent-text'], '#1C1C1C')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(a['accent-text'], '#3A3A3A')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SEEDS)('%s: the accent stands out from the frame', (seed) => {
    expect(contrast(fluentAccent(seed).accent, '#202020')).toBeGreaterThanOrEqual(3);
  });

  it('keeps the seed hue', () => {
    const seed = Hct.fromInt(argbFromHex('#3A6FF2')).hue;
    const hue = Hct.fromInt(argbFromHex(fluentAccent('#3A6FF2').accent)).hue;
    expect(Math.abs(((hue - seed + 540) % 360) - 180)).toBeLessThan(15);
  });
});
