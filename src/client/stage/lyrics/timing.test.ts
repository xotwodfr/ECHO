import { describe, expect, it } from 'vitest';
import type { LyricLine, LyricsDoc } from '../../../shared/types.ts';
import { lyricFixtures } from '../../fixtures/lyrics.ts';
import { LYRICS } from './lyricsConfig.ts';
import {
  activeIndexAt,
  type Box,
  buildTimeline,
  fieldAt,
  rankOf,
  scaleAt,
  type Timeline,
  zoneSlots,
  zoneTargets,
} from './timing.ts';

const H = 812; // 1440×900 minus the dock (§3.2)
const ROW = 67; // one row at --ly-active, nominal

const docOf = (lines: LyricLine[], sync: LyricsDoc['sync'] = 'word'): LyricsDoc => ({
  version: 1,
  trackKey: 'test:t',
  sync,
  source: 'fixture',
  attribution: { text: '' },
  offsetMs: 0,
  lines,
  fetchedAt: '',
});
const one = (start: number, end: number): LyricLine => ({
  text: 'x',
  start,
  end,
  words: [{ text: 'x', start, end, isPartOfWord: false }],
});

describe('timing: hand-computed table (LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9)', () => {
  // 0: 8 s intro (dots) · 1: 500 ms after 0 · 2: a 100 ms line 60 ms before 3 (coalesced) ·
  // 4: after an 8 s gap (dots) · then the outro.
  const tl = buildTimeline(
    docOf([
      one(8000, 9000),
      one(9500, 10500),
      one(10600, 10700),
      one(10760, 12000),
      one(20000, 21000),
    ]),
  );

  it('derives hand-overs and coalescing', () => {
    expect(tl.handovers).toEqual([7700, 9200, 10480, 10640, 19700]);
    expect(tl.coalesced).toEqual([2]);
  });

  it.each([
    // t, active, next, dots, handoverAt
    [0, -1, 0, true, 7700],
    [7199, -1, 0, true, 7700],
    [7200, -1, 0, false, 7700],
    [7700, 0, 1, false, 9200],
    [9200, 1, 2, false, 10640],
    [10600, 1, 2, false, 10640],
    [10640, 3, 4, false, 12000],
    [12000, -1, 4, true, 19700],
    [19199, -1, 4, true, 19700],
    [19200, -1, 4, false, 19700],
    [19700, 4, 5, false, 21000],
    [30000, -1, 5, false, Infinity],
  ])('t = %i: active %i, next %i, dots %s, next hand-over %d', (t, active, next, dots, at) => {
    expect(fieldAt(tl, t)).toMatchObject({ active, next, dots, handoverAt: at });
  });

  it('ranks shift with the field; a coalesced line sweeps at +1, then −1', () => {
    const r = (t: number) => tl.lines.map((_, j) => rankOf(fieldAt(tl, t), j));
    expect(r(9500)).toEqual([-1, 0, 1, 2, 3]);
    expect(r(10650)).toEqual([-3, -2, -1, 0, 1]);
    expect(r(15000)).toEqual([-4, -3, -2, -1, 1]); // gap: nobody at rank 0
    expect(r(0)).toEqual([1, 2, 3, 4, 5]);
  });

  it('phase runs from the active line’s start to the next hand-over, or across a gap', () => {
    expect(fieldAt(tl, 7800).phase).toBe(0); // before the line starts
    expect(fieldAt(tl, 8600).phase).toBeCloseTo(0.5);
    expect(fieldAt(tl, 15_850).phase).toBeCloseTo(0.5);
  });

  it('coalesces hand-overs < 350 ms apart, not ones exactly 350 ms apart', () => {
    // Hand-overs 700 and 1000 (lead 120 ms after a 70 ms gap): 300 ms apart.
    expect(buildTimeline(docOf([one(1000, 1050), one(1120, 2000)])).coalesced).toEqual([0]);
    // 700 and 1050: 350 ms apart.
    expect(buildTimeline(docOf([one(1000, 1050), one(1170, 2000)])).coalesced).toEqual([]);
  });

  it('line-timed ends: missing `end` is the next line’s start − 100 ms, the last line + 6 s', () => {
    const lt = buildTimeline(
      docOf(
        [
          { text: 'a', start: 1000 },
          { text: 'b', start: 3000, end: 3500 },
          { text: ' ', start: 5000 },
          { text: 'c', start: 6000 },
        ],
        'line',
      ),
    );
    expect(lt.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(lt.ends).toEqual([2900, 3500, 12_000]);
    expect(lt.handovers).toEqual([700, 2880, 5700]); // lead from the previous end, 120…300 ms
  });

  it('untimed docs never advance', () => {
    const st = buildTimeline(lyricFixtures.static as LyricsDoc);
    expect(fieldAt(st, 0)).toMatchObject({ active: -1, next: 0, dots: false });
    expect(activeIndexAt(st, 60_000)).toBe(-1);
  });
});

// ── Per fixture, against the spec formulas written out directly (LYR-01) ─────────────────────────

const timed = Object.entries(lyricFixtures).filter(([, d]) => d.sync !== 'none');

function expectedAt(lines: LyricLine[], ends: number[], t: number) {
  const { leadMinMs, leadMaxMs, coalesceMs } = LYRICS.handover;
  const sung = (i: number) => (lines[i] as LyricLine).words?.at(-1)?.end ?? (ends[i] as number);
  const h = lines.map((l, i) =>
    i === 0
      ? l.start - leadMaxMs
      : l.start - Math.min(leadMaxMs, Math.max(leadMinMs, l.start - sung(i - 1))),
  );
  const coalesced = (i: number) =>
    i < lines.length - 1 && (h[i + 1] as number) - (h[i] as number) < coalesceMs;
  const gapBefore = (i: number) =>
    (lines[i] as LyricLine).start - (i === 0 ? 0 : (ends[i - 1] as number)) >=
    LYRICS.interlude.minGapMs;
  // Latest event at or before t decides who holds the anchor.
  let active = -1;
  let next = 0;
  let at = -Infinity;
  const event = (time: number, a: number, n: number) => {
    if (time <= t && time >= at) [at, active, next] = [time, a, n];
  };
  lines.forEach((_, i) => {
    if (i > 0 && gapBefore(i)) event(ends[i - 1] as number, -1, i);
    if (!coalesced(i)) event(h[i] as number, i, i + 1);
  });
  event(ends.at(-1) as number, -1, lines.length);
  return { active, next, h, coalesced };
}

describe.each(timed)('timing: %s fixture', (_name, doc) => {
  const tl = buildTimeline(doc);
  const duration = doc.durationMs as number;

  it('hand-overs follow §5.3 exactly (none needed reordering)', () => {
    expect(tl.handovers).toEqual(expectedAt(tl.lines, tl.ends, 0).h);
  });

  it.each(Array.from({ length: 50 }, (_, k) => Math.round(((k + 0.5) * duration) / 50)))(
    't = %i ms: active line, rank +1 and ranks match',
    (t) => {
      const want = expectedAt(tl.lines, tl.ends, t);
      const s = fieldAt(tl, t);
      expect([s.active, s.next]).toEqual([want.active, want.next]);
      if (s.active >= 0) expect(rankOf(s, s.active)).toBe(0);
      const ranks = tl.lines.map((_, j) => rankOf(s, j));
      expect(ranks.filter((r) => r === 0).length).toBe(s.active >= 0 ? 1 : 0);
      expect(ranks.every((r, j) => j === 0 || r > (ranks[j - 1] as number))).toBe(true);
    },
  );

  it('no line holds the anchor for less than 350 ms (LYR-20)', () => {
    const spans = tl.spans;
    spans.forEach((s, i) => {
      const nxt = spans[i + 1];
      if (s.line >= 0 && nxt && s.line < tl.lines.length - 1)
        expect(nxt.from - s.from).toBeGreaterThanOrEqual(LYRICS.handover.coalesceMs);
    });
  });

  it('dots show only in gaps ≥ 7 s and leave 500 ms before the next hand-over (LYR-21, timing part)', () => {
    for (let t = 0; t < duration; t += 100) {
      const s = fieldAt(tl, t);
      if (!s.dots) continue;
      expect(s.active).toBe(-1);
      const prevEnd = s.next === 0 ? 0 : (tl.ends[s.next - 1] as number);
      expect((tl.lines[s.next] as LyricLine).start - prevEnd).toBeGreaterThanOrEqual(7000);
      expect(t).toBeLessThan(s.handoverAt - 500);
    }
  });
});

describe('timing: fixture specifics', () => {
  it('ballad: dots in the 9 s intro and the 12 s bridge only', () => {
    const tl = buildTimeline(lyricFixtures['ballad-word'] as LyricsDoc);
    const dotGaps = new Set<number>();
    for (let t = 0; t < 220_000; t += 100) {
      const s = fieldAt(tl, t);
      if (s.dots) dotGaps.add(s.next);
    }
    const bridge = tl.lines.findIndex((l) => l.text.startsWith('Hold on'));
    expect([...dotGaps]).toEqual([0, bridge]);
    expect(fieldAt(tl, 0).dots).toBe(true);
    expect(fieldAt(tl, (tl.handovers[0] as number) - 499).dots).toBe(false);
  });

  it('rap: exactly the two interjections coalesce; they sweep at +1 or −1, never as rank 0 (LYR-20)', () => {
    const tl = buildTimeline(lyricFixtures['rap-word'] as LyricsDoc);
    expect(tl.coalesced.map((i) => tl.lines[i]?.text)).toEqual(['Yo', 'Go']);
    for (const i of tl.coalesced) {
      const line = tl.lines[i] as LyricLine;
      for (const w of line.words ?? [])
        for (let t = w.start; t < w.end; t += 10) {
          const r = rankOf(fieldAt(tl, t), i);
          expect([1, -1]).toContain(r);
        }
    }
  });
});

// ── Stacking and drift (§4.3) ─────────────────────────────────────────────────────────────────────

describe('timing: transition zone', () => {
  it('gaps grow with the time between lines, clamped to 0.8…1.5 (LYR-04)', () => {
    const boxes: Box[] = [
      { start: 0, h: ROW },
      { start: 2000, h: ROW }, // 0.625 → 0.8
      { start: 6000, h: ROW }, // 1.25
      { start: 12_000, h: ROW }, // 1.875 → 1.5
    ];
    const { y, z } = zoneSlots(H, boxes);
    const g = [0.8, 1.25, 1.5];
    expect(z[1]).toBeCloseTo(0.22 * 0.8);
    expect(z[2]).toBeCloseTo(0.22 * (0.8 + 1.25));
    expect(z[3]).toBeCloseTo(0.72); // capped
    expect(y[0]).toBeCloseTo(0.4 * H);
    for (let i = 1; i < 4; i++) {
      const edgeGap =
        (y[i] as number) -
        (ROW * scaleAt(z[i] as number)) / 2 -
        ((y[i - 1] as number) + (ROW * scaleAt(z[i - 1] as number)) / 2);
      expect(edgeGap).toBeCloseTo(0.04 * H * (g[i - 1] as number));
    }
  });

  // Only lines 2.56–4.8 s apart vary the factor; ballad lines sit at 1.5 and rap lines at 0.8.
  it('duet fixture: every zone gap is 0.04 H × the clamped time gap of its two lines (LYR-04)', () => {
    const tl = buildTimeline(lyricFixtures['duet-word'] as LyricsDoc);
    const factors = new Set<number>();
    for (const s of tl.spans) {
      if (s.line < 0) continue;
      const boxes = tl.lines.slice(s.line, s.line + 4).map((l) => ({ start: l.start, h: ROW }));
      const { y, z, background3 } = zoneSlots(H, boxes);
      expect(background3).toBe(false);
      for (let i = 1; i < boxes.length; i++) {
        const g = Math.min(
          1.5,
          Math.max(0.8, ((boxes[i] as Box).start - (boxes[i - 1] as Box).start) / 3200),
        );
        factors.add(Math.round(g * 100));
        const edgeGap =
          (y[i] as number) -
          (ROW * scaleAt(z[i] as number)) / 2 -
          ((y[i - 1] as number) + (ROW * scaleAt(z[i - 1] as number)) / 2);
        expect(edgeGap).toBeCloseTo(0.04 * H * g);
      }
    }
    expect(factors.size).toBeGreaterThan(3); // the fixture really has different gaps
  });

  it('approach drift moves +1 by 35% of its clearance × drift, +2/+3 toward the slot above', () => {
    const boxes: Box[] = [0, 3200, 6400, 9600].map((start) => ({ start, h: ROW }));
    const slots = zoneSlots(H, boxes);
    const sy = (i: number) => slots.y[i] as number;
    const sz = (i: number) => slots.z[i] as number;
    const clearance = sy(1) - sy(0) - ROW / 2 - (ROW * scaleAt(sz(1))) / 2 - 0.02 * H;
    for (const [phase, eased] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ] as const) {
      const d = 0.3 * eased;
      const { y, z } = zoneTargets(H, boxes, phase);
      expect(y[0]).toBeCloseTo(sy(0));
      expect(y[1]).toBeCloseTo(sy(1) - 0.35 * clearance * d);
      expect(z[1]).toBeCloseTo(sz(1) * (1 - d));
      for (const k of [2, 3]) {
        expect(y[k]).toBeCloseTo(sy(k) + (sy(k - 1) - sy(k)) * d);
        expect(z[k]).toBeCloseTo(sz(k) + (sz(k - 1) - sz(k)) * d);
      }
    }
    // An intense passage (drift 0.38) hits rank +1's depth floor of 0.65 z.
    expect(zoneTargets(H, boxes, 1, 0.38).z[1]).toBeCloseTo(0.65 * sz(1));
  });

  it('overflowing lines shrink the gaps to half, then send +3 to background depth', () => {
    const tall = (start: number, rows: number): Box => ({ start, h: rows * ROW });
    // Rows 2, 1, 1, 1 at 1.5× gaps would end below 0.86 H; shrunk gaps end exactly on it.
    const shrunk = zoneSlots(H, [tall(0, 2), tall(5000, 1), tall(10_000, 1), tall(15_000, 1)]);
    expect(shrunk.background3).toBe(false);
    const bottom = (shrunk.y[3] as number) + (ROW * scaleAt(shrunk.z[3] as number)) / 2;
    expect(bottom).toBeCloseTo(0.86 * H); // gaps shrink just enough, uniformly
    const gap1 =
      (shrunk.y[1] as number) -
      (shrunk.y[0] as number) -
      ROW -
      (ROW * scaleAt(shrunk.z[1] as number)) / 2;
    expect(gap1 / (0.04 * H * 1.5)).toBeGreaterThan(0.5);
    expect(gap1 / (0.04 * H * 1.5)).toBeLessThan(1);
    const over = zoneSlots(H, [tall(0, 3), tall(5000, 3), tall(10_000, 3), tall(15_000, 3)]);
    expect(over.background3).toBe(true);
    expect(over.z[3]).toBe(0.78);
  });

  it('ballad: +1 rises monotonically through each line and keeps 0.02 H clear of it (LYR-05, LYR-03)', () => {
    const tl = buildTimeline(lyricFixtures['ballad-word'] as LyricsDoc);
    const h = (l: LyricLine) => (l.text.length > 22 ? 2 : 1) * ROW;
    let checked = 0;
    for (const s of tl.spans) {
      if (s.line < 0 || s.next >= tl.lines.length) continue;
      const lines = tl.lines.slice(s.line, s.line + 4);
      const boxes = lines.map((l) => ({ start: l.start, h: h(l) }));
      const first = fieldAt(tl, s.from);
      let prev = Infinity;
      for (let t = (lines[0] as LyricLine).start; t < first.handoverAt; t += 100) {
        const f = fieldAt(tl, t);
        expect(f.active).toBe(s.line);
        const { y, z } = zoneTargets(H, boxes, f.phase);
        const y1 = y[1] as number;
        expect(y1).toBeLessThanOrEqual(prev);
        prev = y1;
        const clear = y1 - (h(lines[1] as LyricLine) * scaleAt(z[1] as number)) / 2;
        expect(clear - ((y[0] as number) + (boxes[0] as Box).h / 2)).toBeGreaterThanOrEqual(
          0.02 * H,
        );
      }
      expect(prev).toBeLessThan(zoneSlots(H, boxes).y[1] as number);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
});

it('pop-line: the empty LRC line is a gap, never a field line', () => {
  const doc = lyricFixtures['pop-line'] as LyricsDoc;
  const tl: Timeline = buildTimeline(doc);
  expect(doc.lines.some((l) => !l.text.trim())).toBe(true);
  expect(tl.lines.every((l) => l.text.trim())).toBe(true);
});
