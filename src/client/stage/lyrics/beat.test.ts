import { describe, expect, it } from 'vitest';
import type { Features, LyricsDoc } from '../../../shared/types.ts';
import { featureTracks } from '../../fixtures/feature-tracks.ts';
import { lyricFixtures } from '../../fixtures/lyrics.ts';
import { SILENT_FEATURES } from '../../playback/features.ts';
import * as BG from './background.ts';
import { Beat, type BeatInput, type BeatTerms, glowFor, UNIT_KICK, vocalAt } from './beat.ts';
import { LYRICS } from './lyricsConfig.ts';
import { FieldModel, type LineBox } from './model.ts';
import { SPRINGS, spring, step } from './springs.ts';
import { buildTimeline, scaleAt } from './timing.ts';

// The music-reactive terms (LYRICS_EXPERIENCE.md §12) on the hand-authored Features tracks, and
// the readability caps of §12.4 on whole-song frame simulations.

const B = LYRICS.beat;
const FRAME = 1000 / 60;
const track = (name: string) => featureTracks[name] as NonNullable<(typeof featureTracks)[string]>;

/** Runs a Beat over `name` from 0 to `ms`; one result per frame. */
function play(
  name: string,
  ms: number,
  over: Partial<BeatInput> & { hz?: number; setting?: 'subtle' | 'balanced' | 'expressive' } = {},
) {
  const b = new Beat(over.setting);
  const dt = 1000 / (over.hz ?? 60);
  const out: (BeatTerms & { t: number; f: Features })[] = [];
  for (let t = 0; t <= ms; t += dt) {
    const f = track(name).sample(t, dt);
    out.push({
      ...b.update({
        features: f,
        dt,
        sinceHandover: 10_000,
        vocal: 0,
        mode: 'run',
        reduced: false,
        ...over,
      }),
      t,
      f,
    });
  }
  return out;
}

const max = (xs: number[]) => Math.max(...xs);

describe('motion gain and availability (§12.2)', () => {
  it('g = 0.35 + 0.65·intensity; unavailable: g 0.6 and every beat term 0', () => {
    for (const r of play('pop', 40_000)) expect(r.g).toBeCloseTo(0.35 + 0.65 * r.f.intensity, 9);
    const b = new Beat();
    for (let k = 0; k < 600; k++) {
      const r = b.update({
        features: SILENT_FEATURES.sample(0, FRAME),
        dt: FRAME,
        sinceHandover: 10_000,
        vocal: 1, // even with a held word: no mid, no sustain
        mode: 'run',
        reduced: false,
      });
      expect(r.g).toBe(0.6);
      expect([r.pulse, r.lean, ...r.kick, r.glowAdd]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(r.speed).toBe(1);
      expect(r.breathe).toBe(1);
      expect(r.drift).toBe(LYRICS.zone.drift);
    }
  });

  it('a unit kick peaks the impulse spring at 1', () => {
    const s = spring(0);
    s.v = UNIT_KICK;
    let peak = 0;
    for (let k = 0; k < 600; k++) peak = Math.max(peak, step(s, 0, SPRINGS.impulse, 1).x);
    expect(peak).toBeCloseTo(1, 3);
  });
});

describe('the caps (§12.3, §12.4)', () => {
  it.each(['ballad', 'pop', 'techno'])(
    '%s: pulse ≤ 1.5%%, lean ≤ 0.025, kicks ≤ 2 px at the strongest setting, and all of them felt',
    (name) => {
      const rs = play(name, 64_000);
      expect(max(rs.map((r) => Math.abs(r.pulse)))).toBeLessThanOrEqual(B.scaleCap);
      expect(max(rs.map((r) => r.lean))).toBeLessThanOrEqual(B.zLean);
      expect(Math.min(...rs.map((r) => r.lean))).toBeGreaterThanOrEqual(0);
      const kicks = rs.flatMap((r) => r.kick.map(Math.abs));
      expect(max(kicks)).toBeLessThanOrEqual(B.kickPx);
      // Not inert: even the ballad's soft kick shows, and techno reaches the caps' neighbourhood.
      expect(max(rs.map((r) => r.pulse))).toBeGreaterThan(name === 'ballad' ? 0.001 : 0.004);
      expect(max(rs.map((r) => r.lean))).toBeGreaterThan(0.002);
      if (name !== 'ballad') expect(max(kicks)).toBeGreaterThan(0.5); // the ballad has no snare
    },
  );

  it('nothing at all for 300 ms after a hand-over, then in over 100 ms', () => {
    for (const since of [0, 150, 299]) {
      const rs = play('techno', 4000, { sinceHandover: since });
      expect(max(rs.map((r) => Math.abs(r.pulse) + r.lean + max(r.kick.map(Math.abs))))).toBe(0);
    }
    const ramp = play('techno', 4000, { sinceHandover: 350 });
    const full = play('techno', 4000);
    expect(max(ramp.map((r) => r.lean))).toBeCloseTo(max(full.map((r) => r.lean)) / 2, 3);
  });

  it('the bass pulse per unit of bass impulse is the same at 30, 60 and 144 Hz (force × dt)', () => {
    // The fixture's 10 ms attack and 40 ms release alias differently at each rate, so the input
    // integral changes too; Beat must follow that integral, not the frame rate.
    const gain = (hz: number) => {
      const rs = play('pop', 8000, { hz });
      const input = rs.reduce((a, r) => a + r.f.bassImpulse * (1000 / hz), 0);
      return max(rs.map((r) => r.pulse)) / input;
    };
    const g60 = gain(60);
    expect(Math.abs(gain(30) - g60) / g60).toBeLessThan(0.02);
    expect(Math.abs(gain(144) - g60) / g60).toBeLessThan(0.02);
  });

  it('percussion kicks rotate over the three buckets, one spring each', () => {
    const rs = play('pop', 4000);
    for (let k = 0; k < 3; k++)
      expect(max(rs.map((r) => Math.abs(r.kick[k] as number)))).toBeGreaterThan(0.3);
  });

  it('the setting scales background kicks and drift speed changes, nothing on the zone', () => {
    const at = (s: 'subtle' | 'balanced' | 'expressive') => play('techno', 8000, { setting: s });
    const [sub, bal, exp] = [at('subtle'), at('balanced'), at('expressive')];
    const k = (rs: typeof sub) => max(rs.flatMap((r) => r.kick.map(Math.abs)));
    expect(k(sub)).toBeLessThan(k(bal));
    expect(k(bal)).toBeLessThan(k(exp));
    expect(sub.map((r) => r.pulse)).toEqual(exp.map((r) => r.pulse));
    expect(sub.map((r) => r.lean)).toEqual(exp.map((r) => r.lean));
    expect((sub.at(-1) as BeatTerms).speed).toBeCloseTo(1 + 0.5 * 0.4, 6);
    expect((bal.at(-1) as BeatTerms).speed).toBeCloseTo(1.4, 6);
    expect((exp.at(-1) as BeatTerms).speed).toBeCloseTo(1 + 1.5 * 0.4, 6);
  });

  it('reduced motion: no beat response on text, glow constant at 0.35', () => {
    for (const r of play('techno', 8000, { reduced: true, vocal: 1 })) {
      expect([r.pulse, r.lean, ...r.kick, r.sustain, r.glowAdd]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(glowFor(r.sustain, r.glowAdd).alpha).toBe(LYRICS.glow.alpha);
    }
  });

  it('a still frame has no transients and depends only on its own features', () => {
    const b = new Beat();
    const f = track('techno').sample(5000, 0);
    const r = b.update({
      features: f,
      dt: 0,
      sinceHandover: 10_000,
      vocal: 0.5,
      mode: 'still',
      reduced: false,
    });
    expect([r.pulse, ...r.kick]).toEqual([0, 0, 0, 0]);
    expect(r.sustain).toBe(0.5);
    expect(r.glowAdd).toBe(B.intenseGlow);
    expect(
      new Beat().update({
        features: f,
        dt: 0,
        sinceHandover: 10_000,
        vocal: 0.5,
        mode: 'still',
        reduced: false,
      }),
    ).toEqual(r);
  });
});

describe('sustained vocals and passages (§12.3)', () => {
  it('sustain = smoothstep(0.6 s, 1.5 s, word elapsed)·mid; line-timed: mid while active', () => {
    const words = [{ start: 1000, end: 4000 }];
    expect(vocalAt(words, true, 0.8, 1500)).toBe(0);
    expect(vocalAt(words, true, 0.8, 2050)).toBeCloseTo(0.4, 6);
    expect(vocalAt(words, true, 0.8, 3000)).toBe(0.8);
    expect(vocalAt(words, true, 0.8, 4000)).toBe(0); // between words
    expect(vocalAt(undefined, true, 0.7, 0)).toBe(0.7);
    expect(vocalAt(undefined, false, 0.7, 0)).toBe(0);
  });

  it('attack 120 ms, release 400 ms; glow 0.35 → 0.55 alpha and 0.18 → 0.26 em', () => {
    const b = new Beat();
    const f = { ...track('ballad').sample(0, FRAME) };
    const go = (vocal: number, ms: number) => {
      let r: BeatTerms | null = null;
      for (let t = 0; t < ms; t += FRAME)
        r = b.update({
          features: f,
          dt: FRAME,
          sinceHandover: 10_000,
          vocal,
          mode: 'run',
          reduced: false,
        });
      return (r as BeatTerms).sustain;
    };
    expect(go(1, 120)).toBeCloseTo(1 - Math.exp(-1), 1);
    expect(go(1, 2000)).toBeCloseTo(1, 3);
    expect(go(0, 400)).toBeCloseTo(Math.exp(-1), 1);
    expect(glowFor(0, 0)).toEqual({ alpha: 0.35, radius: 0.18 });
    expect(glowFor(1, 0).alpha).toBeCloseTo(0.55, 9);
    expect(glowFor(1, 0).radius).toBeCloseTo(0.26, 9);
    expect(glowFor(1, B.intenseGlow).alpha).toBe(LYRICS.glow.alphaMax); // capped
  });

  it('quiet passage after 4 s below 0.2: drift ×0.6 (×setting) and breathing halved, over 2 s', () => {
    const rs = play('ballad', 30_000, { setting: 'balanced' });
    const firstQuiet = rs.findIndex((r) => r.breathe < 1);
    const below = rs.findIndex((r) => r.f.intensity < B.quietBelow);
    expect(below).toBe(0);
    expect((rs[firstQuiet] as { t: number }).t).toBeGreaterThanOrEqual(B.quietForMs - 1e-6);
    const settled = rs.find((r) => r.t >= B.quietForMs + B.passageMs + FRAME) as BeatTerms;
    expect(settled.breathe).toBeCloseTo(0.5, 6);
    expect(settled.speed).toBeCloseTo(0.6, 6);
  });

  it('intense passage (> 0.75): drift ×1.4, approach drift 0.38, glow +0.05, over 2 s', () => {
    const rs = play('pop', 40_000, { setting: 'balanced' });
    const verse = rs.find((r) => r.t > 20_000) as BeatTerms;
    expect([verse.speed, verse.drift, verse.glowAdd]).toEqual([1, LYRICS.zone.drift, 0]);
    const mid = rs.find((r) => r.t >= 33_000) as BeatTerms; // 1 s into the chorus
    expect(mid.drift).toBeCloseTo((0.3 + 0.38) / 2, 2);
    const chorus = rs.find((r) => r.t >= 34_100) as BeatTerms;
    expect([chorus.speed, chorus.drift, chorus.glowAdd].map((x) => +x.toFixed(6))).toEqual([
      1.4, 0.38, 0.05,
    ]);
  });
});

// ---- on the whole field ----

const W = 1440;
const H = 812;
const FONT = 56;
const ROW = FONT * 1.12;

function field(name: string, drift?: number) {
  const doc = lyricFixtures[name] as LyricsDoc;
  const tl = buildTimeline(doc);
  const boxes: LineBox[] = tl.lines.map((l) => {
    const raw = l.text.length * 0.5 * FONT;
    return { w: Math.min(raw, 0.64 * W), h: Math.ceil(raw / (0.64 * W)) * ROW, side: 'centre' };
  });
  return new FieldModel(tl, boxes, { seed: BG.hash(doc.trackKey), budget: 24, dotsH: ROW, drift });
}

describe('beats on the field (LYR-02, §12.4)', () => {
  it.each([
    ['rap-word', 'techno'],
    ['pop-line', 'pop'],
  ])(
    '%s: the zone keeps its place and opacity; only scale responds, within the caps',
    (name, ft) => {
      // A fixed approach drift: the intense passage's drift change is its own term, not a beat's.
      const quiet = field(name, LYRICS.zone.drift);
      const loud = field(name, LYRICS.zone.drift);
      let pulsed = 0;
      let leaned = 0;
      const fromBg = new Set<number>();
      for (let t = 0; t < 90_000; t += FRAME) {
        const base = { t, dt: FRAME, driftS: t / 1000, playing: true, mode: 'run' as const, W, H };
        // The same passage terms (intensity, mid) on both; the quiet field has no bass and no hits.
        const f = track(ft).sample(t, FRAME);
        quiet.update({ ...base, features: { ...f, sub: 0, bass: 0, onset: 0, bassImpulse: 0 } });
        loud.update({ ...base, features: f });
        for (const [i, v] of loud.insts) {
          if (v.role !== 'zone') continue;
          const u = quiet.insts.get(i);
          if (!u) continue;
          // Opacity and luminance are never beat-driven; nor is the active line's position.
          // A line that came in from the background carries the background's kick-moved place and
          // opacity into its springs, so only lines built in the zone are compared exactly.
          if (v.enter || u.enter) fromBg.add(i);
          if (!fromBg.has(i)) {
            expect(v.opacity).toBeCloseTo(u.opacity, 9);
            expect(v.z.x).toBeCloseTo(u.z.x, 9);
            expect(v.mix).toBeCloseTo(u.mix, 9);
          }
          if (v.rank === 0) {
            expect(Math.abs(v.y.x - u.y.x)).toBeLessThanOrEqual(2);
            expect(Math.abs(v.x.x - u.x.x)).toBeLessThanOrEqual(2);
            const k = v.scale / scaleAt(v.z.x) - 1;
            expect(Math.abs(k)).toBeLessThanOrEqual(B.scaleCap + 1e-9);
            if (k > 0.002) pulsed++;
          } else {
            expect(v.scale).toBeGreaterThanOrEqual(scaleAt(v.z.x) - 1e-9);
            expect(v.scale).toBeLessThanOrEqual(scaleAt(v.z.x - B.zLean) + 1e-9);
            if (v.scale > scaleAt(v.z.x) + 1e-4) leaned++;
          }
        }
      }
      expect(pulsed).toBeGreaterThan(100);
      expect(leaned).toBeGreaterThan(100);
    },
  );

  it('rap-word on techno: no pulse in the first 300 ms after any hand-over', () => {
    const m = field('rap-word');
    let checked = 0;
    let lastActive = -2;
    let handAt = 0;
    for (let t = 0; t < 60_000; t += FRAME) {
      m.update({
        t,
        dt: FRAME,
        driftS: t / 1000,
        playing: true,
        mode: 'run',
        W,
        H,
        features: track('techno').sample(t, FRAME),
      });
      const a = [...m.insts.values()].find((v) => v.role === 'zone' && v.rank === 0);
      if ((a?.i ?? -1) !== lastActive) {
        lastActive = a?.i ?? -1;
        handAt = t;
      }
      if (a && t - handAt < B.quietMs - 2 * FRAME) {
        expect(Math.abs(m.beat?.pulse ?? 1)).toBe(0);
        expect(Math.abs(m.beat?.lean ?? 1)).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('ballad-word: a held word glows brighter and wider than 0.35 / 0.18 em, never above 0.55', {
    timeout: 20_000,
  }, () => {
    const m = field('ballad-word');
    let brighter = 0;
    for (let t = 0; t < 120_000; t += FRAME) {
      m.update({
        t,
        dt: FRAME,
        driftS: t / 1000,
        playing: true,
        mode: 'run',
        W,
        H,
        features: track('ballad').sample(t, FRAME),
      });
      for (const v of m.insts.values())
        for (const a of v.glow) {
          expect(a).toBeLessThanOrEqual(LYRICS.glow.alphaMax + 1e-9);
          if (a > LYRICS.glow.alpha + 0.02) {
            brighter++;
            expect(v.glowR).toBeGreaterThan(LYRICS.glow.radius);
          }
        }
    }
    expect(brighter).toBeGreaterThan(30);
  });
});
