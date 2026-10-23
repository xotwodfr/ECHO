import { describe, expect, it } from 'vitest';
import type { LyricLine, LyricsDoc, LyricWord } from '../../shared/types.ts';
import { guideTone, wav } from './guide-tone.ts';
import { lyricFixtures } from './lyrics.ts';

const fx = (name: string) => lyricFixtures[name] as LyricsDoc;
const words = (d: LyricsDoc) => d.lines.flatMap((l) => l.words ?? []);
const sungEnd = (l: LyricLine) => l.words?.at(-1)?.end ?? l.end ?? l.start;
const graphemes = (s: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s.replace(/\P{L}/gu, ''))]
    .length;

describe.each(Object.entries(lyricFixtures))(
  'lyric fixture %s (LYRICS_INTEGRATION.md §5)',
  (name, d) => {
    it('is a valid LyricsDoc', () => {
      expect(d.trackKey).toBe(`fixture:${name}`);
      expect(d.attribution.text).not.toBe('');
      const starts = d.lines.map((l) => l.start);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      for (const l of d.lines) {
        expect(Number.isInteger(l.start) && l.start >= 0).toBe(true);
        if (l.end !== undefined) expect(l.end).toBeGreaterThanOrEqual(l.start);
        expect(sungEnd(l)).toBeLessThanOrEqual(d.durationMs as number);
        // words present iff sync === 'word' (empty timed lines are gaps and carry none)
        expect(l.words !== undefined).toBe(d.sync === 'word' && l.text.trim() !== '');
        for (const b of l.background ?? []) expect(b.words !== undefined).toBe(d.sync === 'word');
      }
      const check = (ws: LyricWord[], text: string) => {
        ws.forEach((w, i) => {
          expect(w.end).toBeGreaterThan(w.start);
          if (i > 0) expect(w.start).toBeGreaterThanOrEqual((ws[i - 1] as LyricWord).end);
        });
        expect(
          ws
            .map((w) => w.text + (w.isPartOfWord ? '' : ' '))
            .join('')
            .trim(),
        ).toBe(text);
      };
      for (const l of d.lines) {
        if (l.words) check(l.words, l.text);
        for (const b of l.background ?? []) if (b.words) check(b.words, b.text);
      }
      if (d.sync === 'none')
        expect(d.lines.every((l) => l.start === 0 && l.text.trim())).toBe(true);
    });
  },
);

describe('lyric fixtures exercise what §16 lists', () => {
  it('ballad-word: 3:40, lines 4–7 s, held words, a 12 s bridge', () => {
    const d = fx('ballad-word');
    expect(d.durationMs).toBe(220_000);
    for (const l of d.lines) {
      expect(sungEnd(l) - l.start).toBeGreaterThanOrEqual(4000);
      expect(sungEnd(l) - l.start).toBeLessThanOrEqual(7000);
    }
    const held = words(d).filter((w) => w.end - w.start >= 1000 && graphemes(w.text) <= 7);
    expect(held.length).toBeGreaterThan(10);
    const gaps = d.lines.slice(1).map((l, i) => l.start - sungEnd(d.lines[i] as LyricLine));
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(12_000);
  });

  it('rap-word: 2:50, words 90–200 ms, lines 0.9–1.8 s, two interjections < 350 ms before the next line', () => {
    const d = fx('rap-word');
    expect(d.durationMs).toBe(170_000);
    for (const w of words(d)) {
      expect(w.end - w.start).toBeGreaterThanOrEqual(90);
      expect(w.end - w.start).toBeLessThanOrEqual(200);
    }
    const short = d.lines.filter((l, i) => {
      const next = d.lines[i + 1];
      return next && next.start - l.start < 350;
    });
    expect(short.map((l) => l.text)).toEqual(['Yo', 'Go']);
    for (const l of d.lines.filter((x) => !short.includes(x))) {
      expect(sungEnd(l) - l.start).toBeGreaterThanOrEqual(900);
      expect(sungEnd(l) - l.start).toBeLessThanOrEqual(1800);
    }
  });

  it('duet-word: two agents, opposite-aligned lines, backing vocals both ways', () => {
    const d = fx('duet-word');
    expect(new Set(d.lines.map((l) => l.agent)).size).toBeGreaterThanOrEqual(2);
    expect(d.lines.some((l) => l.oppositeAligned)).toBe(true);
    expect(d.lines.some((l) => /\(.+\)/.test(l.text))).toBe(true);
    expect(d.lines.some((l) => l.background?.length)).toBe(true);
  });

  it('pop-line: line-timed, some ends missing, an empty gap line', () => {
    const d = fx('pop-line');
    expect(d.sync).toBe('line');
    expect(d.lines.some((l) => l.end === undefined)).toBe(true);
    expect(d.lines.some((l) => l.end !== undefined)).toBe(true);
    expect(d.lines.some((l) => !l.text.trim())).toBe(true);
  });

  it('cjk-word and rtl-line: per-character Japanese, line-timed Hebrew with a Latin run', () => {
    const cjk = fx('cjk-word');
    expect(words(cjk).every((w) => [...w.text].length === 1)).toBe(true);
    expect(cjk.lines.every((l) => !l.text.includes(' '))).toBe(true);
    const rtl = fx('rtl-line');
    expect(rtl.sync).toBe('line');
    expect(rtl.lines.every((l) => /\p{Script=Hebrew}/u.test(l.text))).toBe(true);
    expect(rtl.lines.some((l) => /[A-Z]/.test(l.text))).toBe(true);
  });

  it('accents-word: diacritics, ligature pairs, apostrophes and dashes', () => {
    const text = fx('accents-word')
      .lines.map((l) => l.text)
      .join('\n');
    for (const s of ['é', 'ñ', 'ø', 'Ø', 'ß', 'fi', 'fl', 'ffi', 'ffl', '’', '—', '“'])
      expect(text).toContain(s);
  });

  it('long-lines: lines over 110 characters; intro-outro: 25 s intro, ≥ 30 s outro', () => {
    expect(fx('long-lines').lines.filter((l) => l.text.length > 110).length).toBeGreaterThanOrEqual(
      3,
    );
    const io = fx('intro-outro');
    expect(io.lines[0]?.start).toBe(25_000);
    expect(
      (io.durationMs as number) - sungEnd(io.lines.at(-1) as LyricLine),
    ).toBeGreaterThanOrEqual(30_000);
  });
});

describe('guide tone', () => {
  const rate = 8000;
  const at = (ms: number) => Math.floor((ms * rate) / 1000);
  const energy = (s: Float32Array, fromMs: number, toMs: number) => {
    let e = 0;
    for (let i = at(fromMs); i < at(toMs); i++) e += (s[i] as number) ** 2;
    return e;
  };

  it('is silent between words and sounds on every word and line start', () => {
    const d = fx('ballad-word');
    const s = guideTone(d, rate);
    expect(s.length).toBe(at(220_000));
    const first = d.lines[0] as LyricLine;
    expect(energy(s, 0, first.start - 5)).toBe(0); // intro
    expect(energy(s, first.start, first.start + 6)).toBeGreaterThan(0.1); // click
    for (const w of words(d)) expect(energy(s, w.start + 20, w.end - 20)).toBeGreaterThan(1);
  });

  it('is silent for an untimed doc, and encodes as 16-bit mono WAV', () => {
    expect(guideTone(fx('static'), rate).every((x) => x === 0)).toBe(true);
    const bytes = wav(new Float32Array([0, 1, -1]), rate);
    const v = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(rate);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([
      0, 32767, -32767,
    ]);
  });
});
