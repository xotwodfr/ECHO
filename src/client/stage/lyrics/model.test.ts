import { describe, expect, it } from 'vitest';
import type { FeatureSource, LyricLine, LyricsDoc } from '../../../shared/types.ts';
import { featureTracks } from '../../fixtures/feature-tracks.ts';
import { guideFeatures } from '../../fixtures/guide.ts';
import { lyricFixtures } from '../../fixtures/lyrics.ts';
import * as BG from './background.ts';
import { sidesOf } from './layout.ts';
import { LYRICS } from './lyricsConfig.ts';
import {
  blurAt,
  FieldModel,
  type FrameInput,
  type Inst,
  type LineBox,
  opacityAt,
} from './model.ts';
import { SPRINGS } from './springs.ts';
import { buildTimeline, scaleAt, type Timeline } from './timing.ts';

// Frame simulations of the lyric field (LYRICS_EXPERIENCE.md §4–§9) at 1440×900 (H = 812), with
// nominal boxes: 56 px type, 0.5 em per character, wrapped at 0.64 W. The browser's measured boxes
// are checked in e2e (lyrics.spec.ts).

const W = 1440;
const H = 812;
const FONT = 56;
const ROW = FONT * 1.12;
const Y0 = 0.4 * H;
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
function model(name: string, budget = 24) {
  const doc = fx(name);
  const tl = buildTimeline(doc);
  const m = new FieldModel(tl, boxesOf(doc, tl), {
    seed: BG.hash(doc.trackKey),
    budget,
    dotsH: ROW,
  });
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
    m.update({ t, dt, driftS: t / 1000, playing: true, mode: 'run', W, H, features, ...opts });
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
          if (s.t - from < 600) continue; // still arriving from +1 (2% settle ≤ 0.46 s)
          const v = s.inst.get(i);
          expect(Math.abs((v?.y ?? 0) - Y0)).toBeLessThanOrEqual(2);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(500);
    },
  );
});

describe('the transition zone (LYR-03, LYR-05)', () => {
  it.each(['ballad-word', 'pop-line', 'duet-word', 'long-lines'])(
    '%s: +1…+3 below the active line, fading and blurring with distance, never overlapping it',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 110_000);
      let checked = 0;
      for (const s of snaps) {
        const zone = [...s.inst.values()]
          .filter((v) => v.role === 'zone')
          .sort((a, b) => a.rank - b.rank);
        const active = zone.find((v) => v.rank === 0);
        const up = zone.filter((v) => v.rank > 0);
        // Settled frames: a line entering from the background crosses the zone on its way in.
        // (Drift keeps every line a few px behind its moving target, so "settled" is 4 px.)
        if (!active || up.length < 2 || zone.some((v) => Math.abs(v.y - v.ty) > 4)) continue;
        const ai = [...s.inst].find(([, v]) => v === active)?.[0] as number;
        const activeBottom = active.y + ((m.boxes[ai] as LineBox).h * active.scale) / 2;
        for (let k = 0; k < up.length; k++) {
          const v = up[k] as (typeof up)[number];
          const vi = [...s.inst].find(([, x]) => x === v)?.[0] as number;
          const top = v.y - ((m.boxes[vi] as LineBox).h * v.scale) / 2;
          expect(top).toBeGreaterThanOrEqual(activeBottom + 0.02 * H - 0.5);
          const prev = up[k - 1];
          // +3 that did not fit waits at background depth behind +2, at the same height (§4.3).
          const behind = v.rank === 3 && v.tz >= LYRICS.zone.zBackground;
          if (prev && behind) expect(v.opacity).toBeLessThan(prev.opacity);
          else if (prev) {
            expect(v.y).toBeGreaterThan(prev.y);
            expect(v.opacity).toBeLessThan(prev.opacity);
            expect(v.blur).toBeGreaterThan(prev.blur);
          }
          expect(v.blur).toBeLessThanOrEqual(LYRICS.depth.zoneBlurCap);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(300);
    },
  );

  it('LYR-05 on the ballad: +1 rises monotonically while a line is sung (every 100 ms), staying clear of the active box', () => {
    const doc = fx('ballad-word');
    const m = model('ballad-word');
    const snaps = run(m, 0, 100_000);
    const tl = m.tl;
    let lines = 0;
    let moved = 0;
    for (let a = 0; a < tl.lines.length - 1; a++) {
      const from = tl.handovers[a] as number;
      const to = (tl.handovers[a + 1] ?? from) as number;
      if (to - from < 3000 || tl.coalesced.includes(a)) continue;
      const ys: number[] = [];
      // The hand-over's own travel (the slow spring after the intro overshoots by ≤ 0.6%) is not
      // drift: sampling starts once it has settled, and the overshoot is bounded below.
      for (let t = from + 1200; t < to; t += 100) {
        const s = snaps[Math.round(t / FRAME)];
        if (!s) break;
        const v = s.inst.get(a + 1);
        const act = s.inst.get(a);
        if (!v || !act || v.rank !== 1) continue;
        ys.push(v.y);
        const gap =
          v.y -
          ((m.boxes[a + 1] as LineBox).h * v.scale) / 2 -
          (act.y + (m.boxes[a] as LineBox).h / 2);
        expect(gap).toBeGreaterThanOrEqual(0.02 * H - 0.5);
      }
      for (let k = 1; k < ys.length; k++)
        expect(ys[k]).toBeLessThanOrEqual((ys[k - 1] as number) + 1e-6);
      if (ys.length < 2) continue;
      moved = Math.max(moved, (ys[0] as number) - (ys.at(-1) as number));
      lines++;
    }
    expect(lines).toBeGreaterThan(doc.lines.length / 2);
    // It does float, but little: +1 closes 0.35 of its clearance × 0.30 drift, ≈ 3.4 px over a
    // ballad line with §15's values (a finding for the tuning pass, M3 task 11).
    expect(moved).toBeGreaterThan(1);
    // Over the whole song, +1 never moves back down by a visible amount.
    for (let k = 1; k < snaps.length; k++) {
      const a = snaps[k - 1] as Snap;
      const b = snaps[k] as Snap;
      for (const [i, v] of b.inst) {
        const u = a.inst.get(i);
        if (u && u.rank === 1 && v.rank === 1) expect(v.y - u.y).toBeLessThan(0.1);
      }
    }
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
          // A line at opacity 0 is not rendered: background lines re-home there (§8.3).
          if (!u || (u.opacity < 0.01 && v.opacity < 0.01)) continue;
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
      if (!r || v.role === 'bg') continue;
      expect(v.y).toBeCloseTo(r.y, 0);
    }
  });

  it('staggers new targets: the new active at once, +1 50 ms later, the entering +3 ≈ 143 ms later', () => {
    const m = model('ballad-word');
    const h = m.tl.handovers[3] as number; // line 3 takes the anchor
    run(m, h - 2000, h - 1);
    const ty = (i: number) => (m.insts.get(i) as Inst).ty;
    const [t3, t4, t6] = [ty(3), ty(4), ty(6)];
    let t = h - 1;
    const step = (ms: number) => {
      t += ms;
      m.update({ t, dt: ms, driftS: t / 1000, playing: true, mode: 'run', W, H });
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
    for (let k = 0; k < 36; k++)
      m.update({ t, dt: FRAME, driftS: 0, playing: false, mode: 'run', W, H });
    expect(glowOf()).toBeCloseTo(LYRICS.glow.alpha * 0.6, 2);
    for (let k = 0; k < 18; k++)
      m.update({ t: t + k * FRAME, dt: FRAME, driftS: 0, playing: true, mode: 'run', W, H });
    expect(glowOf()).toBeCloseTo(LYRICS.glow.alpha, 2);
  });
});

describe('past lines (LYR-10)', () => {
  it.each(['ballad-word', 'rap-word', 'pop-line'])(
    '%s: opacity follows e^(−Δt/520 ms) ± 5%%, at most 2 visible, removed below 0.02',
    (name) => {
      const m = model(name);
      const snaps = run(m, 0, 100_000);
      let checked = 0;
      for (const s of snaps) {
        const past = [...s.inst].filter(([, v]) => v.role === 'past');
        expect(past.length).toBeLessThanOrEqual(2);
        for (const [i, v] of past) {
          const dt = s.t - (m.leftAt[i] as number);
          const o0 = m.coalesced.has(i) ? opacityAt(LYRICS.zone.dz) : 1;
          const want = o0 * Math.exp(-dt / 520);
          expect(want).toBeGreaterThanOrEqual(0.02 - 1e-3);
          if (dt > 450) {
            // after the 400 ms build fade of lines created mid-decay
            expect(Math.abs(v.opacity - want)).toBeLessThanOrEqual(0.05 * want + 1e-9);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(300);
    },
  );
});

describe('the background field (LYR-11, LYR-12)', () => {
  it('at most the budget, seeded: the same placement on every run', () => {
    const a = run(model('ballad-word'), 30_000, 31_000).at(-1) as Snap;
    const b = run(model('ballad-word'), 30_000, 31_000).at(-1) as Snap;
    const bg = (s: Snap) => [...s.inst].filter(([, v]) => v.role === 'bg');
    expect(bg(a).length).toBeLessThanOrEqual(24);
    expect(bg(a).length).toBeGreaterThan(10);
    expect(bg(a)).toEqual(bg(b));
    const other = run(model('accents-word'), 30_000, 31_000).at(-1) as Snap;
    expect(bg(other).map(([, v]) => Math.round(v.x))).not.toEqual(
      bg(a).map(([, v]) => Math.round(v.x)),
    );
    for (const budget of [12, 6, 0]) {
      const s = run(model('ballad-word', budget), 30_000, 30_100).at(-1) as Snap;
      expect(bg(s).length).toBeLessThanOrEqual(budget);
    }
  });

  it('nothing inside the reading corridor nearer than z 0.85 or brighter than 0.10', () => {
    const m = model('ballad-word');
    const snaps = run(m, 0, 120_000);
    let inside = 0;
    for (const s of snaps) {
      const active = [...s.inst.values()].find((v) => v.role === 'zone' && v.rank === 0);
      const zone = [...s.inst].filter(([, v]) => v.role === 'zone');
      if (!active) continue;
      const ai = [...s.inst].find(([, v]) => v === active)?.[0] as number;
      const bottom = Math.max(
        ...zone.map(([i, v]) => v.y + ((m.boxes[i] as LineBox).h * v.scale) / 2),
      );
      const c = {
        x0: 0.12 * W,
        x1: 0.88 * W,
        y0: Y0 - (m.boxes[ai] as LineBox).h / 2 - 0.04 * H,
        y1: bottom + 0.02 * H,
      };
      for (const [i, v] of s.inst) {
        if (v.role !== 'bg') continue;
        const b = m.boxes[i] as LineBox;
        const hw = (b.w * v.scale) / 2;
        const hh = (b.h * v.scale) / 2;
        const overlaps = v.x + hw > c.x0 && v.x - hw < c.x1 && v.y + hh > c.y0 && v.y - hh < c.y1;
        if (!overlaps) continue;
        inside++;
        // Settled active line only: while it moves, the corridor moves with it by a few px.
        if (Math.abs(active.y - Y0) > 1) continue;
        expect(v.z).toBeGreaterThanOrEqual(0.85 - 1e-9);
        expect(v.opacity).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
    expect(inside).toBeGreaterThan(100);
  });

  it('each line drifts within its amplitude around its home', () => {
    const pts = BG.homes(7, W, H);
    const box = { w: 400, h: ROW };
    const far = { x0: 0, x1: 0, y0: 0, y1: 0 };
    for (let d = 0; d < 600; d += 3) {
      const p = BG.place(7, pts, 3, 100_000, 1000, d, W, H, box, far, opacityAt, scaleAt);
      const home = pts[3] as BG.Point;
      expect(Math.abs(p.x - home.x)).toBeLessThanOrEqual(
        1.5 * 0.022 * W + 0.006 * W * 2.2 * 0.22 + 1e-6,
      );
      expect(Math.abs(p.y - home.y + 0.004 * H * 1)).toBeLessThanOrEqual(
        1.5 * 0.018 * H + 0.004 * H * 2.2 * 0.22 + 1e-6,
      );
    }
    expect(pts.length).toBeGreaterThanOrEqual(24);
    for (const a of pts)
      for (const b of pts)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.16 * H);
  });

  it('a line entering +3 travels from its home, with continuous opacity (no pop-in)', () => {
    const m = model('ballad-word');
    const snaps = run(m, 0, 80_000);
    let entries = 0;
    for (let k = 1; k < snaps.length; k++) {
      const a = snaps[k - 1] as Snap;
      const b = snaps[k] as Snap;
      for (const [i, v] of b.inst) {
        const u = a.inst.get(i);
        if (u?.role !== 'bg' || v.role !== 'zone') continue;
        entries++;
        expect(Math.hypot(v.x - u.x, v.y - u.y)).toBeLessThan(0.02 * H);
        expect(Math.abs(v.opacity - u.opacity)).toBeLessThan(0.03);
        // and it keeps blending over the move
        for (let j = k + 1; j < Math.min(snaps.length, k + 60); j++) {
          const w0 = (snaps[j - 1] as Snap).inst.get(i);
          const w1 = (snaps[j] as Snap).inst.get(i);
          if (w0 && w1) expect(Math.abs(w1.opacity - w0.opacity)).toBeLessThan(0.03);
        }
      }
    }
    expect(entries).toBeGreaterThan(5);
  });
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
    m.update({ t: 90_000, dt: FRAME, driftS: 0, playing: true, mode: 'run', W, H });
    for (const v of m.insts.values()) {
      if (v.role === 'bg') continue;
      expect(v.delay).toBe(0);
    }
    expect(m.leaving.map((x) => x.i)).toEqual(expect.arrayContaining(old));
    for (const v of m.insts.values()) if (v.role !== 'bg') expect(v.params).toBe(SPRINGS.slow);
    const fading = m.leaving.filter((x) => old.includes(x.i));
    const from = fading.map((x) => x.opacity);
    let t = 90_000;
    for (let k = 0; k < 10; k++) {
      t += FRAME;
      m.update({ t, dt: FRAME, driftS: 0, playing: true, mode: 'run', W, H });
    }
    expect(m.leaving.filter((x) => old.includes(x.i))).toEqual([]);
    // They faded on the way out: ~1/10 of the 160 ms left after 9 of 10 frames.
    fading.forEach((x, k) => {
      expect(x.opacity).toBeLessThan((from[k] as number) * 0.2);
    });
    // and settles within 900 ms (LYR-18)
    for (let k = 0; k < 45; k++) {
      t += FRAME;
      m.update({ t, dt: FRAME, driftS: 0, playing: true, mode: 'run', W, H });
    }
    const a = [...m.insts.values()].find((v) => v.role === 'zone' && v.rank === 0);
    expect(Math.abs((a?.y.x ?? 0) - Y0)).toBeLessThan(2);
  });

  it('a short seek (one line on): lines that stay change rank on the slow spring, unstaggered', () => {
    const m = model('ballad-word');
    const h = m.tl.handovers;
    run(m, (h[4] as number) - 2000, (h[4] as number) - 1500);
    const kept = [5, 6, 7].map((i) => m.insts.get(i));
    m.update({ t: (h[5] as number) + 200, dt: FRAME, driftS: 0, playing: true, mode: 'run', W, H });
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
      m.update({ t, dt: FRAME, driftS: 0, playing: false, mode: 'scrub', W, H });
      for (const v of m.insts.values()) {
        expect(v.y.x).toBe(v.ty);
        expect(v.z.x).toBe(v.tz);
      }
    }
  });

  it('still: one frame at t is fully settled and reproducible', () => {
    const one = () => {
      const m = model('ballad-word');
      m.update({ t: 60_000, dt: 0, driftS: 60, playing: false, mode: 'still', W, H });
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
