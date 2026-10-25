import { describe, expect, it } from 'vitest';
import { parseColor } from '../../shared/oklab.ts';
import { M3_ROLES, m3Scheme } from './m3.ts';

// The shell's M3 scheme (DESIGN_SYSTEM.md §3.1): every pair M3 promises readable stays readable for
// any album seed, Sodium included.

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
];
const PAIRS: [string, string, number][] = [
  ['on-surface', 'surface', 7],
  ['on-surface', 'surface-container-highest', 4.5],
  ['on-surface-variant', 'surface-container-high', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-primary-container', 'primary-container', 4.5],
  ['on-secondary-container', 'secondary-container', 4.5],
  ['on-tertiary-container', 'tertiary-container', 4.5],
  ['on-error', 'error', 4.5],
  ['inverse-on-surface', 'inverse-surface', 4.5],
  ['primary', 'surface', 4.5],
  ['success', 'surface-container', 4.5],
  ['on-success-container', 'success-container', 4.5],
  ['on-warning-container', 'warning-container', 4.5],
  ['outline', 'surface', 3], // WCAG 1.4.11: control boundaries
];

describe('m3Scheme', () => {
  it('fills every role with a hex colour', () => {
    const s = m3Scheme('#E3B26B');
    for (const r of M3_ROLES) expect(s[r]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(SEEDS)('%s: the M3 contrast pairs hold', (seed) => {
    const s = m3Scheme(seed);
    for (const [fg, bg, min] of PAIRS)
      expect(contrast(s[fg as never], s[bg as never]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
        min,
      );
  });

  it('takes the hue of its seed', () => {
    const blue = parseColor(m3Scheme('#3A6FF2').primary).rgb;
    expect(blue[2]).toBeGreaterThan(blue[0]);
  });
});
