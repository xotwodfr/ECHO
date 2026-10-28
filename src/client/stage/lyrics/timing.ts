import type { LyricLine, LyricsDoc } from '../../../shared/types.ts';
import { LYRICS } from './lyricsConfig.ts';

// Time → field state (LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9). Pure functions of the document
// and song time `t`; the field calls them every frame and springs only smooth the result (§6.2).

const { handover: HO, interlude: IL, lineTimed: LT } = LYRICS;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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
