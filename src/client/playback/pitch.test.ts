import { describe, expect, it } from 'vitest';
import { PitchShifter, semitoneRatio } from './pitch.ts';

const RATE = 48_000;

/** Runs `seconds` of a sine through the shifter in 128-sample blocks, as an AudioWorklet would. */
function shift(hz: number, semitones: number, seconds = 1.5) {
  const p = new PitchShifter(RATE, 2);
  p.setRatio(semitoneRatio(semitones));
  const total = Math.round(seconds * RATE);
  const out = new Float32Array(total);
  for (let at = 0; at < total; at += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * hz * (at + i)) / RATE);
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    p.process([block, block], [l, r], 128);
    out.set(l.subarray(0, Math.min(128, total - at)), at);
  }
  return { out, delay: p.delay };
}

/** The strongest frequency in `x` by a fine DFT scan between `lo` and `hi`. */
function peakHz(x: Float32Array, lo: number, hi: number) {
  let best = lo;
  let bestPower = -1;
  for (let f = lo; f <= hi; f += 0.5) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const a = (2 * Math.PI * f * i) / RATE;
      re += (x[i] as number) * Math.cos(a);
      im += (x[i] as number) * Math.sin(a);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('semitoneRatio', () => {
  it('is equal temperament', () => {
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(12)).toBe(2);
    expect(semitoneRatio(-12)).toBe(0.5);
    expect(semitoneRatio(1)).toBeCloseTo(1.059463, 6);
    expect(semitoneRatio(-6)).toBeCloseTo(Math.SQRT1_2, 9);
  });
});

describe('PitchShifter', () => {
  for (const n of [-6, -3, 2, 6]) {
    it(`moves a 440 Hz tone by ${n} semitones and keeps its level`, () => {
      const { out, delay } = shift(440, n);
      const steady = out.subarray(delay + 4800); // past the latency and the first grains
      const want = 440 * semitoneRatio(n);
      expect(Math.abs(peakHz(steady, want - 40, want + 40) - want)).toBeLessThan(2);
      expect(rms(steady)).toBeGreaterThan(0.5 * Math.SQRT1_2 * 0.85);
      expect(rms(steady)).toBeLessThan(0.5 * Math.SQRT1_2 * 1.15);
    });
  }

  it('keeps the tempo: a click comes out after the latency, not stretched or squeezed', () => {
    const p = new PitchShifter(RATE, 1);
    p.setRatio(semitoneRatio(5));
    const total = RATE;
    const clickAt = 12_800;
    let found = -1;
    for (let at = 0; at < total; at += 128) {
      const block = new Float32Array(128);
      if (clickAt >= at && clickAt < at + 128) block.fill(1, clickAt - at, clickAt - at + 64);
      const o = new Float32Array(128);
      p.process([block], [o], 128);
      for (let i = 0; i < 128; i++)
        if (found < 0 && Math.abs(o[i] as number) > 0.05) found = at + i;
    }
    // A grain may lead or lag by up to half a grain, plus the alignment's seek.
    expect(Math.abs(found - (clickAt + p.delay))).toBeLessThan(p.grain);
  });

  it('is silent for silence', () => {
    const p = new PitchShifter(RATE, 2);
    p.setRatio(semitoneRatio(-4));
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let i = 0; i < 200; i++) p.process([], [l, r], 128);
    expect(rms(l)).toBe(0);
  });
});
