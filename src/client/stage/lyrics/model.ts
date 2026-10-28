import type { Features, LyricLine, LyricWord } from '../../../shared/types.ts';
import { SILENT_FEATURES } from '../../playback/features.ts';
import { Beat, type BeatTerms, glowFor, vocalAt } from './beat.ts';
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
import { type FieldState, fieldAt, type Timeline } from './timing.ts';

// The lyric field's motion, per frame (LYRICS_EXPERIENCE.md §4–§9): one column scrolled by springs
// from time, hand-over stagger, decay, word sweep, glow and emphasis. No DOM: `field.ts` writes
// what this computes, so all of it is unit-tested on frame simulations.

const {
  column: C,
  decay: D,
  glow: G,
  interlude: IL,
  build: BUILD,
  stagger: ST,
  reduced: R,
  word: WM,
} = LYRICS;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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

/** Distance functions (§4.1), of the rendered distance from the anchor. */
export const opacityAt = (z: number) => table(LYRICS.depth.opacity, z);
export const blurAt = (z: number) => table(LYRICS.depth.blur, z);
/**
 * The unsung ink: 22% toward the room at the anchor so the sweep reads against it (M3 design
 * review). It fades in as a line arrives (z dz → 0), so it never steps, and leaves the other
 * lines' contrast alone (DESIGN_SYSTEM.md §3.4 rule 4): they are dimmed by opacity.
 */
export const unlitMixAt = (z: number) => LYRICS.unlitMix * clamp(1 - z / C.dz, 0, 1);

/** Word sweep (§5.1): linear in time, at least 60 ms long. */
export const sweepAt = (w: LyricWord, t: number) =>
  clamp((t - w.start) / Math.max(w.end - w.start, LYRICS.sweep.minWordMs), 0, 1);

/** After a word ends with nothing right after it, its trailing fade clears over this long. */
const SETTLE_MS = 250;
const UNREACHED = -1e6;

/**
 * The sweep as one soft edge along the whole line (§5.1; Spicy Lyrics' refreshed sweep): the words
 * laid end to end, `widths` px each, the edge crossing each word in that word's time. A word's value
 * is how far the edge is through it, so it runs past 1 while the fade behind the edge still covers
 * its end, and below 0 while the fade ahead already touches its start: the light flows from word to
 * word instead of stopping at each. Across a hold gap (> holdGapMs) nothing ahead is lit: the next
 * words stay unreached until they start, and the last word's fade clears over SETTLE_MS.
 */
export function lineEdges(words: LyricWord[], widths: number[], t: number): number[] {
  const W = words.map((_, k) => Math.max(1, widths[k] ?? 1));
  const X: number[] = [];
  let x = 0;
  for (const w of W) {
    X.push(x);
    x += w;
  }
  let edge = 0;
  let next = 0; // the first word not started
  while (next < words.length && t >= (words[next] as LyricWord).start) {
    edge = (X[next] as number) + (W[next] as number) * sweepAt(words[next] as LyricWord, t);
    next++;
  }
  // The fade ahead reaches words not yet started, up to the first hold gap.
  let reach = next - 1;
  while (
    reach >= 0 &&
    reach + 1 < words.length &&
    (words[reach + 1] as LyricWord).start - (words[reach] as LyricWord).end <=
      LYRICS.sweep.holdGapMs
  )
    reach++;
  const spill = reach >= next;
  return words.map((w, k) => {
    if (k >= next) return k <= reach ? (edge - (X[k] as number)) / (W[k] as number) : UNREACHED;
    const along = (edge - (X[k] as number)) / (W[k] as number);
    // Nothing after it yet: the fade behind the edge clears on its own.
    return k === next - 1 && t > w.end && !spill
      ? Math.max(along, 1 + ((t - w.end) / SETTLE_MS) * 4)
      : along;
  });
}

/**
 * A lead word's own motion (§5.1), from time alone so a seek lands on it: it rises over max(1 s,
 * its length); while it is sung it swells to `peak` (in its first 140 ms, at most half of it), so
 * the word being sung is the largest on the line, and eases back to 1 over 300 ms after its end.
 * Held words swell per letter instead (§5.5).
 */
export function wordMotion(w: LyricWord, t: number, emphasised: boolean) {
  const dur = w.end - w.start;
  const u = clamp((t - w.start) / Math.max(1000, dur), 0, 1);
  const pop = Math.max(1, Math.min(WM.popMs, dur / 2));
  const up = clamp((t - w.start) / pop, 0, 1);
  const down = clamp((t - w.end) / WM.releaseMs, 0, 1);
  const peak = emphasised ? 1 : WM.peak;
  return {
    y: WM.liftEm * (1 - u) ** 3,
    s: 1 + (peak - 1) * (1 - (1 - up) ** 3) * (1 - down * down * (3 - 2 * down)),
  };
}

/** Line-timed wash (§9.2): 420 ms from the line's start, eased out. */
export const washAt = (line: LyricLine, t: number) => {
  const x = clamp((t - line.start) / LYRICS.wash.ms, 0, 1);
  return 1 - (1 - x) ** 4; // ponytail: quartic stand-in for --ease-out's cubic-bezier(.16,1,.3,1)
};

const SEEK_JUMP_MS = 150; // §9.6, the AMLL rule
/** By new rank: past lines and rank 0 at 0 ms, +1 at 50, +2 at ≈ 98, +3 at ≈ 143, … (§6.3). */
const staggerMs = (rank: number) =>
  rank <= 0 ? 0 : (ST.baseMs * (1 - ST.decay ** -rank)) / (1 - 1 / ST.decay);

/** What the field knows about a line's layout (from `layout.ts`, or synthetic in tests). */
export interface LineBox {
  w: number;
  h: number;
  side: Side;
  words?: { rect: Rect; emphasis: Emphasis | null; graphemes: Rect[] }[];
}

export type Role = 'zone' | 'past';

export interface Inst {
  i: number;
  role: Role; // zone: the active line and those to come; past: sung lines above them
  rank: number;
  x: Spring;
  y: Spring;
  z: Spring; // distance from the anchor, 0…1 (§4.1)
  params: SpringParams;
  delay: number; // ms until this line's new targets apply (stagger)
  tx: number;
  ty: number;
  tz: number;
  age: number; // ms since created, for the fade-in
  leaving: { ms: number; age: number; from: number } | null;
  // Outputs, read by field.ts:
  scale: number;
  opacity: number;
  blur: number; // own filter, px
  mix: number; // unsung ink toward the room (§5.1)
  fade: number; // past lines: lit colour toward ink (§7)
  p: number[]; // sweep per lead word: time through it, 0…1
  edge: number[]; // where the line's soft edge is per lead word, for drawing (lineEdges)
  backing: number[][]; // sweep per backing word, drawn the same way (lineEdges)
  wash: number; // line-timed lead sweep
  glow: number[]; // alpha per lead word
  glowR: number; // glow radius, em (§12.3)
  emph: Spring[][]; // per lead word, per grapheme: 0 rest … 1 full emphasis
  wy: number[]; // per lead word: drop below its rest, em (wordMotion)
  ws: number[]; // per lead word: scale
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
  playing: boolean;
  mode: Mode; // still: deterministic frame (everything settled); scrub: springs bypassed
  W: number;
  H: number;
  features?: Features; // §12.1; none: unavailable
  reduced?: boolean; // §10: crossfade in place, no travel, beats or emphasis
}

export interface FieldOptions {
  dotsH: number; // the dots' box at rank 0 (one row at active size)
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
  private lastT = Number.NaN;
  private lastMode: Mode = 'run';
  private lastField: FieldState | null = null;
  private pause = 1;
  private reduced = false;
  private dotsLeave = 0;

  readonly tl: Timeline;
  boxes: LineBox[];
  readonly opts: FieldOptions;

  constructor(tl: Timeline, boxes: LineBox[], opts: FieldOptions) {
    this.tl = tl;
    this.boxes = boxes;
    this.opts = opts;
    this.lines = tl.lines;
    this.beats = new Beat();
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

    const pauseTarget = f.playing ? 1 : G.paused;
    const pauseRate = (1 - G.paused) / (f.playing ? G.resumeMs : G.pauseMs);
    this.pause =
      f.mode === 'still'
        ? pauseTarget
        : this.pause < pauseTarget
          ? Math.min(pauseTarget, this.pause + pauseRate * dt)
          : Math.max(pauseTarget, this.pause - pauseRate * dt);

    // ---- the column (§4) ----
    // The active line (or the dots' box) at the anchor; lines to come stacked below it and sung
    // lines above it, one gap apart, while their slots are within the margin of the stage.
    const box = (i: number) => this.boxes[i] as LineBox;
    const anchorY = LYRICS.anchorY * H;
    const gap = C.gap * this.opts.dotsH;
    const h0 = fs.active >= 0 ? box(fs.active).h : this.opts.dotsH;
    const want = new Map<number, { role: Role; rank: number; y: number }>();
    if (fs.active >= 0) want.set(fs.active, { role: 'zone', rank: 0, y: anchorY });
    let edge = anchorY + h0 / 2;
    for (let j = fs.next; j < n && edge < (1 + C.margin) * H; j++) {
      const h = box(j).h;
      want.set(j, { role: 'zone', rank: j - fs.next + 1, y: edge + gap + h / 2 });
      edge += gap + h;
    }
    edge = anchorY - h0 / 2;
    for (let j = Math.min(fs.next, n) - 1, rank = -1; j >= 0 && edge > -C.margin * H; j--) {
      if (j === fs.active) continue;
      const h = box(j).h;
      want.set(j, { role: 'past', rank: rank--, y: edge - gap - h / 2 });
      edge -= gap + h;
    }

    for (const [i, inst] of this.insts)
      if (!want.has(i)) {
        this.insts.delete(i);
        if (f.mode === 'still') continue; // gone at once
        // A line scrolled out of the column fades in 120 ms (§7); a seek fades out what does not
        // belong to the new position in 160 ms (§9.6).
        inst.leaving = { ms: seek ? BUILD.seekOutMs : D.dropMs, age: 0, from: inst.opacity };
        this.leaving.push(inst);
      }

    const params = (i: number): SpringParams => {
      if (seek || slowHandover) return SPRINGS.slow;
      const a = fs.active >= 0 ? fs.active : i;
      const gap =
        (this.lines[a + 1]?.start ?? Number.POSITIVE_INFINITY) - (this.lines[a] as LyricLine).start;
      return lineNormal(gap);
    };

    for (const [i, w] of want) {
      let inst = this.insts.get(i);
      const tx = this.anchorX(box(i), W);
      const ty = w.y;
      const tz = Math.min(1, Math.abs(w.rank) * C.dz);
      if (!inst) {
        // A line entering the column joins its neighbour where it is, delay and spring included,
        // so it scrolls in with it instead of waiting at its slot under a line still on its way.
        const nb = direct ? undefined : this.insts.get(w.role === 'past' ? i + 1 : i - 1);
        const off = nb ? nb.y.x - (want.get(nb.i)?.y ?? nb.y.x) : 0;
        inst = this.create(i, w.role, w.rank, tx, ty + off, tz, f.mode === 'still');
        if (nb) {
          inst.y.v = nb.y.v;
          inst.delay = nb.delay;
          inst.params = nb.params;
        }
        this.insts.set(i, inst);
      } else if (inst.rank !== w.rank || inst.role !== w.role) {
        inst.params = params(i);
        inst.delay = seek || direct ? 0 : staggerMs(w.rank);
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
      if (direct) {
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
      this.style(inst, w.role, t, beat);
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

  /** The column's start edge, or its end for the second voice of a duet (§4.4). */
  private anchorX(b: LineBox, W: number) {
    const inset = ((1 - LYRICS.maxWidth) / 2) * W;
    return b.side === 'right' ? W - inset - b.w / 2 : inset + b.w / 2;
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
      leaving: null,
      scale: 1,
      opacity: 0,
      blur: 0,
      mix: 0,
      fade: 0,
      p: words.map(() => 0),
      edge: words.map(() => UNREACHED),
      backing: (this.lines[i]?.background ?? []).map((b) => (b.words ?? []).map(() => UNREACHED)),
      wash: 0,
      glow: words.map(() => 0),
      glowR: LYRICS.glow.radius,
      emph: words.map((_, k) =>
        em[k]?.emphasis ? (em[k]?.graphemes ?? []).map(() => spring(0)) : [],
      ),
      wy: words.map(() => (this.reduced ? 0 : WM.liftEm)),
      ws: words.map(() => 1),
    };
  }

  private style(inst: Inst, role: Role, t: number, beat: BeatTerms) {
    const z = inst.z.x;
    const born = this.reduced ? 1 : clamp(inst.age / BUILD.fadeInMs, 0, 1);
    inst.opacity = opacityAt(z) * born;
    inst.blur = blurAt(z);
    // Beats change size only, never opacity or luminance (§12.4): the active line pulses with the
    // bass.
    inst.scale = inst.rank === 0 ? 1 + beat.pulse : 1;
    inst.mix = unlitMixAt(z);
    // A sung line's lit colour dies into ink once it has left the anchor (§7).
    const left = this.leftAt[inst.i] as number;
    inst.fade = role === 'past' ? 1 - Math.exp(-Math.max(0, t - left) / D.tauMs) : 0;
  }

  private words(inst: Inst, t: number, f: FrameInput, settle: boolean) {
    const line = this.lines[inst.i] as LyricLine;
    const rank = inst.rank;
    const words = line.words ?? [];
    for (let k = 0; k < words.length; k++) inst.p[k] = sweepAt(words[k] as LyricWord, t);
    const widths = (this.boxes[inst.i]?.words ?? []).map((b) => b.rect.w);
    inst.edge = lineEdges(words, widths, t);
    // Backing words have no measured boxes here: equal widths.
    (line.background ?? []).forEach((b, j) => {
      inst.backing[j] = lineEdges(b.words ?? [], [], t);
    });
    inst.wash = words.length ? 0 : washAt(line, t);
    const boxes = this.boxes[inst.i]?.words ?? [];
    for (let k = 0; k < words.length; k++) {
      const m = this.reduced
        ? { y: 0, s: 1 }
        : wordMotion(words[k] as LyricWord, t, !!boxes[k]?.emphasis);
      inst.wy[k] = m.y;
      inst.ws[k] = m.s;
    }

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
    for (let k = 0; k < words.length; k++) {
      const e = boxes[k]?.emphasis;
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
