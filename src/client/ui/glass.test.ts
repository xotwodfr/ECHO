import { describe, expect, it } from 'vitest';
import {
  bend,
  bendProfile,
  type GlassParams,
  glassMaps,
  glassQuads,
  glassUniforms,
} from './glass.ts';

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

describe('Stage glass uniforms (the composite draws the glass over the room)', () => {
  const canvas = { x: 0, y: 0, width: 1440, height: 900 };
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('boxes become canvas CSS px with their radii, in order', () => {
    const at = { ...canvas, x: 10, y: 20 };
    const u = glassUniforms(at, [{ box: box(1110, 44, 48, 48), radii: [24, 24, 24, 24] }], 8);
    expect(u.count).toBe(1);
    expect([...u.rects.subarray(0, 4)]).toEqual([1100, 24, 48, 48]);
    expect([...u.corners.subarray(0, 4)]).toEqual([24, 24, 24, 24]);
  });

  it('leaves out boxes with no area or off the canvas, and stops at the maximum', () => {
    const u = glassUniforms(
      canvas,
      [
        { box: box(10, 10, 0, 48), radii: [0, 0, 0, 0] }, // display: none
        { box: box(1440, 10, 48, 48), radii: [0, 0, 0, 0] }, // right of the canvas
        { box: box(10, -60, 48, 48), radii: [0, 0, 0, 0] }, // above it
        { box: box(0, 812, 1440, 88), radii: [1, 2, 3, 4] }, // the dock
        { box: box(1100, 24, 48, 48), radii: [24, 24, 24, 24] },
        { box: box(1160, 24, 48, 48), radii: [24, 24, 24, 24] },
      ],
      2,
    );
    expect(u.count).toBe(2);
    expect([...u.rects]).toEqual([0, 812, 1440, 88, 1100, 24, 48, 48]);
    expect([...u.corners.subarray(0, 4)]).toEqual([1, 2, 3, 4]);
  });

  it('keeps a box that only partly overlaps the canvas', () => {
    expect(
      glassUniforms(canvas, [{ box: box(-20, 0, 48, 48), radii: [0, 0, 0, 0] }], 8).count,
    ).toBe(1);
  });

  it('the glass pass covers exactly the boxes, in clip space, facing the camera', () => {
    const q = glassQuads(new Float32Array([360, 0, 720, 225, 0, 0, 0, 0]), 1, 1440, 900);
    expect(q).toHaveLength(18);
    const at = (i: number) => q[i] ?? Number.NaN;
    const xs = [0, 3, 6, 9, 12, 15].map(at);
    const ys = [1, 4, 7, 10, 13, 16].map(at);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      -0.5, 0.5, 0.5, 1,
    ]);
    // Both triangles counter-clockwise: a positive signed area (back faces are culled).
    for (const t of [0, 9]) {
      const [ax, ay, bx, by, cx, cy] = [0, 1, 3, 4, 6, 7].map((i) => at(t + i)) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      expect((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)).toBeGreaterThan(0);
    }
  });

  it('the bend lookup runs from the edge to the flat top, refraction applied', () => {
    const p = bendProfile({ ...G, refraction: 0.5 }, 32);
    expect(p).toHaveLength(32);
    expect(p[0]).toBeCloseTo(bend(G, 0) * 0.5, 6);
    expect(p[31]).toBeCloseTo(0, 6);
    expect(p[0]).toBeGreaterThan(p[8] ?? 0);
  });
});
