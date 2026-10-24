import type { LyricLine, LyricsDoc } from '../../../shared/types.ts';
import { LYRICS } from './lyricsConfig.ts';

// Time → field state (LYRICS_EXPERIENCE.md §4.3, §5.3, §9.8, §9.9). Pure functions of the document
// and song time `t`; the field calls them every frame and springs only smooth the result (§6.2).

const { handover: HO, interlude: IL, zone: Z, lineTimed: LT } = LYRICS;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

/** Depth scale `s(z)` (§4.1). */
export const scaleAt = (z: number) => 1 - LYRICS.depth.scaleK * z;

/**
 * Who holds the active anchor from `from` until the next span: a line, or nobody (the intro, an
 * instrumental gap, the outro). `next` is the first line still to come (rank +1).
 */
export interface Span {
  from: number;
  line: number; // −1: no active line
  next: number;
  dotsUntil: number; // interlude dots are shown while t < dotsUntil (−∞: none)
}

export interface Timeline {
  lines: LyricLine[]; // displayed lines: empty and whitespace-only lines are gaps (§9.9)
  ends: number[]; // `end`, derived when missing (§9.2)
  handovers: number[]; // when each line would take the anchor (§5.3), non-decreasing
  coalesced: number[]; // lines that never take the anchor (§9.9): they sweep at rank +1
  spans: Span[];
}

export function buildTimeline(doc: LyricsDoc): Timeline {
  if (doc.sync === 'none') {
    const lines = doc.lines.filter((l) => l.text.trim());
    return { lines, ends: [], handovers: [], coalesced: [], spans: [span(0, -1, 0)] };
  }
  // A line-timed line without `end` ends 100 ms before the next timed line, empty ones included.
  const all = doc.lines;
  const ended = all.map((l, i) => {
    const next = all[i + 1];
    const end =
      l.end ?? l.words?.at(-1)?.end ?? (next ? next.start - LT.endGapMs : l.start + LT.lastLineMs);
    return { l, end };
  });
  const kept = ended.filter(({ l }) => l.text.trim());
  const lines = kept.map((k) => k.l);
  const ends = kept.map((k) => k.end);
  const n = lines.length;
  if (n === 0) return { lines, ends, handovers: [], coalesced: [], spans: [span(0, -1, 0)] };

  const start = (i: number) => (lines[i] as LyricLine).start;
  const end = (i: number) => ends[i] as number;
  // The voice of a word-timed line stops at its last word, not at trailing backing vocals.
  const sungEnd = (i: number) => (lines[i] as LyricLine).words?.at(-1)?.end ?? end(i);

  const handovers: number[] = [];
  for (let i = 0; i < n; i++) {
    const lead =
      i === 0 ? HO.leadMaxMs : clamp(start(i) - sungEnd(i - 1), HO.leadMinMs, HO.leadMaxMs);
    handovers.push(Math.max(start(i) - lead, handovers[i - 1] ?? -Infinity));
  }
  const h = (i: number) => handovers[i] as number;

  const isGap = (i: number) => start(i) - (i === 0 ? 0 : end(i - 1)) >= IL.minGapMs;
  // A line whose hand-over is followed by the next one within 350 ms never takes the anchor: the
  // field advances two ranks at the later hand-over, so no line is active for less than 350 ms.
  const coalesced: number[] = [];
  for (let i = 0; i < n - 1; i++) if (h(i + 1) - h(i) < HO.coalesceMs) coalesced.push(i);

  const spans: Span[] = [span(0, -1, 0)];
  if (isGap(0)) (spans[0] as Span).dotsUntil = h(0) - IL.leaveMs;
  for (let i = 0; i < n; i++) {
    if (i > 0 && isGap(i)) spans.push(span(end(i - 1), -1, i, h(i) - IL.leaveMs));
    if (!coalesced.includes(i)) spans.push(span(h(i), i, i + 1));
  }
  spans.push(span(Math.max(end(n - 1), h(n - 1)), -1, n));
  return { lines, ends, handovers, coalesced, spans };
}

function span(from: number, line: number, next: number, dotsUntil = -Infinity): Span {
  return { from, line, next, dotsUntil };
}

export interface FieldState {
  active: number; // index into `Timeline.lines`, −1 when no line holds the anchor
  next: number; // rank +1 (`lines.length` when every line has started)
  handoverAt: number; // the next hand-over (∞ when none)
  phase: number; // φ: progress through the active line or the gap, 0..1 (§4.3)
  dots: boolean; // interlude dots (§9.8)
  from: number; // when the current span began (a hand-over, or the end of the line before a gap)
}

export function fieldAt(tl: Timeline, t: number): FieldState {
  let i = 0;
  while (i + 1 < tl.spans.length && (tl.spans[i + 1] as Span).from <= t) i++;
  const s = tl.spans[i] as Span;
  const handoverAt = tl.spans[i + 1]?.from ?? Infinity;
  const from = s.line >= 0 ? (tl.lines[s.line] as LyricLine).start : s.from;
  const span = handoverAt - from;
  const phase = handoverAt === Infinity ? 0 : span > 0 ? clamp((t - from) / span, 0, 1) : 1;
  return { active: s.line, next: s.next, handoverAt, phase, dots: t < s.dotsUntil, from: s.from };
}

export const activeIndexAt = (tl: Timeline, t: number) => fieldAt(tl, t).active;

/** Rank of line `j` (§2): 0 active, +1… upcoming, −1… past. */
export const rankOf = (s: FieldState, j: number) =>
  j >= s.next || s.active >= 0 ? j - s.next + 1 : j - s.next;

/** A line box for stacking: its start time and its measured height at scale 1 (§3.3). */
export interface Box {
  start: number;
  h: number;
}

export interface Zone {
  y: number[]; // centre y per rank 0…+3, CSS px
  z: number[]; // depth per rank
  background3: boolean; // +3 did not fit and waits at background depth behind +2 (§4.3)
}

/**
 * Slots of the active line (or the dots, rank 0) and up to three upcoming lines (§4.2, §4.3). The
 * gap between two lines grows with the time between them; boxes use their slot scale.
 */
export function zoneSlots(H: number, boxes: readonly Box[]): Zone {
  const b = (i: number) => boxes[i] as Box;
  const g = boxes.map((x, i) =>
    i === 0 ? 0 : clamp((x.start - b(i - 1).start) / Z.gapRefMs, Z.gapClamp[0], Z.gapClamp[1]),
  );
  const z = [0];
  for (let i = 1; i < boxes.length; i++)
    z.push(Math.min((z[i - 1] as number) + Z.dz * (g[i] as number), Z.zMax));
  const half = (i: number) => (b(i).h * scaleAt(z[i] as number)) / 2;
  const place = (k: number) => {
    const y = [LYRICS.anchorY * H];
    for (let i = 1; i < boxes.length; i++)
      y.push((y[i - 1] as number) + half(i - 1) + half(i) + Z.gapH * H * (g[i] as number) * k);
    return y;
  };
  const last = boxes.length - 1;
  const bottom = (y: number[], i: number) => (y[i] as number) + half(i);
  const limit = Z.bottom * H;
  // Shrink all gaps uniformly (to half at most) until line `i` ends on the limit. Its bottom is
  // linear in the gap factor.
  const gapsFor = (i: number) => {
    const full = bottom(place(1), i);
    if (full <= limit) return 1;
    const tight = bottom(place(0), i);
    return Math.max(Z.gapShrinkMin, (limit - tight) / (full - tight));
  };

  let y = place(gapsFor(last));
  let background3 = false;
  if (last === 3 && bottom(y, 3) > limit) {
    // +3 still does not fit: it waits behind +2, and the zone is fitted to +2.
    background3 = true;
    y = place(gapsFor(2));
    z[3] = Z.zBackground;
    y[3] = y[2] as number;
  }
  return { y, z, background3 };
}

/**
 * Spring targets for ranks 0…+3 at progress `phase` (§4.3 approach drift): upcoming lines glide
 * part of the way toward the next slot while the active line is sung. +1 closes 35% of its
 * clearance; no line comes nearer than 0.02 H to the box above it.
 */
export function zoneTargets(
  H: number,
  boxes: readonly Box[],
  phase: number,
  drift: number = Z.drift,
): Zone {
  const slots = zoneSlots(H, boxes);
  const d = drift * easeInOutSine(clamp(phase, 0, 1));
  const y = [...slots.y];
  const z = [...slots.z];
  const sy = (i: number) => slots.y[i] as number;
  const sz = (i: number) => slots.z[i] as number;
  if (boxes.length > 1) {
    const h0 = (boxes[0] as Box).h;
    // Growing toward z 0 enlarges +1's box; it may grow only as far as still fits at its slot,
    // 0.02 H clear of the active box (a 3-row line otherwise reaches into the clearance).
    const room = 2 * (sy(1) - sy(0) - h0 / 2 - Z.clearH * H);
    const zFit = (1 - room / (boxes[1] as Box).h) / LYRICS.depth.scaleK;
    z[1] = Math.min(sz(1), Math.max(lerp(sz(1), 0, d), Z.approachZFloor * sz(1), zFit));
    const h1 = (boxes[1] as Box).h * scaleAt(z[1] as number);
    const clearance = Math.max(0, sy(1) - sy(0) - h0 / 2 - h1 / 2 - Z.clearH * H);
    y[1] = sy(1) - Z.approachK * clearance * d;
  }
  for (let k = 2; k < boxes.length; k++) {
    if (k === 3 && slots.background3) continue;
    // Like +1, a drifting line keeps 0.02 H clear of the box above it (M3 design review): tall
    // wrapped lines would otherwise slide into each other. Never below its own slot. Its depth
    // follows the share of the drift it actually made, so a held line does not grow past the
    // bottom it was fitted to.
    const above =
      (y[k - 1] as number) + ((boxes[k - 1] as Box).h * scaleAt(z[k - 1] as number)) / 2;
    const clear = above + ((boxes[k] as Box).h * scaleAt(sz(k))) / 2 + Z.clearH * H;
    y[k] = Math.max(lerp(sy(k), sy(k - 1), d), Math.min(sy(k), clear));
    const span = sy(k) - sy(k - 1);
    z[k] = lerp(sz(k), sz(k - 1), span > 0 ? (sy(k) - (y[k] as number)) / span : d);
  }
  return { y, z, background3: slots.background3 };
}
