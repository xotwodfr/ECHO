import { describe, expect, it } from 'vitest';
import type { LyricsDoc, LyricWord } from '../../../shared/types.ts';
import { lyricFixtures } from '../../fixtures/lyrics.ts';
import { dirOf, emphasisOf, fitLine, graphemes, isCJK, sidesOf, splitBacking } from './layout.ts';

const word = (text: string, dur: number): LyricWord => ({
  text,
  start: 10_000,
  end: 10_000 + dur,
  isPartOfWord: false,
});
const fx = (name: string) => lyricFixtures[name] as LyricsDoc;

describe('fitLine (§3.3, DESIGN_SYSTEM.md §4.3)', () => {
  it('keeps a line that fits in 2 rows at full width and size', () => {
    const seen: [number, number][] = [];
    const fit = fitLine((w, s) => {
      seen.push([w, s]);
      return 2;
    });
    expect(fit).toEqual({ wdth: 100, size: 1, rows: 2 });
    expect(seen).toEqual([[100, 1]]); // one measurement
  });

  it('never condenses: Figtree has no width axis', () => {
    const seen: number[] = [];
    fitLine((w) => {
      seen.push(w);
      return 3;
    });
    expect(new Set(seen)).toEqual(new Set([100]));
  });

  it('shrinks by at most 12%, then allows 3 rows', () => {
    expect(fitLine((_w, s) => (s <= 0.94 ? 2 : 3))).toEqual({ wdth: 100, size: 0.94, rows: 2 });
    const seen: [number, number][] = [];
    const fit = fitLine((w, s) => {
      seen.push([w, s]);
      return 3;
    });
    expect(fit).toEqual({ wdth: 100, size: 0.88, rows: 3 });
    expect(Math.min(...seen.map(([, s]) => s))).toBeCloseTo(0.88);
  });
});

describe('emphasis on held words (§5.5, LYR-09)', () => {
  it('needs ≥ 1000 ms and 2–7 graphemes', () => {
    expect(emphasisOf(word('home', 999), false)).toBeNull();
    expect(emphasisOf(word('home', 1000), false)).not.toBeNull();
    expect(emphasisOf(word('a', 2000), false)).toBeNull();
    expect(emphasisOf(word('ab', 2000), false)).not.toBeNull();
    expect(emphasisOf(word('sevenly', 2000), false)).not.toBeNull();
    expect(emphasisOf(word('eightish', 2000), false)).toBeNull();
  });

  // ON-LY-5: emphasis sets each grapheme in its own inline-block, which breaks cursive joining.
  it('never in joined scripts (Arabic, Syriac, N’Ko, Mongolian, Adlam)', () => {
    expect(emphasisOf(word('مرحبا', 1500), false)).toBeNull();
    expect(emphasisOf(word('ܫܠܡܐ', 1500), false)).toBeNull();
    expect(emphasisOf(word('ߒߞߏ', 1500), false)).toBeNull();
    expect(emphasisOf(word('שלום', 1500), false)).not.toBeNull(); // Hebrew does not join
  });

  it('counts graphemes, not code units (é composed or not, ß, ligatures)', () => {
    expect(graphemes('café')).toHaveLength(4);
    expect(graphemes('straße')).toHaveLength(6);
    expect(emphasisOf(word('ééééééé', 2000), false)).not.toBeNull();
  });

  it('CJK: duration only, even for one character', () => {
    expect(emphasisOf(word('光', 1200), false)).not.toBeNull();
    expect(emphasisOf(word('光', 900), false)).toBeNull();
  });

  it('swell = 0.05·a, a = min(1.2, (dur − 1000)/1500 + 0.6); the last word ×1.4; cap 8%', () => {
    expect(emphasisOf(word('home', 1000), false)?.swell).toBeCloseTo(0.03);
    expect(emphasisOf(word('home', 2500), false)?.swell).toBeCloseTo(0.055);
    expect(emphasisOf(word('home', 9000), false)?.swell).toBeCloseTo(0.06);
    expect(emphasisOf(word('home', 1000), true)?.swell).toBeCloseTo(0.042);
    expect(emphasisOf(word('home', 9000), true)?.swell).toBe(0.08);
    expect(emphasisOf(word('home', 2000), false)?.lift).toBeLessThanOrEqual(0.08);
    expect(emphasisOf(word('home', 2000), false)?.stepMs).toBeCloseTo(2000 / 2.5 / 4);
  });

  it('on every fixture: never under 150 ms, never beyond the caps', () => {
    let count = 0;
    for (const doc of Object.values(lyricFixtures))
      for (const l of doc.lines)
        l.words?.forEach((w, k, ws) => {
          const e = emphasisOf(w, k === ws.length - 1);
          if (!e) return;
          count++;
          expect(w.end - w.start).toBeGreaterThanOrEqual(1000);
          expect(e.swell).toBeLessThanOrEqual(0.08);
          expect(e.lift).toBeLessThanOrEqual(0.08);
        });
    expect(count).toBeGreaterThan(5); // the ballad's held words qualify
    const rap = fx('rap-word').lines.flatMap((l) => l.words ?? []);
    expect(rap.filter((w) => w.end - w.start < 150).length).toBeGreaterThan(0);
    for (const w of rap) if (w.end - w.start < 150) expect(emphasisOf(w, true)).toBeNull();
  });
});

describe('scripts and sides (§4.4, §5.4, §5.6)', () => {
  it('direction from the first strong character', () => {
    expect(dirOf('Hello')).toBe('ltr');
    expect(dirOf('— שלום world')).toBe('rtl');
    expect(dirOf('42 مرحبا')).toBe('rtl');
    expect(dirOf('“Hi” שלום')).toBe('ltr');
    for (const l of fx('rtl-line').lines) expect(dirOf(l.text)).toBe('rtl');
  });

  it('CJK detection', () => {
    expect(fx('cjk-word').lines.every((l) => isCJK(l.text))).toBe(true);
    expect(isCJK('Ça ira, ﬁne')).toBe(false);
  });

  it('parenthesised backing vocals in line-timed text', () => {
    expect(splitBacking('Hold on (hold on) to me')).toEqual({
      lead: 'Hold on to me',
      backing: ['hold on'],
    });
    expect(splitBacking('(only backing)')).toEqual({ lead: '(only backing)', backing: [] });
    expect(splitBacking('plain')).toEqual({ lead: 'plain', backing: [] });
  });

  it('duet: each agent keeps its side for the whole song; the group is centred', () => {
    const doc = fx('duet-word');
    const side = sidesOf(doc);
    const by = new Map<string, Set<string>>();
    for (const l of doc.lines) {
      const s = by.get(l.agent ?? '') ?? new Set();
      s.add(side(l));
      by.set(l.agent ?? '', s);
    }
    expect([...(by.get('v1') ?? [])]).toEqual(['left']);
    expect([...(by.get('v2') ?? [])]).toEqual(['right']);
    expect([...(by.get('v3') ?? [])]).toEqual(['centre']);
    expect(sidesOf(fx('ballad-word'))(fx('ballad-word').lines[0] as never)).toBe('centre');
  });

  it('two agents without flags: the first goes left, the second right', () => {
    const doc = {
      ...fx('pop-line'),
      lines: [
        { text: 'a', start: 0, agent: 'x' },
        { text: 'b', start: 1, agent: 'y' },
      ],
    } as LyricsDoc;
    const side = sidesOf(doc);
    expect(doc.lines.map(side)).toEqual(['left', 'right']);
  });
});
