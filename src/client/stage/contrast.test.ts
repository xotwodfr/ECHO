import { describe, expect, it } from 'vitest';
import {
  contrastAt,
  EXPOSURE_MIN,
  FLOORS,
  type Inks,
  passes,
  peakL,
  SCRIM_MAX,
  type Solve,
  solveStep,
} from './contrast.ts';

// DESIGN_SYSTEM.md §3.4: the floors, and the controller that darkens the room to keep them.

const FALLBACK: Inks = {
  inkActive: 'oklch(0.95 0.006 80)',
  room: 'oklch(0.16 0.006 250)',
  text: '#F2F1EE',
  highlight: 'oklch(0.92 0.04 80)',
};

/** A room whose peak L responds to the zone exposure like the composite does. */
const roomPeak = (L0: number, s: Solve) => Math.cbrt(L0 ** 3 * (1 + s.exposure));

describe('contrast floors (§3.4)', () => {
  it('the fallback palette on its own dark room clears every floor with room to spare', () => {
    const r = contrastAt(FALLBACK, 0.16);
    expect(passes(r)).toBe(true);
    expect(r.active).toBeGreaterThan(FLOORS.active * 1.3);
    expect(r.zone[2]).toBeGreaterThan(FLOORS.zone);
  });

  it('deeper slots have less contrast (opacity and the ink mix toward the room)', () => {
    const r = contrastAt(FALLBACK, 0.3);
    expect(r.zone[0]).toBeGreaterThan(r.zone[1] as number);
    expect(r.zone[1]).toBeGreaterThan(r.zone[2] as number);
    expect(r.lit).toBeGreaterThanOrEqual(r.active); // lighting never lowers contrast
  });

  it('a bright room fails, and the solver darkens it until the floors hold', () => {
    const L0 = 0.33; // the active line's 7:1 is the binding floor here
    expect(passes(contrastAt(FALLBACK, L0))).toBe(false);
    let s: Solve = { exposure: 0, scrim: 0 };
    for (let t = 0; t < 4000; t += 250)
      s = solveStep(s, contrastAt(FALLBACK, roomPeak(L0, s)), 250);
    expect(passes(contrastAt(FALLBACK, roomPeak(L0, s)))).toBe(true);
    expect(s.exposure).toBeLessThan(0);
  });

  it('+3 is reported but not enforced (open decision: the depth table cannot reach 3:1)', () => {
    // On the darkest room the palette allows, +3 is just above 3:1; on a brighter one it fails
    // while every enforced floor holds, and the solver leaves the room alone.
    expect(contrastAt(FALLBACK, 0.12).zone[2]).toBeGreaterThan(3);
    const r = contrastAt(FALLBACK, 0.24);
    expect(r.zone[2]).toBeLessThan(FLOORS.zone);
    expect(passes(r)).toBe(true);
    expect(solveStep({ exposure: 0, scrim: 0 }, r, 250)).toEqual({ exposure: 0, scrim: 0 });
  });

  it('a +2 failure darkens the room but never raises the scrim (it sits behind +0 only)', () => {
    // A bright band behind the zone, a dark one behind the active line.
    let L = 0.12;
    while ((contrastAt(FALLBACK, L).zone[1] as number) >= FLOORS.zone) L += 0.01;
    const r = contrastAt(FALLBACK, { active: 0.12, zone: L + 0.02 });
    expect(r.active).toBeGreaterThan(FLOORS.active);
    let s: Solve = { exposure: 0, scrim: 0 };
    for (let t = 0; t < 4000; t += 100) s = solveStep(s, r, 100);
    expect(s).toEqual({ exposure: EXPOSURE_MIN, scrim: 0 });
  });

  it('exposure goes first, to −40%; only then the scrim, up to 0.45', () => {
    let s: Solve = { exposure: 0, scrim: 0 };
    const report = contrastAt(FALLBACK, 0.9); // fails whatever is done
    let scrimBefore = true;
    for (let t = 0; t < 6000; t += 100) {
      s = solveStep(s, report, 100);
      if (s.scrim > 0) {
        expect(s.exposure).toBe(EXPOSURE_MIN);
        scrimBefore = false;
      }
    }
    expect(scrimBefore).toBe(false);
    expect(s.scrim).toBe(SCRIM_MAX);
  });

  it('slew-limited at 0.5/s, and releases (scrim first) only with margin', () => {
    const fail = contrastAt(FALLBACK, 0.9);
    const ok = contrastAt(FALLBACK, 0.1);
    const s1 = solveStep({ exposure: 0, scrim: 0 }, fail, 100);
    expect(s1.exposure).toBeCloseTo(-0.05, 9);
    const back = solveStep({ exposure: -0.4, scrim: 0.2 }, ok, 100);
    expect(back).toEqual({ exposure: -0.4, scrim: 0.15000000000000002 });
    // Just above the floors (not by the release margin): hold still, no hunting.
    let L = 0.1;
    while (passes(contrastAt(FALLBACK, L + 0.005))) L += 0.005;
    const edge = contrastAt(FALLBACK, L);
    expect(passes(edge)).toBe(true);
    expect(solveStep({ exposure: -0.2, scrim: 0 }, edge, 100)).toEqual({
      exposure: -0.2,
      scrim: 0,
    });
  });
});

describe('the probe readback', () => {
  it('peakL is the 95th-percentile OKLab L', () => {
    const px = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) {
      const v = i < 60 ? 30 : 250; // four bright pixels of 64 (6%)
      px.set([v, v, v, 255], i * 4);
    }
    expect(peakL(px)).toBeGreaterThan(0.95); // the top 5% is bright
    px.set([30, 30, 30, 255], 63 * 4);
    px.set([30, 30, 30, 255], 62 * 4);
    px.set([30, 30, 30, 255], 61 * 4);
    expect(peakL(px)).toBeLessThan(0.3); // one bright pixel is below the 95th percentile
  });
});
