import { describe, expect, it } from 'vitest';
import type { Features } from '../../shared/types.ts';
import { featureTracks } from '../fixtures/feature-tracks.ts';
import { SILENT_FEATURES } from '../playback/features.ts';
import { createReverb, LUMA_SLEW_PER_S, ringLight, SETTINGS, safeTint } from './reverb.ts';

// VISUALIZER_SPEC.md §4.3–§4.5, §7.2–§7.4.

const FRAME = 1000 / 60;
const KEY: [number, number] = [0.5, 0.4];
const feat = (over: Partial<Features>): Features => ({
  ...SILENT_FEATURES.sample(0, 0),
  available: true,
  intensity: 0.6,
  ...over,
});

function play(name: string, seconds: number, setting?: 'subtle' | 'balanced' | 'expressive') {
  const r = createReverb(setting);
  const track = featureTracks[name];
  if (!track) throw new Error(name);
  const out = [];
  for (let t = 0; t < seconds * 1000; t += FRAME)
    out.push({ t, f: track.sample(t, FRAME), s: r.step(track.sample(t, FRAME), FRAME, KEY) });
  return out;
}

describe('rings (§4.3, VIS-06)', () => {
  it.each(['subtle', 'balanced', 'expressive'] as const)(
    '%s: never more than its cap alive, I₀ within the cap',
    (setting) => {
      const r = createReverb(setting);
      for (let i = 0; i < 600; i++) {
        const s = r.step(feat({ onset: i % 3 === 0 ? 1 : 0 }), FRAME, KEY);
        expect(s.rings.length).toBeLessThanOrEqual(SETTINGS[setting].rings);
        for (const ring of s.rings)
          expect(ring.i0).toBeLessThanOrEqual(SETTINGS[setting].i0Cap + 1e-9);
      }
    },
  );

  it('the spawn threshold follows the setting; calm passages need ≥ 0.5', () => {
    const spawns = (setting: 'balanced' | 'expressive', onset: number, intensity = 0.6) =>
      createReverb(setting).step(feat({ onset, intensity }), FRAME, KEY).rings.length;
    expect(spawns('expressive', 0.3)).toBe(1);
    expect(spawns('balanced', 0.3)).toBe(0);
    expect(spawns('expressive', 0.45, 0.1)).toBe(0);
    expect(spawns('expressive', 0.6, 0.1)).toBe(1);
  });

  it('rings grow at 0.55 H/s and fade with τ = 0.45 + 0.6·(1 − intensity)', () => {
    const r = createReverb('balanced');
    r.step(feat({ onset: 1, intensity: 0.5 }), FRAME, KEY);
    let s = r.step(feat({ intensity: 0.5 }), 0, KEY);
    for (let i = 0; i < 60; i++) s = r.step(feat({ intensity: 0.5 }), FRAME, KEY);
    const ring = s.rings[0];
    expect(ring?.tau).toBeCloseTo(0.75, 9);
    expect(s.ringRadius(ring as never)).toBeCloseTo(0.55 * (ring?.age ?? 0), 9);
    expect(ring?.age).toBeCloseTo(1, 1);
  });
});

describe('breathing and the intensity setting (§4.5, §7.4, VIS-10)', () => {
  it.each(['subtle', 'balanced', 'expressive'] as const)(
    '%s: exposure stays within ±its maximum',
    (setting) => {
      for (const { s } of play('techno', 20, setting)) {
        expect(s.exposure).toBeLessThanOrEqual(1 + SETTINGS[setting].breathe + 1e-9);
        expect(s.exposure).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    },
  );

  it('expressive is the default and breathes most; calm passages breathe ±3% at most', () => {
    const r = createReverb();
    let s = r.step(feat({ bass: 1, intensity: 0.1 }), FRAME, KEY);
    for (let i = 0; i < 300; i++) s = r.step(feat({ bass: 1, intensity: 0.1 }), FRAME, KEY);
    expect(s.exposure).toBeLessThanOrEqual(1.03 + 1e-9);
    const loud = createReverb();
    for (let i = 0; i < 300; i++) s = loud.step(feat({ bass: 1, intensity: 1 }), FRAME, KEY);
    expect(s.exposure).toBeCloseTo(1.15, 2);
  });

  it('without features: no rings, no breathing, constant ambient-like flow', () => {
    const r = createReverb();
    const s = r.step({ ...SILENT_FEATURES.sample(0, 0), onset: 1 }, FRAME, KEY);
    expect(s.rings).toEqual([]);
    expect(s.exposure).toBe(1);
  });
});

describe('the photosensitivity limit (§7.3, A11Y-08 model)', () => {
  it.each(['techno', 'pop', 'ballad'])(
    '%s at expressive: luminance-driving terms change ≤ 0.24/s combined',
    (name) => {
      const frames = play(name, 20, 'expressive');
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1]?.s;
        const b = frames[i]?.s;
        if (!a || !b) continue;
        const rings = (x: typeof a) => x.rings.reduce((sum, r) => sum + ringLight(r), 0);
        // Rises of ring and flare light, and exposure either way (falls are softened downstream).
        const change =
          Math.abs(b.exposure - a.exposure) +
          Math.max(0, rings(b) - rings(a)) +
          Math.max(0, b.flare - a.flare);
        expect(change).toBeLessThanOrEqual(LUMA_SLEW_PER_S * (FRAME / 1000) + 1e-9);
      }
    },
  );

  it('ring and flare tints are never saturated red', () => {
    for (const c of [
      [1, 0, 0],
      [0.9, 0.1, 0.05],
      [0.5, 0.4, 0.3],
    ] as [number, number, number][]) {
      const [r, g, b] = safeTint(c);
      expect(r / (r + g + b)).toBeLessThan(0.8);
    }
    expect(safeTint([0.2, 0.5, 0.9])).toEqual([0.2, 0.5, 0.9]);
  });
});
