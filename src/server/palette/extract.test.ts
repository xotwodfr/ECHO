import { describe, expect, it } from 'vitest';
import { linearSrgbToOklab, oklabToLinearSrgb, oklchToOklab } from '../../shared/oklab.ts';
import { covers, SIZE } from './covers.ts';
import { clustersOf, fallbackPalette, gamutMap, type Palette, paletteOf } from './extract.ts';

// VIS-02: the roles of every fixture cover sit in their OKLCH boxes (DESIGN_SYSTEM.md §3.3).

const lch = (css: string) => {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(css);
  if (!m) throw new Error(`not oklch: ${css}`);
  return { L: Number(m[1]), C: Number(m[2]), h: Number(m[3]), alpha: m[4] ? Number(m[4]) : 1 };
};
const palette = (name: string) => {
  const c = covers.find((x) => x.name === name);
  if (!c) throw new Error(name);
  return paletteOf(clustersOf(c.rgba, SIZE, SIZE));
};
const all = covers.map((c) => [c.name, c.kind, paletteOf(clustersOf(c.rgba, SIZE, SIZE))] as const);
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('palette roles (VIS-02)', () => {
  it('there are 30 fixture covers', () => expect(covers).toHaveLength(30));

  it.each(all)('%s (%s): every role in its box and inside sRGB', (_, __, p: Palette) => {
    const e = 1e-3;
    const room = lch(p.room);
    expect(room.L).toBeGreaterThanOrEqual(0.12 - e);
    expect(room.L).toBeLessThanOrEqual(0.24 + e);
    expect(room.C).toBeLessThanOrEqual(0.1 + e);
    const accent = lch(p.accent);
    expect(accent.L).toBeGreaterThanOrEqual(0.7 - e);
    expect(accent.L).toBeLessThanOrEqual(0.82 + e);
    expect(accent.C).toBeGreaterThanOrEqual(0.06 - e);
    expect(accent.C).toBeLessThanOrEqual(0.18 + e);
    const hi = lch(p.highlight);
    expect(hi.L).toBeGreaterThanOrEqual(0.86 - e);
    expect(hi.L).toBeLessThanOrEqual(0.94 + e);
    expect(hi.C).toBeLessThanOrEqual(0.1 + e);
    const glow = lch(p.glow);
    expect(glow.L).toBeGreaterThanOrEqual(0.6 - e);
    expect(glow.L).toBeLessThanOrEqual(0.72 + e);
    expect(glow.C).toBeLessThanOrEqual(0.14 + e);
    expect(glow.alpha).toBeLessThanOrEqual(0.35);
    const shadow = lch(p.shadow);
    expect(shadow.L).toBeGreaterThanOrEqual(0.06 - e);
    expect(shadow.L).toBeLessThanOrEqual(0.1 + e);
    expect(lch(p.inkActive).L).toBe(0.95);
    for (const role of [p.room, p.accent, p.highlight, p.glow, p.shadow, p.inkActive]) {
      const { L, C, h } = lch(role);
      for (const c of oklabToLinearSrgb(oklchToOklab(L, C, h))) {
        expect(c).toBeGreaterThanOrEqual(-2e-3);
        expect(c).toBeLessThanOrEqual(1 + 2e-3);
      }
    }
    expect(p.version).toBe(1);
  });

  it('achromatic covers give the Sodium fallback, with no invented hue', () => {
    for (const [name, kind, p] of all) {
      if (kind !== 'achromatic') continue;
      expect(p, name).toEqual(fallbackPalette());
      expect(p.source).toBe('fallback');
    }
  });

  it('a coloured frame is dropped with the 3% border; transparent corners are ignored', () => {
    expect(palette('framed-grey').source).toBe('fallback');
    expect(hueGap(lch(palette('round-badge').accent).h, 210)).toBeLessThan(15);
  });

  it('mostly white covers get a dark room: from their dark type, else neutral in the cover hue', () => {
    const typed = lch(palette('white-blue-type').room);
    expect(typed.L).toBeLessThanOrEqual(0.24);
    expect(hueGap(typed.h, 260)).toBeLessThan(15);
    for (const name of ['white-plain', 'white-dark-type']) {
      const room = lch(palette(name).room);
      expect(room.L).toBeLessThanOrEqual(0.24);
      expect(room.C).toBeLessThanOrEqual(0.03 + 1e-3);
    }
  });

  it('neon covers are smoked: accent C ≤ 0.18, room C ≤ 0.10', () => {
    for (const [, kind, p] of all) {
      if (kind !== 'neon') continue;
      expect(lch(p.accent).C).toBeLessThanOrEqual(0.18 + 1e-3);
      expect(lch(p.room).C).toBeLessThanOrEqual(0.1 + 1e-3);
    }
  });

  it('hue is kept: a solid cover’s accent and room share its hue', () => {
    for (const h of [25, 70, 110, 150, 200, 250, 290, 330]) {
      const p = palette(`solid-${h}`);
      expect(hueGap(lch(p.accent).h, h), `accent ${h}`).toBeLessThan(8);
      expect(hueGap(lch(p.room).h, h), `room ${h}`).toBeLessThan(8);
    }
  });

  it('the accent skips the dominant colour when a real alternative exists', () => {
    // Dark navy ground (dominant, C 0.08) with a teal subject: the accent is the teal.
    expect(hueGap(lch(palette('teal-on-navy').accent).h, 190)).toBeLessThan(15);
    // A tiny magenta accent on a brownish ground still wins on chroma.
    expect(hueGap(lch(palette('small-accent').accent).h, 340)).toBeLessThan(20);
  });
});

describe('determinism', () => {
  it('the same cover always gives the same palette', () => {
    const c = covers.find((x) => x.name === 'fire');
    if (!c) throw new Error('fire');
    const a = paletteOf(clustersOf(c.rgba, SIZE, SIZE));
    for (let i = 0; i < 5; i++) expect(paletteOf(clustersOf(c.rgba, SIZE, SIZE))).toEqual(a);
  });
});

describe('gamut mapping', () => {
  it('reduces chroma at constant L and h until inside sRGB', () => {
    const [L, C, h] = gamutMap([0.7, 0.4, 145]);
    expect(L).toBe(0.7);
    expect(h).toBe(145);
    expect(C).toBeLessThan(0.4);
    expect(C).toBeGreaterThan(0.15);
    for (const c of oklabToLinearSrgb(oklchToOklab(L, C, h))) {
      expect(c).toBeGreaterThanOrEqual(-1e-6);
      expect(c).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(gamutMap([0.5, 0.05, 30])).toEqual([0.5, 0.05, 30]); // already inside
    expect(linearSrgbToOklab([1, 1, 1])[0]).toBeCloseTo(1, 4);
  });
});
