import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types.ts';
import { crossfadeBetween, fadeCurve } from './crossfade.ts';
import { effectiveKey } from './effects.ts';

const song = (id: string, album: string | undefined, key = `navidrome:${album}`): Track => ({
  key: `navidrome:${id}`,
  provider: 'navidrome',
  id,
  title: id,
  artists: [{ name: 'A' }],
  album: { ...(album && { id: album }), title: 'Album', key },
  durationMs: 200_000,
  artwork: [],
});

describe('crossfade gain ramps', () => {
  it('are equal-power: in² + out² = 1 all along, from full to silence', () => {
    const fin = fadeCurve('in', 33);
    const fout = fadeCurve('out', 33);
    expect(fin[0]).toBe(0);
    expect(fin[32]).toBe(1);
    expect(fout[0]).toBe(1);
    expect(fout[32]).toBeCloseTo(0, 12);
    for (let i = 0; i < 33; i++)
      expect((fin[i] as number) ** 2 + (fout[i] as number) ** 2).toBeCloseTo(1, 6);
    // Halfway, each is at −3 dB (not −6, which would dip in the middle).
    expect(20 * Math.log10(fin[16] as number)).toBeCloseTo(-3.01, 1);
  });

  it('only rise (in) or fall (out)', () => {
    const fin = fadeCurve('in');
    const fout = fadeCurve('out');
    for (let i = 1; i < fin.length; i++) {
      expect(fin[i] as number).toBeGreaterThan(fin[i - 1] as number);
      expect(fout[i] as number).toBeLessThan(fout[i - 1] as number);
    }
  });
});

describe('crossfadeBetween', () => {
  it('fades between albums, never within one (gapless albums stay gapless)', () => {
    expect(crossfadeBetween(song('1', 'a'), song('2', 'b'))).toBe(true);
    expect(crossfadeBetween(song('1', 'a'), song('2', 'a'))).toBe(false);
    // Without an album id, the album key decides.
    expect(crossfadeBetween(song('1', undefined, 'k'), song('2', undefined, 'k'))).toBe(false);
    expect(crossfadeBetween(song('1', undefined, 'k'), song('2', undefined, 'l'))).toBe(true);
    expect(crossfadeBetween(song('1', 'a'), null)).toBe(false);
    expect(crossfadeBetween(song('1', 'a'), song('1', 'a'))).toBe(false);
  });
});

describe("Karaoke's key", () => {
  it('applies only while Karaoke is on, in whole semitones within ±6', () => {
    expect(effectiveKey({ karaoke: false, karaokeKey: 3 })).toBe(0);
    expect(effectiveKey({ karaoke: true, karaokeKey: 3 })).toBe(3);
    expect(effectiveKey({ karaoke: true, karaokeKey: -9 })).toBe(-6);
    expect(effectiveKey({ karaoke: true, karaokeKey: 2.4 })).toBe(2);
  });
});
