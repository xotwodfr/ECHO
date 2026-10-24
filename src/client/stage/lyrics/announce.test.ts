import { describe, expect, it } from 'vitest';
import { ANNOUNCE_GAP_MS, Announcer } from './announce.ts';

const FRAME = 1000 / 60;

/** Feeds `lines` (active index by time) and returns [time, text] of every announcement. */
function play(activeAt: (t: number) => number, ms: number, on = true, quiet = false) {
  const a = new Announcer();
  const out: [number, string][] = [];
  for (let t = 0; t < ms; t += FRAME) {
    const i = activeAt(t);
    const s = a.update(i, `line ${i}`, FRAME, on, quiet);
    if (s) out.push([t, s]);
  }
  return out;
}

describe('line announcements (§11, A11Y-04)', () => {
  it('say each line at its hand-over when they are spaced out', () => {
    const out = play((t) => Math.floor(t / 3000), 12_000);
    expect(out.map(([, s]) => s)).toEqual(['line 0', 'line 1', 'line 2', 'line 3']);
  });

  it('at most one per 1.5 s; a fast run keeps the latest line, never an old one', () => {
    const out = play((t) => Math.floor(t / 400), 10_000); // a hand-over every 400 ms
    for (let k = 1; k < out.length; k++)
      expect(
        (out[k] as [number, string])[0] - (out[k - 1] as [number, string])[0],
      ).toBeGreaterThanOrEqual(ANNOUNCE_GAP_MS - FRAME);
    for (const [t, s] of out) expect(Number(s.slice(5))).toBe(Math.floor(t / 400));
    expect(out.length).toBeGreaterThan(5);
  });

  it('nothing when off, while scrubbing, or between lines', () => {
    expect(play((t) => Math.floor(t / 1000), 6000, false)).toEqual([]);
    expect(play((t) => Math.floor(t / 1000), 6000, true, true)).toEqual([]);
    expect(play(() => -1, 6000)).toEqual([]);
  });
});
