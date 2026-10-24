import type { Features, LyricLine, LyricWord } from '../../../shared/types.ts';
import { SILENT_FEATURES } from '../../playback/features.ts';
import * as BG from './background.ts';
import { Beat, type BeatTerms, glowFor, type IntensitySetting, vocalAt } from './beat.ts';
import type { Emphasis, Rect, Side } from './layout.ts';
import { LYRICS } from './lyricsConfig.ts';
import {
  lineNormal,
  SPRINGS,
  type Spring,
  type SpringParams,
  snap,
  spring,
  step,
} from './springs.ts';
import {
  type Box,
  type FieldState,
  fieldAt,
  scaleAt,
  type Timeline,
  zoneTargets,
} from './timing.ts';

// The lyric field's motion, per frame (LYRICS_EXPERIENCE.md §4–§9): spring targets from time,
// hand-over stagger, decay, the background field, entering the zone, word sweep, glow and emphasis.
// No DOM: `field.ts` writes what this computes, so all of it is unit-tested on frame simulations.

const { zone: Z, decay: D, glow: G, interlude: IL, build: BUILD, stagger: ST, reduced: R } = LYRICS;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function table(points: readonly (readonly [number, number])[], z: number) {
  const first = points[0] as readonly [number, number];
  if (z <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const [z1, v1] = points[i] as readonly [number, number];
    const [z0, v0] = points[i - 1] as readonly [number, number];
    if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
  }
  return (points.at(-1) as readonly [number, number])[1];
}

/** Depth functions (§4.1), of the rendered depth. */
export const opacityAt = (z: number) => table(LYRICS.depth.opacity, z);
export const blurAt = (z: number) => table(LYRICS.depth.blur, z);
/** Ink mixes 18% toward the room per 0.33 z (§4.1). */
export const inkMixAt = (z: number) => clamp((0.18 * z) / 0.33, 0, 1);
/**
 * The zone's unsung ink: the depth mix, plus 22% toward the room at the anchor so the sweep reads
 * against it (M3 design review). The extra part fades in as a line arrives (z 0.22 → 0), so it
 * never steps, and leaves the upcoming lines' contrast alone (DESIGN_SYSTEM.md §3.4 rule 4).
 */
export const unlitMixAt = (z: number) =>
  clamp(inkMixAt(z) + LYRICS.unlitMix * Math.max(0, 1 - z / Z.dz), 0, 1);

/** Word sweep (§5.1): linear in time, at least 60 ms long. */
export const sweepAt = (w: LyricWord, t: number) =>
  clamp((t - w.start) / Math.max(w.end - w.start, LYRICS.sweep.minWordMs), 0, 1);

/** Line-timed wash (§9.2): 420 ms from the line's start, eased out. */
export const washAt = (line: LyricLine, t: number) => {
  const x = clamp((t - line.start) / LYRICS.wash.ms, 0, 1);
  return 1 - (1 - x) ** 4; // ponytail: quartic stand-in for --ease-out's cubic-bezier(.16,1,.3,1)
};

const DECAY_MS = D.tauMs * Math.log(50); // until the envelope reaches 0.02 (≈ 2 s)
const BEHIND_MS = 300; // +3 dims to the corridor cap while it waits behind +2
const ENTER_MS = 760; // the line.enter move (§6.1, §8.5): opacity blends over it
const SEEK_JUMP_MS = 150; // §9.6, the AMLL rule
const STAGGER = [0, 0, 1, 2, 3].map((k) =>
  k === 0
    ? 0
    : Array.from({ length: k }, (_, j) => ST.baseMs / ST.decay ** j).reduce((a, b) => a + b, 0),
); // by new rank + 1 → rank 0 at 0 ms, +1 at 50, +2 at ≈ 98, +3 (entering) at ≈ 143

/** What the field knows about a line's layout (from `layout.ts`, or synthetic in tests). */
export interface LineBox {
  w: number;
  h: number;
  side: Side;
  words?: { rect: Rect; emphasis: Emphasis | null; graphemes: Rect[] }[];
}

export type Role = 'zone' | 'past' | 'bg';

export interface Inst {
  i: number;
  role: Role;
  rank: number;
  x: Spring;
  y: Spring;
  z: Spring;
  params: SpringParams;
  delay: number; // ms until this line's new targets apply (stagger)
  tx: number;
  ty: number;
  tz: number;
  age: number; // ms since created, for the fade-in
  enter: { from: number; age: number } | null; // bg → zone: opacity blends from its last value
  behind: number; // 0…1: capped while it waits behind +2 (§4.3)
  leaving: { ms: number; age: number; from: number } | null;
  // Outputs, read by field.ts:
  scale: number;
  opacity: number;
  blur: number; // own filter, px (bucketed background lines: 0)
  bucket: number; // −1: main container
  mix: number; // ink toward the room (§4.1)
  fade: number; // past lines: lit colour toward ink (§7)
  p: number[]; // sweep per lead word
  backing: number[][]; // sweep per backing word
  wash: number; // line-timed lead sweep
  glow: number[]; // alpha per lead word
  glowR: number; // glow radius, em (§12.3)
  emph: Spring[][]; // per lead word, per grapheme: 0 rest … 1 full emphasis
}

export interface DotsView {
  opacity: number; // the group (enter, leave)
  scale: number[];
  alpha: number[];
}

export type Mode = 'run' | 'scrub' | 'still';

export interface FrameInput {
  t: number; // song time, ms
  dt: number; // ms
  driftS: number; // Stage pool time, s (slows while paused)
  playing: boolean;
  mode: Mode; // still: deterministic frame (everything settled); scrub: springs bypassed
  W: number;
  H: number;
  features?: Features; // §12.1; none: unavailable
  reduced?: boolean; // §10: crossfade in place, no travel, drift, background, beats or emphasis
}

export interface FieldOptions {
  seed: number;
  budget: number; // background lines (§8.1, by tier)
  dotsH: number; // the dots' box at rank 0 (one row at active size)
  drift?: number; // approach drift fraction (§4.3), fixed; by default §12.3 raises it when intense
  intensity?: IntensitySetting; // visuals.intensity (§12.2), default expressive
}

export class FieldModel {
  readonly lines: LyricLine[];
  readonly leftAt: number[];
  readonly coalesced: Set<number>;
  insts = new Map<number, Inst>();
  leaving: Inst[] = [];
  dots: DotsView = { opacity: 0, scale: [1, 1, 1], alpha: [0, 0, 0] };
  key: { x: number; y: number } | null = null;
  beat: BeatTerms | null = null;
  private beats: Beat;
  private bgS = Number.NaN; // background clock, s: the Stage drift clock at the passage's speed
  private lastDriftS = 0;
  private lastT = Number.NaN;
  private lastMode: Mode = 'run';
  private lastField: FieldState | null = null;
  private pause = 1;
  private reduced = false;
  private behind = false; // +3 waits at background depth behind +2 (§4.3)
  private homes: BG.Point[] = [];
  private homesFor = '';
  private dotsLeave = 0;

  readonly tl: Timeline;
  boxes: LineBox[];
  readonly opts: FieldOptions;

  constructor(tl: Timeline, boxes: LineBox[], opts: FieldOptions) {
    this.tl = tl;
    this.boxes = boxes;
    this.opts = opts;
    this.lines = tl.lines;
    this.beats = new Beat(opts.intensity);
    this.coalesced = new Set(tl.coalesced);
    // When each line leaves the anchor: the first span in which it is behind the field.
    this.leftAt = tl.lines.map(() => Number.POSITIVE_INFINITY);
    for (const s of tl.spans)
      for (let j = 0; j < s.next; j++)
        if (j !== s.line && this.leftAt[j] === Number.POSITIVE_INFINITY) this.leftAt[j] = s.from;
  }

  /** New measurements (resize): everything jumps to its new place (§9.10). */
  relayout(boxes: LineBox[]) {
    this.boxes = boxes;
    this.lastT = Number.NaN;
  }

  update(f: FrameInput) {
    const { t, dt, H, W } = f;
    const first = Number.isNaN(this.lastT);
    const jumped =
      !first &&
      f.mode !== 'scrub' &&
      (t < this.lastT - 1 || Math.abs(t - (this.lastT + (f.playing ? dt : 0))) > SEEK_JUMP_MS);
    // A seek: targets jump and lines travel on the slow spring with no stagger. Leaving scrub mode
    // counts as one (§9.6).
    const seek = jumped || (this.lastMode === 'scrub' && f.mode !== 'scrub');
    this.reduced = !!f.reduced;
    const reduced = this.reduced;
    const direct = f.mode !== 'run' || first || reduced; // positions taken directly
    this.lastT = t;
    this.lastMode = f.mode;

    const fs = fieldAt(this.tl, t);
    const prev = this.lastField;
    this.lastField = fs;
    const handover = !!prev && (prev.active !== fs.active || prev.next !== fs.next);
    // §6.1: the slow spring after an interlude, for the first line and at the end of the song.
    const slowHandover = handover && (prev.active < 0 || fs.active < 0);
    const n = this.lines.length;

    const ft = f.features ?? SILENT_FEATURES.sample(t, dt);
    const activeLine = fs.active >= 0 ? this.lines[fs.active] : undefined;
    const beat = this.beats.update({
      features: ft,
      dt,
      sinceHandover: seek ? 0 : t - fs.from,
      vocal: vocalAt(activeLine?.words, !!activeLine, ft.mid, t),
      mode: f.mode,
      reduced,
    });
    this.beat = beat;
    // The background's paths run on their own clock, so a passage can slow or speed them (§12.3).
    if (f.mode === 'still' || Number.isNaN(this.bgS)) this.bgS = f.driftS;
    else this.bgS += Math.max(0, f.driftS - this.lastDriftS) * beat.speed;
    this.lastDriftS = f.driftS;

    const pauseTarget = f.playing ? 1 : G.paused;
    const pauseRate = (1 - G.paused) / (f.playing ? G.resumeMs : G.pauseMs);
    this.pause =
      f.mode === 'still'
        ? pauseTarget
        : this.pause < pauseTarget
          ? Math.min(pauseTarget, this.pause + pauseRate * dt)
          : Math.max(pauseTarget, this.pause - pauseRate * dt);

    // ---- who is where ----
    const want = new Map<number, { role: Role; rank: number }>();
    if (fs.active >= 0) want.set(fs.active, { role: 'zone', rank: 0 });
    for (let k = 0; k < 3 && fs.next + k < n; k++)
      want.set(fs.next + k, { role: 'zone', rank: k + 1 });
    let past = 0;
    for (let j = Math.min(fs.next, n) - 1; j >= 0 && past < D.maxPast; j--) {
      if (j === fs.active) continue;
      if (this.envelope(j, t) < 0.02) break;
      want.set(j, { role: 'past', rank: -1 - past++ });
    }
    for (let k = 0; k < (reduced ? 0 : this.opts.budget) && fs.next + 3 + k < n; k++)
      want.set(fs.next + 3 + k, { role: 'bg', rank: 4 + k });

    for (const [i, inst] of this.insts)
      if (!want.has(i) || (want.get(i)?.role === 'bg' && inst.role !== 'bg')) {
        this.insts.delete(i);
        const decayed = !seek && inst.role === 'past' && this.envelope(i, t) < 0.02;
        if (f.mode === 'still' || decayed) continue; // gone at once
        // A third hand-over drops the oldest past line in 120 ms (§7); a seek fades out what does
        // not belong to the new position in 160 ms (§9.6).
        inst.leaving = {
          ms: inst.role === 'past' && !seek ? D.dropMs : BUILD.seekOutMs,
          age: 0,
          from: inst.opacity,
        };
        this.leaving.push(inst);
      }

    // ---- targets ----
    const anchorY = LYRICS.anchorY * H;
    const box = (i: number) => this.boxes[i] as LineBox;
    const zoneBoxes: Box[] = [];
    const h0 = fs.active >= 0 ? box(fs.active).h : this.opts.dotsH;
    const nextStart = this.lines[fs.next]?.start ?? t;
    zoneBoxes.push({
      start: fs.active >= 0 ? (this.lines[fs.active] as LyricLine).start : nextStart - Z.gapRefMs,
      h: h0,
    });
    for (let k = 0; k < 3 && fs.next + k < n; k++)
      zoneBoxes.push({
        start: (this.lines[fs.next + k] as LyricLine).start,
        h: box(fs.next + k).h,
      });
    const zt = zoneTargets(H, zoneBoxes, fs.phase, reduced ? 0 : (this.opts.drift ?? beat.drift));
    this.behind = zt.background3;

    const corridorBottom = Math.max(
      ...zt.y.map((y, k) => y + ((zoneBoxes[k] as Box).h * scaleAt(zt.z[k] as number)) / 2),
    );
    const corridor: BG.Corridor = {
      x0: 0.12 * W,
      x1: 0.88 * W,
      y0: anchorY - h0 / 2 - 0.04 * H,
      y1: corridorBottom + 0.02 * H,
    };
    const seed = this.opts.seed;
    const homesKey = `${W}x${H}`;
    if (homesKey !== this.homesFor) {
      this.homes = BG.homes(seed, W, H);
      this.homesFor = homesKey;
    }

    const params = (i: number): SpringParams => {
      if (seek || slowHandover) return SPRINGS.slow;
      const a = fs.active >= 0 ? fs.active : i;
      const gap =
        (this.lines[a + 1]?.start ?? Number.POSITIVE_INFINITY) - (this.lines[a] as LyricLine).start;
      return lineNormal(gap);
    };

    let pastY = anchorY - h0 / 2; // top edge of the box below the next past line
    const pastOrder = [...want]
      .filter(([, w]) => w.role === 'past')
      .sort((a, b) => b[1].rank - a[1].rank);
    const pastTarget = new Map<number, { y: number; z: number }>();
    for (const [i] of pastOrder) {
      const dtLeft = t - (this.leftAt[i] as number);
      const z = reduced ? 0 : D.zEnd * (1 - Math.exp(-dtLeft / D.tauMs));
      const hs = box(i).h * scaleAt(z);
      const y = pastY - D.gapH * H - hs / 2;
      pastY = y - hs / 2;
      pastTarget.set(i, { y: reduced ? y : y - D.rise * H * clamp(dtLeft / DECAY_MS, 0, 1), z });
    }

    for (const [i, w] of want) {
      let inst = this.insts.get(i);
      const b = box(i);
      let tx: number;
      let ty: number;
      let tz: number;
      let bgPlace: BG.Placement | null = null;
      if (w.role === 'zone') {
        ty = zt.y[w.rank] as number;
        tz = zt.z[w.rank] as number;
        tx = this.anchorX(b, tz, W);
      } else if (w.role === 'past') {
        const p = pastTarget.get(i) as { y: number; z: number };
        ty = p.y;
        tz = p.z;
        tx = this.anchorX(b, tz, W);
      } else {
        bgPlace = BG.place(
          seed,
          this.homes,
          i,
          (this.lines[i] as LyricLine).start,
          t,
          this.bgS,
          W,
          H,
          b,
          corridor,
          opacityAt,
          scaleAt,
          beat,
        );
        tx = bgPlace.x;
        ty = bgPlace.y;
        tz = bgPlace.z;
      }

      if (!inst) {
        inst = this.create(i, w.role, w.rank, tx, ty, tz, f.mode === 'still');
        this.insts.set(i, inst);
      } else if (inst.rank !== w.rank || inst.role !== w.role) {
        if (inst.role === 'bg' && w.role !== 'bg') {
          inst.enter = { from: inst.opacity, age: 0 };
          inst.bucket = -1;
          inst.params = seek ? SPRINGS.slow : SPRINGS.enter;
        } else inst.params = params(i);
        inst.delay = seek || direct ? 0 : (STAGGER[clamp(w.rank, -1, 3) + 1] as number);
        inst.role = w.role;
        inst.rank = w.rank;
      } else if (seek) {
        inst.params = SPRINGS.slow;
        inst.delay = 0;
      }

      inst.delay = Math.max(0, inst.delay - dt);
      if (inst.delay === 0) {
        inst.tx = tx;
        inst.ty = ty;
        inst.tz = tz;
      }
      if (w.role === 'bg' || direct) {
        snap(inst.x, inst.tx);
        snap(inst.y, inst.ty);
        snap(inst.z, inst.tz);
      } else {
        step(inst.x, inst.tx, inst.params, dt);
        step(inst.y, inst.ty, inst.params, dt);
        step(inst.z, inst.tz, inst.params, dt);
      }
      inst.age += f.mode === 'still' ? BUILD.fadeInMs : dt;
      const shown = inst.opacity;
      this.style(inst, w.role, t, f.dt, bgPlace, beat);
      // §10: a hand-over is a crossfade in place, so opacity eases at a fixed rate.
      if (reduced && f.mode === 'run')
        inst.opacity = shown + clamp(inst.opacity - shown, -dt / R.crossfadeMs, dt / R.crossfadeMs);
      this.words(inst, t, f, seek || direct);
    }

    for (const inst of this.leaving) {
      const l = inst.leaving as NonNullable<Inst['leaving']>;
      l.age += dt;
      inst.opacity = l.from * Math.max(0, 1 - l.age / l.ms);
    }
    this.leaving = this.leaving.filter((x) => (x.leaving?.age ?? 0) < (x.leaving?.ms ?? 0));

    this.updateDots(fs, t, dt, f.mode === 'still');
    this.updateKey(fs, W, H);
  }

  /** The line being sung at the last update, or −1. */
  get active() {
    return this.lastField?.active ?? -1;
  }

  /** The decay envelope of past line `i` at `t`, from 1 (or +1's opacity if it never led). */
  envelope(i: number, t: number) {
    const left = this.leftAt[i] as number;
    if (t < left) return 1;
    const o = this.coalesced.has(i) ? opacityAt(Z.dz) : 1;
    if (this.reduced) return o * Math.max(0, 1 - (t - left) / R.decayMs); // fade only (§10)
    return o * Math.exp(-(t - left) / D.tauMs);
  }

  private anchorX(b: LineBox, z: number, W: number) {
    const hw = (b.w * scaleAt(z)) / 2;
    if (b.side === 'left') return 0.18 * W + hw;
    if (b.side === 'right') return 0.82 * W - hw;
    return W / 2;
  }

  private create(
    i: number,
    role: Role,
    rank: number,
    x: number,
    y: number,
    z: number,
    still: boolean,
  ): Inst {
    const words = this.lines[i]?.words ?? [];
    const em = this.boxes[i]?.words ?? [];
    return {
      i,
      role,
      rank,
      x: spring(x),
      y: spring(y),
      z: spring(z),
      params: SPRINGS.slow,
      delay: 0,
      tx: x,
      ty: y,
      tz: z,
      age: still ? BUILD.fadeInMs : 0,
      enter: null,
      behind: 0,
      leaving: null,
      scale: 1,
      opacity: 0,
      blur: 0,
      bucket: -1,
      mix: 0,
      fade: 0,
      p: words.map(() => 0),
      backing: (this.lines[i]?.background ?? []).map((b) => (b.words ?? []).map(() => 0)),
      wash: 0,
      glow: words.map(() => 0),
      glowR: LYRICS.glow.radius,
      emph: words.map((_, k) =>
        em[k]?.emphasis ? (em[k]?.graphemes ?? []).map(() => spring(0)) : [],
      ),
    };
  }

  private style(
    inst: Inst,
    role: Role,
    t: number,
    dt: number,
    bg: BG.Placement | null,
    beat: BeatTerms,
  ) {
    const z = inst.z.x;
    inst.scale = scaleAt(z);
    const born = this.reduced ? 1 : clamp(inst.age / BUILD.fadeInMs, 0, 1);
    if (role === 'bg' && bg) {
      inst.opacity = bg.opacity * born;
      inst.bucket = bg.bucket;
      inst.blur = 0;
      inst.mix = inkMixAt(z);
      inst.fade = 0;
      return;
    }
    inst.bucket = -1;
    if (role === 'past') {
      const left = this.leftAt[inst.i] as number;
      const k = 1 - Math.exp(-Math.max(0, t - left) / D.tauMs);
      inst.opacity = this.envelope(inst.i, t) * born;
      inst.blur = this.reduced ? 0 : D.blurMax * k;
      inst.mix = 0;
      inst.fade = k;
      return;
    }
    let o = opacityAt(z);
    // +3 waiting behind +2 overlaps it: it keeps the reading corridor's cap, so it reads as depth,
    // not as a second line printed through the first (M3 design review). Eased per line, so
    // neither the wait nor the hand-over that ends it pops.
    const wait = inst.rank === 3 && this.behind ? 1 : 0;
    const step = this.lastMode === 'still' ? 1 : dt / BEHIND_MS;
    inst.behind = clamp(inst.behind + (wait ? step : -step), 0, 1);
    o = lerp(o, Math.min(o, BG.CORRIDOR_OPACITY), inst.behind);
    if (inst.enter) {
      inst.enter.age += dt;
      const k = clamp(inst.enter.age / ENTER_MS, 0, 1);
      o = lerp(inst.enter.from, o, k * k * (3 - 2 * k));
      if (k >= 1) inst.enter = null;
    }
    inst.opacity = o * born;
    // Beats change size only, never opacity or luminance (§12.4): the active line pulses with the
    // bass and +1…+3 lean toward the viewer; opacity and blur keep the unleaned depth.
    inst.scale = inst.rank === 0 ? inst.scale * (1 + beat.pulse) : scaleAt(z - beat.lean);
    inst.blur = inst.rank <= 3 ? Math.min(blurAt(z), LYRICS.depth.zoneBlurCap) : blurAt(z);
    inst.mix = unlitMixAt(z);
    inst.fade = 0;
  }

  private words(inst: Inst, t: number, f: FrameInput, settle: boolean) {
    const line = this.lines[inst.i] as LyricLine;
    const rank = inst.rank;
    if (inst.role === 'bg') return; // background lines are not word-lit (§8.2)
    const words = line.words ?? [];
    for (let k = 0; k < words.length; k++) inst.p[k] = sweepAt(words[k] as LyricWord, t);
    (line.background ?? []).forEach((b, j) => {
      (b.words ?? []).forEach((w, k) => {
        (inst.backing[j] as number[])[k] = sweepAt(w, t);
      });
    });
    inst.wash = words.length ? 0 : washAt(line, t);

    // Glow (§5.2): the sweeping word of the line being sung (rank 0, or a line sweeping at +1).
    const sweeping = words.findIndex((w) => t >= w.start && t < w.end);
    const lit = rank === 0 || (rank === 1 && sweeping >= 0);
    const slew = (G.slewPerS / 1000) * f.dt;
    const look = glowFor(this.beat?.sustain ?? 0, this.beat?.glowAdd ?? 0);
    inst.glowR = look.radius;
    const target = lit && sweeping >= 0 ? look.alpha * this.pause : 0;
    const before = [...inst.glow];
    // A faint glow ends at 0 only when that step is itself within the slew.
    const end = (a: number, next: number) => (next < 0.005 && a <= slew ? 0 : next);
    // Words that ended fade exponentially (τ 220 ms, 120 ms for fast words), never faster than the
    // photosensitivity slew (§12.5).
    let fading = 0;
    for (let k = 0; k < words.length; k++) {
      const a = before[k] as number;
      if ((k === sweeping && target > 0) || a === 0) continue;
      const w = words[k] as LyricWord;
      const tau = w.end - w.start < 150 ? G.decayFastMs : G.decayMs;
      const next = f.mode === 'still' ? 0 : Math.max(a * Math.exp(-f.dt / tau), a - slew);
      const g = end(a, next);
      inst.glow[k] = g;
      if (g > 0) fading++;
    }
    // At most two words glow (§5.2). While two are still fading, the older fades at the fastest
    // permitted rate and the sweeping word waits for it, so no glow is ever cut.
    const own = sweeping >= 0 && (before[sweeping] as number) > 0 ? 1 : 0;
    if (fading >= 2 || fading + own > 2) {
      const oldest = inst.glow.findIndex((a, k) => a > 0 && k !== sweeping);
      const a = before[oldest] as number;
      inst.glow[oldest] = end(a, Math.max(0, a - slew));
    }
    if (sweeping >= 0) {
      const a = before[sweeping] as number;
      const room = inst.glow.filter((g, k) => g > 0 && k !== sweeping).length < 2;
      inst.glow[sweeping] =
        f.mode === 'still'
          ? target
          : a < target
            ? room
              ? Math.min(target, a + Math.min((G.alpha / G.riseMs) * f.dt, slew))
              : a
            : Math.max(target, a - slew);
    }

    // Emphasis (§5.5): graphemes lift and swell in sequence from 400 ms before the word, and
    // release 250 ms before its end. None while scrubbing; a seek lands on the state, no replay.
    const em = this.boxes[inst.i]?.words ?? [];
    for (let k = 0; k < words.length; k++) {
      const e = em[k]?.emphasis;
      const gs = inst.emph[k] as Spring[];
      if (!e || gs.length === 0) continue;
      const w = words[k] as LyricWord;
      gs.forEach((s, g) => {
        const on =
          f.mode !== 'scrub' &&
          !this.reduced &&
          t >= w.start - LYRICS.emphasis.anticipateMs + g * e.stepMs &&
          t < w.end - LYRICS.emphasis.releaseMs;
        if (settle) snap(s, on ? 1 : 0);
        else step(s, on ? 1 : 0, SPRINGS.lift, f.dt);
      });
    }
  }

  private updateDots(fs: FieldState, t: number, dt: number, still: boolean) {
    const d = this.dots;
    if (fs.dots) {
      const since = t - fs.from;
      d.opacity = clamp(since / IL.enterMs, 0, 1);
      this.dotsLeave = d.opacity;
      for (let k = 0; k < 3; k++) {
        const ph = (since - k * IL.dotStepMs) / IL.cycleMs;
        const b = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
        d.scale[k] = this.reduced ? 1 : 0.4 + 0.85 * b;
        d.alpha[k] = this.reduced ? R.dotsAlpha : 0.2 + 0.7 * b;
      }
    } else {
      this.dotsLeave = still ? 0 : Math.max(0, this.dotsLeave - dt / IL.fadeMs);
      d.opacity = this.dotsLeave;
    }
  }

  private updateKey(fs: FieldState, W: number, H: number) {
    const a = fs.active >= 0 ? this.insts.get(fs.active) : undefined;
    if (!a) {
      this.key = null;
      return;
    }
    const line = this.lines[a.i] as LyricLine;
    const b = this.boxes[a.i] as LineBox;
    const k = a.p.findIndex((p) => p < 1);
    const r = b.words?.[k < 0 ? (line.words?.length ?? 1) - 1 : k]?.rect;
    const ox = r ? (r.x + r.w / 2 - b.w / 2) * a.scale : 0;
    const oy = r ? (r.y + r.h / 2 - b.h / 2) * a.scale : 0;
    this.key = { x: (a.x.x + ox) / W, y: (a.y.x + oy) / H };
  }
}
