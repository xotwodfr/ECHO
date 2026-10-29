import { describe, expect, it } from 'vitest';
import type { FeatureSource, LyricLine, LyricsDoc } from '../../../shared/types.ts';
import { featureTracks } from '../../fixtures/feature-tracks.ts';
import { guideFeatures } from '../../fixtures/guide.ts';
import { lyricFixtures } from '../../fixtures/lyrics.ts';
import { sidesOf } from './layout.ts';
import { LYRICS } from './lyricsConfig.ts';
import {
  blurAt,
  FieldModel,
  type FrameInput,
  type Inst,
  type LineBox,
  lineEdges,
  opacityAt,
  wordMotion,
} from './model.ts';
import { SPRINGS } from './springs.ts';
import { buildTimeline, type Timeline } from './timing.ts';

// Frame simulations of the lyric field (LYRICS_EXPERIENCE.md §4–§9) at 1440×900 (H = 812), with
// nominal boxes: 56 px type, 0.5 em per character, wrapped at 0.64 W. The browser's measured boxes
// are checked in e2e (lyrics.spec.ts).

const W = 1440;
const H = 812;
const FONT = 56;
const ROW = FONT * 1.12;
const Y0 = 0.4 * H;
const GAP = LYRICS.column.gap * ROW;
const FRAME = 1000 / 60;
const fx = (name: string) => lyricFixtures[name] as LyricsDoc;

function boxesOf(doc: LyricsDoc, tl: Timeline): LineBox[] {
  const side = sidesOf(doc);
  return tl.lines.map((l: LyricLine) => {
    const raw = l.text.length * 0.5 * FONT;
    const rows = Math.ceil(raw / (0.64 * W));
    return { w: Math.min(raw, 0.64 * W), h: rows * ROW, side: side(l) };
  });
}

const tracks = new WeakMap<FieldModel, FeatureSource>();

/** A model of fixture `name`, which `run` plays with its paired Features track (guide.ts). */
function model(name: string) {
  const doc = fx(name);
  const tl = buildTimeline(doc);
  const m = new FieldModel(tl, boxesOf(doc, tl), { dotsH: ROW });
  const track = featureTracks[guideFeatures[name] ?? ''];
  if (track) tracks.set(m, track);
  return m;
}

interface Snap {
  t: number;
  inst: Map<
    number,
    Pick<Inst, 'role' | 'rank' | 'opacity' | 'blur' | 'scale'> & {
      x: number;
      y: number;
      z: number;
      ty: number;
      tz: number;
      p: number[];
      glow: number[];
    }
  >;
  dots: number;
}

/** Runs `m` at `hz` from `from` to `to` (song ms), playing; one snapshot per frame. */
function run(m: FieldModel, from: number, to: number, opts: Partial<FrameInput> = {}, hz = 60) {
  const out: Snap[] = [];
  const dt = 1000 / hz;
  for (let t = from; t <= to; t += dt) {
    const features = tracks.get(m)?.sample(t, dt);
    m.update({ t, dt, playing: true, mode: 'run', W, H, features, ...opts });
    out.push(snapshot(m, t));
  }
  return out;
}

function snapshot(m: FieldModel, t: number): Snap {
  const inst = new Map<number, Snap['inst'] extends Map<number, infer V> ? V : never>();
  for (const [i, x] of m.insts)
    inst.set(i, {
      role: x.role,
      rank: x.rank,
      opacity: x.opacity,
      blur: x.blur,
      scale: x.scale,
      x: x.x.x,
      y: x.y.x,
      z: x.z.x,
      ty: x.ty,
      tz: x.tz,
      p: [...x.p],
      glow: [...x.glow],
    });
  return { t, inst, dots: m.dots.opacity };
}

describe('the active line (LYR-02)', () => {
  it.each(['ballad-word', 'rap-word', 'pop-line', 'accents-word'])(
    '%s: settled at 0.40 H ± 2 px, and still while active',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 120_000);
      let since = new Map<number, number>();
      let checked = 0;
      for (const s of snaps) {
        const next = new Map<number, number>();
        for (const [i, v] of s.inst)
          if (v.role === 'zone' && v.rank === 0) next.set(i, since.get(i) ?? s.t);
        since = next;
        for (const [i, from] of since) {
          if (s.t - from < 800) continue; // still arriving: 2 px of a slow hand-over (ζ 1) ≤ 0.8 s
          const v = s.inst.get(i);
          expect(Math.abs((v?.y ?? 0) - Y0)).toBeLessThanOrEqual(2);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(500);
    },
  );
});

type SnapLine = Snap['inst'] extends Map<number, infer V> ? V : never;

describe('the column (LYR-03)', () => {
  it.each(['ballad-word', 'pop-line', 'duet-word', 'long-lines', 'intro-outro'])(
    '%s: each line one gap below the one before, on the column edge, dimmer and blurrier with distance',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 110_000);
      const box = (i: number) => m.boxes[i] as LineBox;
      let checked = 0;
      for (const s of snaps) {
        const ls = [...s.inst].sort(([a], [b]) => a - b);
        // Settled frames only: a hand-over's springs carry every line a little behind its target.
        if (ls.length < 3 || ls.some(([, v]) => Math.abs(v.y - v.ty) > 0.25)) continue;
        for (let k = 1; k < ls.length; k++) {
          const [i, v] = ls[k] as [number, SnapLine];
          const [j, u] = ls[k - 1] as [number, SnapLine];
          expect(i).toBe(j + 1); // the column skips no line
          const gap = v.y - box(i).h / 2 - (u.y + box(j).h / 2);
          // One gap, or the dots' empty slot between the last sung line and the next one.
          const dots = u.rank < 0 && v.rank > 0;
          expect(Math.abs(gap - (dots ? 2 * GAP + ROW : GAP))).toBeLessThan(0.5);
        }
        for (const [i, v] of ls) {
          const b = box(i);
          if (b.side === 'right')
            expect(v.x + b.w / 2).toBeCloseTo(((1 + LYRICS.maxWidth) / 2) * W, 6);
          else expect(v.x - b.w / 2).toBeCloseTo(((1 - LYRICS.maxWidth) / 2) * W, 6);
          expect(v.tz).toBeCloseTo(Math.min(1, Math.abs(v.rank) * LYRICS.column.dz), 9);
          expect(v.blur).toBeCloseTo(blurAt(v.z), 9);
          expect(v.opacity).toBeLessThanOrEqual(opacityAt(v.z) + 1e-9); // and fading in when new
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(300);
    },
  );

  it.each(['ballad-word', 'rap-word', 'duet-word', 'pop-line', 'intro-outro', 'long-lines'])(
    '%s: scrolls without two lines ever overlapping, lines entering included',
    (name) => {
      const m = model(name);
      let checked = 0;
      for (let t = 0; t < 160_000; t += FRAME) {
        m.update({ t, dt: FRAME, playing: true, mode: 'run', W, H });
        const ls = [...m.insts.values()].sort((a, b) => a.i - b.i);
        for (let k = 1; k < ls.length; k++) {
          const [u, v] = [ls[k - 1], ls[k]] as [Inst, Inst];
          const bottom = u.y.x + (m.boxes[u.i] as LineBox).h / 2;
          expect(v.y.x - (m.boxes[v.i] as LineBox).h / 2).toBeGreaterThan(bottom);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10_000);
    },
  );

  it('dims and blurs with distance, the active line clear and whole', () => {
    expect([opacityAt(0), blurAt(0)]).toEqual([1, 0]);
    for (let z = 0; z < 1; z += 0.01) {
      expect(opacityAt(z + 0.01)).toBeLessThanOrEqual(opacityAt(z));
      expect(blurAt(z + 0.01)).toBeGreaterThanOrEqual(blurAt(z));
    }
  });

  it('ballad: mid-song the column runs past both ends of the stage, sung lines above', () => {
    const m = model('ballad-word');
    const s = run(m, 0, 60_000).at(-1) as Snap;
    const box = (i: number) => m.boxes[i] as LineBox;
    const top = Math.min(...[...s.inst].map(([i, v]) => v.y - box(i).h / 2));
    const bottom = Math.max(...[...s.inst].map(([i, v]) => v.y + box(i).h / 2));
    expect(top).toBeLessThan(0);
    expect(bottom).toBeGreaterThan(H);
    const past = [...s.inst.values()].filter((v) => v.role === 'past');
    expect(past.length).toBeGreaterThanOrEqual(3);
    for (const v of past) expect(v.y).toBeLessThan(Y0);
  });
});

describe('hand-over (LYR-06, §6.3)', () => {
  it.each(['ballad-word', 'rap-word', 'duet-word', 'pop-line', 'intro-outro', 'cjk-word'])(
    '%s: no visible line jumps more than 0.08 H between frames',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 160_000);
      let worst = 0;
      for (let k = 1; k < snaps.length; k++) {
        const a = snaps[k - 1] as Snap;
        const b = snaps[k] as Snap;
        for (const [i, v] of b.inst) {
          const u = a.inst.get(i);
          if (!u || (u.opacity < 0.01 && v.opacity < 0.01)) continue; // not rendered
          worst = Math.max(worst, Math.hypot(v.x - u.x, v.y - u.y));
        }
      }
      expect(worst).toBeLessThan(0.08 * H);
    },
  );

  it.each([30, 60, 144])('%i Hz: the same motion as 1 kHz (closed-form springs)', (hz) => {
    const ref = run(model('ballad-word'), 9000, 12_000, {}, 1000);
    const got = run(model('ballad-word'), 9000, 12_000, {}, hz);
    const last = got.at(-1) as Snap;
    const want = ref.find((s) => Math.abs(s.t - last.t) < 0.5) as Snap;
    for (const [i, v] of last.inst) {
      const r = want.inst.get(i);
      if (!r) continue;
      expect(v.y).toBeCloseTo(r.y, 0);
    }
  });

  it('staggers new targets: the new active at once, +1 50 ms later, +3 ≈ 143 ms later', () => {
    const m = model('ballad-word');
    const h = m.tl.handovers[3] as number; // line 3 takes the anchor
    run(m, h - 2000, h - 1);
    const ty = (i: number) => (m.insts.get(i) as Inst).ty;
    const [t3, t4, t6] = [ty(3), ty(4), ty(6)];
    let t = h - 1;
    const step = (ms: number) => {
      t += ms;
      m.update({ t, dt: ms, playing: true, mode: 'run', W, H });
    };
    step(2);
    expect(ty(3)).not.toBe(t3);
    expect(ty(4)).toBe(t4);
    expect((m.insts.get(6) as Inst).role).toBe('zone');
    step(40);
    expect(ty(4)).toBe(t4);
    step(12);
    expect(ty(4)).not.toBe(t4);
    expect(ty(6)).toBe(t6);
    step(95);
    expect(ty(6)).not.toBe(t6);
  });
});

describe('word sweep and glow (LYR-07, LYR-08)', () => {
  it.each(['ballad-word', 'rap-word', 'accents-word', 'cjk-word'])(
    '%s: --p follows time inside the word; before lit, after unlit',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 90_000);
      let inside = 0;
      for (const s of snaps)
        for (const [i, v] of s.inst) {
          if (v.rank !== 0 || v.role !== 'zone') continue;
          const words = (m.tl.lines[i] as LyricLine).words ?? [];
          words.forEach((w, k) => {
            const p = v.p[k] as number;
            if (s.t <= w.start) expect(p).toBe(0);
            else if (s.t >= w.end) expect(p).toBe(1);
            else {
              const want = (s.t - w.start) / Math.max(60, w.end - w.start);
              expect(Math.abs(p - Math.min(1, want))).toBeLessThanOrEqual(0.01);
              inside++;
            }
          });
        }
      expect(inside).toBeGreaterThan(200);
    },
  );

  it.each(['ballad-word', 'rap-word', 'duet-word'])(
    '%s: glow only on the sweeping word and the one fading after it, within the caps',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 90_000);
      let lit = 0;
      let prev = new Map<number, number[]>();
      for (const s of snaps) {
        const next = new Map<number, number[]>();
        for (const [i, v] of s.inst) {
          next.set(i, v.glow);
          const glowing = v.glow.map((a, k) => [a, k] as const).filter(([a]) => a > 0);
          // A line that has just left the anchor keeps only the tail of its last glow, fading.
          if (v.rank !== 0 && v.rank !== 1)
            for (const [a, k] of glowing) expect(a).toBeLessThan(prev.get(i)?.[k] ?? 0);
          expect(glowing.length).toBeLessThanOrEqual(2);
          const words = (m.tl.lines[i] as LyricLine).words ?? [];
          const sweeping = words.findIndex((w) => s.t >= w.start && s.t < w.end);
          for (const [a, k] of glowing) {
            // Sustained vocals raise it to 0.55 at most (§12.3; beat.test.ts).
            expect(a).toBeLessThanOrEqual(LYRICS.glow.alphaMax + 1e-9);
            // The sweeping word, or an earlier one whose glow is decaying.
            expect(sweeping < 0 || k <= sweeping).toBe(true);
            if (k === sweeping) lit++;
          }
        }
        prev = next;
      }
      expect(lit).toBeGreaterThan(100);
    },
  );

  it('glow alpha changes no faster than 1.5/s (§12.5)', () => {
    for (const name of ['ballad-word', 'rap-word']) {
      const snaps = run(model(name), 0, 60_000);
      let worst = 0;
      for (let k = 1; k < snaps.length; k++)
        for (const [i, v] of (snaps[k] as Snap).inst) {
          const u = (snaps[k - 1] as Snap).inst.get(i);
          if (!u) continue;
          for (const [w, a] of v.glow.entries())
            worst = Math.max(worst, Math.abs(a - (u.glow[w] ?? 0)));
        }
      expect(worst).toBeLessThanOrEqual(1.5 * (FRAME / 1000) + 1e-9);
      expect(worst).toBeGreaterThan(0.02); // the limit is what shapes the rise
    }
  });

  it('pause dims the glow to 60% over 600 ms; resume restores it within 300 ms (LYR-17)', () => {
    const m = model('ballad-word');
    const w = m.tl.lines.flatMap((l) => l.words ?? []).find((x) => x.end - x.start >= 1400);
    if (!w) throw new Error('fixture');
    const t = w.start + 600;
    run(m, t - 1500, t);
    const i = [...m.insts.values()].find((v) => v.rank === 0)?.i as number;
    const glowOf = () => Math.max(...(m.insts.get(i) as Inst).glow);
    expect(glowOf()).toBeCloseTo(LYRICS.glow.alpha, 2);
    for (let k = 0; k < 36; k++) m.update({ t, dt: FRAME, playing: false, mode: 'run', W, H });
    expect(glowOf()).toBeCloseTo(LYRICS.glow.alpha * 0.6, 2);
    for (let k = 0; k < 18; k++)
      m.update({ t: t + k * FRAME, dt: FRAME, playing: true, mode: 'run', W, H });
    expect(glowOf()).toBeCloseTo(LYRICS.glow.alpha, 2);
  });
});

describe('past lines (LYR-10)', () => {
  it.each(['ballad-word', 'rap-word', 'pop-line'])(
    '%s: sung lines stay above, their lit colour dying into ink by e^(−Δt/520 ms)',
    (name) => {
      const m = model(name);
      let checked = 0;
      for (let t = 20_000; t < 100_000; t += FRAME) {
        m.update({ t, dt: FRAME, playing: true, mode: 'run', W, H });
        for (const v of m.insts.values()) {
          if (v.role !== 'past') continue;
          const dt = t - (m.leftAt[v.i] as number);
          expect(dt).toBeGreaterThanOrEqual(0);
          expect(v.fade).toBeCloseTo(1 - Math.exp(-dt / LYRICS.decay.tauMs), 9);
          expect(v.rank).toBeLessThan(0);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    },
  );
});

describe('pacing (LYR-20, LYR-21)', () => {
  it('rap: no line is shown active for less than 350 ms, and coalesced lines still sweep', () => {
    const m = model('rap-word');
    expect(m.tl.coalesced.length).toBeGreaterThan(0);
    const snaps = run(m, 0, 170_000);
    const dwell = new Map<number, number>();
    for (const s of snaps)
      for (const [i, v] of s.inst)
        if (v.role === 'zone' && v.rank === 0) dwell.set(i, (dwell.get(i) ?? 0) + FRAME);
    for (const [, ms] of dwell) expect(ms).toBeGreaterThanOrEqual(350 - FRAME);
    for (const c of m.tl.coalesced) {
      expect(dwell.has(c)).toBe(false);
      const words = (m.tl.lines[c] as LyricLine).words ?? [];
      for (const w of words) {
        const s = snaps[Math.round((w.start + w.end) / 2 / FRAME)] as Snap;
        const v = s.inst.get(c);
        const p = v?.p[words.indexOf(w)] ?? -1;
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it.each(['intro-outro', 'ballad-word'])(
    '%s: dots only in gaps of 7 s or more, gone by 250 ms before the hand-over',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 200_000);
      const tl = m.tl;
      const gaps = tl.spans.filter((s) => s.dotsUntil > -Infinity);
      expect(gaps.length).toBeGreaterThan(0);
      for (const s of snaps) {
        const gap = gaps.find((g) => s.t >= g.from && s.t < (tl.handovers[g.next] ?? Infinity));
        if (!gap) expect(s.dots).toBe(0);
        else {
          const h = tl.handovers[gap.next] as number;
          if (s.t >= h - LYRICS.interlude.leaveMs + LYRICS.interlude.fadeMs) expect(s.dots).toBe(0);
          if (s.t > gap.from + 750 && s.t < gap.dotsUntil) expect(s.dots).toBe(1);
        }
      }
    },
  );
});

describe('seek, scrub and still frames (§9.6, §10 of VISUALIZER_SPEC)', () => {
  it('a seek: slow spring, no stagger; old past lines fade out in 160 ms', () => {
    const m = model('ballad-word');
    run(m, 40_000, 45_000);
    const old = [...m.insts].filter(([, v]) => v.role === 'past').map(([i]) => i);
    expect(old.length).toBeGreaterThan(0);
    m.update({ t: 90_000, dt: FRAME, playing: true, mode: 'run', W, H });
    for (const v of m.insts.values()) expect(v.delay).toBe(0);
    expect(m.leaving.map((x) => x.i)).toEqual(expect.arrayContaining(old));
    for (const v of m.insts.values()) expect(v.params).toBe(SPRINGS.slow);
    const fading = m.leaving.filter((x) => old.includes(x.i));
    const from = fading.map((x) => x.opacity);
    let t = 90_000;
    for (let k = 0; k < 10; k++) {
      t += FRAME;
      m.update({ t, dt: FRAME, playing: true, mode: 'run', W, H });
    }
    expect(m.leaving.filter((x) => old.includes(x.i))).toEqual([]);
    // They faded on the way out: ~1/10 of the 160 ms left after 9 of 10 frames.
    fading.forEach((x, k) => {
      expect(x.opacity).toBeLessThan((from[k] as number) * 0.2);
    });
    // and settles within 900 ms (LYR-18)
    for (let k = 0; k < 45; k++) {
      t += FRAME;
      m.update({ t, dt: FRAME, playing: true, mode: 'run', W, H });
    }
    const a = [...m.insts.values()].find((v) => v.role === 'zone' && v.rank === 0);
    expect(Math.abs((a?.y.x ?? 0) - Y0)).toBeLessThan(2);
  });

  it('a short seek (one line on): lines that stay change rank on the slow spring, unstaggered', () => {
    const m = model('ballad-word');
    const h = m.tl.handovers;
    run(m, (h[4] as number) - 2000, (h[4] as number) - 1500);
    const kept = [5, 6, 7].map((i) => m.insts.get(i));
    m.update({ t: (h[5] as number) + 200, dt: FRAME, playing: true, mode: 'run', W, H });
    for (const v of kept) {
      expect(v && m.insts.get(v.i)).toBe(v); // the same instance, a new rank
      expect(v?.params).toBe(SPRINGS.slow);
      expect(v?.delay).toBe(0);
    }
    expect(kept[0]?.rank).toBe(0);
  });

  it('scrub: every line sits exactly on its target, frame by frame', () => {
    const m = model('ballad-word');
    for (let t = 20_000; t < 60_000; t += 731) {
      m.update({ t, dt: FRAME, playing: false, mode: 'scrub', W, H });
      for (const v of m.insts.values()) {
        expect(v.y.x).toBe(v.ty);
        expect(v.z.x).toBe(v.tz);
      }
    }
  });

  it('still: one frame at t is fully settled and reproducible', () => {
    const one = () => {
      const m = model('ballad-word');
      m.update({ t: 60_000, dt: 0, playing: false, mode: 'still', W, H });
      return snapshot(m, 60_000);
    };
    const a = one();
    expect(a).toEqual(one());
    const active = [...a.inst.values()].find((v) => v.role === 'zone' && v.rank === 0);
    expect(active?.y).toBeCloseTo(Y0);
    expect(active?.opacity).toBe(1);
    expect(blurAt(0)).toBe(0);
  });
});

describe('reduced motion (LYRICS_EXPERIENCE.md §10, A11Y-05)', () => {
  const reduced = { reduced: true };

  it('slots are static: no travel, no beat response, words at rest', () => {
    const m = model('pop-line');
    const snaps = run(m, 0, 90_000, reduced);
    const slots = new Map<string, Set<string>>(); // role/rank → distinct (y, z, scale-free)
    for (const s of snaps)
      for (const v of s.inst.values()) {
        expect(v.y).toBe(v.ty); // placed at the slot, never travelling to it
        expect(v.z).toBe(v.tz);
        expect(v.scale).toBe(1); // no pulse
        if (v.role !== 'zone') continue;
        const k = `${v.rank}`;
        slots.set(k, (slots.get(k) ?? new Set()).add(`${v.z.toFixed(4)}`));
      }
    expect(slots.get('0')?.size).toBe(1);
    for (const inst of m.insts.values()) {
      expect(inst.wy.every((y) => y === 0)).toBe(true);
      expect(inst.ws.every((s) => s === 1)).toBe(true);
    }
  });

  it('a hand-over crossfades in place over 180 ms', () => {
    const m = model('pop-line');
    const snaps = run(m, 0, 60_000, reduced);
    // Each line that becomes the active one: from the hand-over frame its opacity rises at a
    // fixed rate to the slot's, in ~180 ms, without overshoot, at a position it never travels to.
    let checked = 0;
    for (let n = 1; n < snaps.length; n++) {
      const s = snaps[n] as Snap;
      for (const [i, v] of s.inst) {
        const was = (snaps[n - 1] as Snap).inst.get(i);
        if (v.rank !== 0 || v.role !== 'zone' || !was || was.rank <= 0) continue;
        const end = snaps[n + Math.ceil(R_MS / FRAME) + 2]?.inst.get(i);
        if (end?.rank !== 0) continue;
        expect(end.opacity).toBeCloseTo(opacityAt(end.z), 2);
        expect(v.y).toBe(v.ty);
        for (let k = 0; k < Math.ceil(R_MS / FRAME); k++)
          expect(
            ((snaps[n + k] as Snap).inst.get(i) as { opacity: number }).opacity,
          ).toBeLessThanOrEqual(opacityAt(end.z) + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('constant glow on the sweeping word, no emphasis, static interlude dots', () => {
    const m = model('accents-word');
    let glowed = 0;
    for (let t = 0; t < 60_000; t += FRAME) {
      m.update({
        t,
        dt: FRAME,
        playing: true,
        mode: 'run',
        W,
        H,
        reduced: true,
        features: tracks.get(m)?.sample(t, FRAME),
      });
      for (const v of m.insts.values()) {
        for (const g of v.glow) if (g > 0) glowed++;
        for (const row of v.emph) for (const e of row) expect(e.x).toBe(0);
        expect(v.glowR).toBe(LYRICS.glow.radius);
        for (const g of v.glow) expect(g).toBeLessThanOrEqual(LYRICS.glow.alpha + 1e-9);
      }
      if (m.dots.opacity > 0) {
        expect(m.dots.scale).toEqual([1, 1, 1]);
        expect(m.dots.alpha).toEqual([0.6, 0.6, 0.6]);
      }
    }
    expect(glowed).toBeGreaterThan(100);
  });

  it('the word sweep still runs (it carries timing, not motion)', () => {
    const m = model('ballad-word');
    const mid = run(m, 0, 20_000, reduced).find((s) =>
      [...s.inst.values()].some((v) => v.p.some((p) => p > 0 && p < 1)),
    );
    expect(mid).toBeDefined();
  });
});

const R_MS = LYRICS.reduced.crossfadeMs;

describe('the sweep along the line (§5.1, lineEdges)', () => {
  const w = (start: number, end: number) => ({ text: 'x', start, end, isPartOfWord: false });
  const words = [w(0, 400), w(400, 800), w(1500, 2000)]; // a 700 ms hold before the third
  const widths = [100, 50, 100];

  it('one edge crosses the words in their time: behind it past 1, ahead below 0', () => {
    const [a, b, c] = lineEdges(words, widths, 300);
    expect(a).toBeCloseTo(0.75); // the edge, 75% through the first word
    expect(b).toBeCloseTo(-0.5); // 25 px before the second: its fade may already touch it
    expect(c).toBeLessThan(-1000); // across the hold gap: not lit early
    const [a2, b2] = lineEdges(words, widths, 500);
    expect(a2).toBeCloseTo(1.125); // 12.5 px past its end: the trailing fade still on it
    expect(b2).toBeCloseTo(0.25);
  });

  it('at a hold the edge rests, and the last word’s fade clears on its own', () => {
    const at = (t: number) => lineEdges(words, widths, t);
    expect(at(800)[1]).toBeCloseTo(1);
    expect(at(800 + 250)[1]).toBeGreaterThanOrEqual(5);
    expect(at(1000)[2]).toBeLessThan(-1000);
    expect(at(1750)[2]).toBeCloseTo(0.5);
    expect(at(2300)[2]).toBeGreaterThanOrEqual(5);
  });

  it('before the line, every word is unreached', () => {
    expect(lineEdges(words, widths, -10).every((p) => p < -1000)).toBe(true);
  });
});

describe('seeking', () => {
  it('back and forward mid-line moves every line continuously', () => {
    const m = model('ballad-word');
    const tl = m.tl;
    const mid = (j: number) => ((tl.lines[j] as LyricLine).start + (tl.ends[j] as number)) / 2;
    const path = [
      ...run(m, 0, mid(4)),
      ...run(m, mid(1), mid(1) + 3000), // back
      ...run(m, mid(6), mid(6) + 3000), // forward
    ];
    for (let k = 1; k < path.length; k++) {
      const p = path[k - 1] as Snap;
      const q = path[k] as Snap;
      for (const [i, v] of q.inst) {
        const u = p.inst.get(i);
        if (!u || v.opacity < 0.01 || u.opacity < 0.01) continue;
        expect(Math.abs(v.y - u.y)).toBeLessThan(0.08 * H);
        expect(Math.abs(v.x - u.x)).toBeLessThan(0.08 * W);
      }
    }
  });
});

describe('word lift and swell (§5.1)', () => {
  const WM = LYRICS.word;
  const w = { text: 'light', start: 1000, end: 1600, isPartOfWord: false };

  it('the word being sung is the largest: unsung and sung words sit at scale 1', () => {
    expect(wordMotion(w, 0, false)).toEqual({ y: WM.liftEm, s: 1 });
    expect(wordMotion(w, w.start + WM.popMs, false).s).toBeCloseTo(WM.peak, 6);
    expect(wordMotion(w, w.end, false).s).toBeCloseTo(WM.peak, 6);
    expect(wordMotion(w, w.end + WM.releaseMs, false).s).toBe(1);
    expect(wordMotion(w, 99_000, false)).toEqual({ y: 0, s: 1 });
  });

  it('is continuous in time, so the frame loop never steps it', () => {
    for (let t = 900; t < 2800; t += 1) {
      const a = wordMotion(w, t, false);
      const b = wordMotion(w, t + 1, false);
      expect(Math.abs(b.s - a.s)).toBeLessThan(0.002);
      expect(Math.abs(b.y - a.y)).toBeLessThan(0.001);
    }
  });

  it('held words swell per letter instead (§5.5), so the word itself stays at 1', () => {
    for (let t = 0; t < 3000; t += 10) expect(wordMotion(w, t, true).s).toBe(1);
  });
});
