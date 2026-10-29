import { describe, expect, it } from 'vitest';
import { bend, type GlassParams, glassMaps } from './glass.ts';

const G: GlassParams = {
  thickness: 24,
  bezel: 20,
  ior: 1.5,
  refraction: 1,
  specular: 0.5,
  light: 135,
};

describe('liquid glass maps (DESIGN_SYSTEM.md §7.11)', () => {
  it('bends most at the edge, not at all on the flat top or without refraction', () => {
    expect(bend(G, 0)).toBeGreaterThan(bend(G, 0.5));
    expect(bend(G, 0.5)).toBeGreaterThan(0);
    expect(bend(G, 1)).toBeCloseTo(0, 6);
    expect(bend({ ...G, ior: 1 }, 0)).toBeCloseTo(0, 6);
  });

  it('shifts the view inward inside the rim and leaves the interior unbent', () => {
    const w = 100;
    const h = 60;
    const { displacement: d, specular: s, scale } = glassMaps(w, h, [8, 8, 8, 8], G);
    const at = (x: number, y: number) => (y * w + x) * 4;
    expect(scale).toBeGreaterThan(0);
    // Interior: neutral, unlit.
    expect([d[at(50, 30)], d[at(50, 30) + 1], s[at(50, 30) + 3]]).toEqual([128, 128, 0]);
    // Left edge samples to the right (R > 128), right edge to the left, top edge downward.
    expect(d[at(0, 30)]).toBeGreaterThan(128);
    expect(d[at(w - 1, 30)]).toBeLessThan(128);
    expect(d[at(50, 0) + 1]).toBeGreaterThan(128);
    expect(d[at(0, 30) + 1]).toBe(128);
    // The rim catches light; outside a rounded corner there is no glass.
    expect(s[at(0, 30) + 3]).toBeGreaterThan(0);
    expect([d[at(0, 0)], d[at(0, 0) + 1], s[at(0, 0) + 3]]).toEqual([128, 128, 0]);
  });

  it('a square box still has a rim on every side', () => {
    const { displacement: d } = glassMaps(40, 40, [0, 0, 0, 0], G);
    expect(d[(20 * 40 + 0) * 4]).toBeGreaterThan(128);
  });
});
