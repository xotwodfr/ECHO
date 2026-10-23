import { describe, expect, it } from 'vitest';
import type { Features } from '../../shared/types.ts';
import { featureTracks } from './feature-tracks.ts';
import { loadFeatureFixture } from './features.ts';
import { GUIDE_ALBUM_ID, guideFeatures, guideFixtureOf, guideNames } from './guide.ts';
import { fixtureLibrary } from './library.ts';
import { lyricFixtures } from './lyrics.ts';

const FRAME = 1000 / 60;
const LEVELS = ['sub', 'bass', 'mid', 'high', 'onset', 'intensity', 'bassImpulse'] as const;

/** 60 Hz frames over `ms`, as the Stage loop samples them. */
function frames(name: string, ms: number): Features[] {
  const src = featureTracks[name];
  if (!src) throw new Error(name);
  const out: Features[] = [];
  for (let i = 0; i * FRAME < ms; i++) out.push(src.sample(i * FRAME, FRAME));
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('hand-authored Features tracks (M3 task 2)', () => {
  it.each(['ballad', 'pop', 'techno', 'silence'])('%s: available, every level in 0..1', (name) => {
    for (const f of frames(name, 120_000)) {
      expect(f.available).toBe(true);
      for (const k of LEVELS) {
        expect(f[k]).toBeGreaterThanOrEqual(0);
        expect(f[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each([
    ['ballad', 68, 2], // kick on 1 and the "and" of 3
    ['pop', 120, 4], // kick 1, 3 and snare 2, 4
    ['techno', 140, 4], // kick on every beat (claps coincide)
  ] as const)('%s: one onset per hit, %i BPM, %i per bar', (name, bpm, perBar) => {
    const bars = 16;
    const ms = (bars * 4 * 60_000) / bpm;
    const onsets = frames(name, ms).filter((f) => f.onset > 0).length;
    expect(onsets).toBe(bars * perBar);
  });

  it('a still frame (dt = 0) never shows an onset; the same time gives the same frame', () => {
    const techno = featureTracks.techno;
    expect(techno?.sample(0, 0).onset).toBe(0);
    expect(techno?.sample(12_345, 16)).toEqual(techno?.sample(12_345, 16));
  });

  it('bass peaks just after a kick and has decayed before the next one', () => {
    const pop = featureTracks.pop;
    const after = pop?.sample(10, FRAME).bass ?? 0; // kick at 0, attack 10 ms
    const before = pop?.sample(990, FRAME).bass ?? 1; // next kick at 1000
    expect(after).toBeGreaterThan(0.3);
    expect(before).toBeLessThan(0.01);
  });

  it('intensity rises from ballad to pop to techno; silence is zero', () => {
    const avg = (name: string) => mean(frames(name, 120_000).map((f) => f.intensity));
    expect(avg('ballad')).toBeLessThan(avg('pop'));
    expect(avg('pop')).toBeLessThan(avg('techno'));
    expect(frames('silence', 1000).every((f) => LEVELS.every((k) => f[k] === 0))).toBe(true);
  });
});

describe('guide tracks (M3 task 3)', () => {
  it('every lyric fixture has a guide track and a Features track', () => {
    const album = fixtureLibrary.album(GUIDE_ALBUM_ID);
    expect(album?.tracks.map((t) => t.title)).toEqual(Object.keys(lyricFixtures));
    for (const t of album?.tracks ?? []) {
      const name = guideFixtureOf(t) as string;
      expect(name).toBe(t.title);
      expect(t.durationMs).toBe(lyricFixtures[name]?.durationMs);
      expect(featureTracks[guideFeatures[name] as string]).toBeDefined();
    }
    expect(guideNames.length).toBe(10);
  });

  it('other library tracks are not guide tracks', () => {
    const other = fixtureLibrary.albums.find((a) => a.id !== GUIDE_ALBUM_ID);
    expect(other?.tracks.every((t) => guideFixtureOf(t) === undefined)).toBe(true);
  });

  it('`fixture=` accepts an authored track or a lyric fixture’s name', async () => {
    expect(await loadFeatureFixture('techno')).toBe(featureTracks.techno);
    expect(await loadFeatureFixture('rap-word')).toBe(featureTracks.techno);
  });
});
