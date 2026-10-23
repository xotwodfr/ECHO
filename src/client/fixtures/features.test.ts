import { describe, expect, it } from 'vitest';
import pulse from './features/pulse.json';
import { featureSource, parseFeatureTrack } from './features.ts';

const frame = (over: Record<string, unknown> = {}) => ({
  available: true,
  sub: 0,
  bass: 0,
  mid: 0,
  high: 0,
  onset: 0,
  intensity: 0.5,
  bassImpulse: 0,
  ...over,
});

describe('recorded Features fixtures (VISUALIZER_SPEC.md §10)', () => {
  it('accepts the shipped fixtures', () => {
    expect(typeof parseFeatureTrack(pulse)).toBe('object');
  });

  it('rejects malformed files with a reason', () => {
    expect(parseFeatureTrack(null)).toBe('not an object');
    expect(parseFeatureTrack({ fps: 0, frames: [frame()] })).toMatch(/fps/);
    expect(parseFeatureTrack({ fps: 60, frames: [] })).toMatch(/frames/);
    expect(parseFeatureTrack({ fps: 60, frames: [frame(), frame({ bass: 1.5 })] })).toMatch(
      /frame 1/,
    );
    expect(parseFeatureTrack({ fps: 60, frames: [frame({ available: 1 })] })).toMatch(/frame 0/);
  });

  it('samples the frame at song time and holds the ends', () => {
    const track = { fps: 10, frames: [0, 1, 2].map((i) => frame({ mid: i / 10 })) };
    const s = featureSource(track);
    expect(s.sample(0, 0).mid).toBe(0);
    expect(s.sample(99, 0).mid).toBe(0);
    expect(s.sample(100, 0).mid).toBe(0.1);
    expect(s.sample(250, 0).mid).toBe(0.2);
    expect(s.sample(10_000, 0).mid).toBe(0.2);
    expect(s.sample(-50, 0).mid).toBe(0);
  });
});
