import { describe, expect, it } from 'vitest';
import {
  bandResponseDb,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_PRESETS,
  eqGains,
  eqPreampDb,
  eqResponseDb,
} from './eq.ts';

describe('equalizer curve', () => {
  it('flat is flat, everywhere', () => {
    for (const hz of [20, 100, 1000, 5000, 18000])
      expect(eqResponseDb(EQ_PRESETS.flat, hz)).toBeCloseTo(0, 6);
  });

  it('a peaking band reaches its gain at its centre and leaves far bands alone', () => {
    expect(bandResponseDb('peaking', 1000, 6, 1000, 48_000)).toBeCloseTo(6, 3);
    expect(Math.abs(bandResponseDb('peaking', 1000, 6, 62, 48_000))).toBeLessThan(0.2);
    expect(Math.abs(bandResponseDb('peaking', 1000, 6, 16000, 48_000))).toBeLessThan(0.2);
  });

  it('the shelves lift their end of the range and reach half the gain at the corner', () => {
    expect(bandResponseDb('lowshelf', 31, 6, 10, 48_000)).toBeGreaterThan(5);
    expect(bandResponseDb('lowshelf', 31, 6, 31, 48_000)).toBeCloseTo(3, 1);
    expect(Math.abs(bandResponseDb('lowshelf', 31, 6, 1000, 48_000))).toBeLessThan(0.1);
    expect(bandResponseDb('highshelf', 16000, 6, 16000, 48_000)).toBeCloseTo(3, 1);
    expect(Math.abs(bandResponseDb('highshelf', 16000, 6, 1000, 48_000))).toBeLessThan(0.1);
  });

  it('bass boost lifts the lows over the highs; treble boost the reverse', () => {
    const bass = (hz: number) => eqResponseDb(EQ_PRESETS.bass, hz);
    const treble = (hz: number) => eqResponseDb(EQ_PRESETS.treble, hz);
    expect(bass(60) - bass(4000)).toBeGreaterThan(4);
    expect(treble(10000) - treble(100)).toBeGreaterThan(4);
    // Vocal: the voice's range over the bass.
    expect(
      eqResponseDb(EQ_PRESETS.vocal, 1500) - eqResponseDb(EQ_PRESETS.vocal, 50),
    ).toBeGreaterThan(4);
  });

  it('takes the largest boost off first, so no preset adds more than a little gain', () => {
    expect(eqPreampDb(EQ_PRESETS.bass)).toBe(-6);
    expect(eqPreampDb(EQ_PRESETS.flat)).toBe(-0);
    for (const [name, g] of Object.entries(EQ_PRESETS)) {
      let peak = Number.NEGATIVE_INFINITY;
      for (let hz = 20; hz <= 20000; hz *= 1.05) peak = Math.max(peak, eqResponseDb(g, hz));
      expect(peak, name).toBeLessThan(2.5); // neighbouring bands overlap a little
    }
  });

  it('every preset has a gain per band; custom curves are padded and clamped', () => {
    for (const g of Object.values(EQ_PRESETS)) expect(g).toHaveLength(EQ_BANDS.length);
    expect(eqGains('custom', [3, 99, -99])).toEqual([
      3,
      EQ_MAX_DB,
      -EQ_MAX_DB,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(eqGains('bass', [])).toEqual([...EQ_PRESETS.bass]);
  });
});
